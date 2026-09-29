/**
 * ─── MESSAGES CLIENTS ──────────────────────────────────────────────────────────
 *
 *  À QUOI SERT CET ÉCRAN
 *  Un lavage vit de clients qui reviennent. Sans rien pour les rappeler, on
 *  attend qu'ils y pensent — et beaucoup n'y pensent pas. Cet écran fait trois
 *  choses, et rien d'autre :
 *
 *    1. ALERTES — la liste des clients dont le prochain passage est dû, déduite
 *       des interventions terminées et des délais réglés par la station (un
 *       délai pour le lavage, un autre pour la vidange, indépendants).
 *       Chaque alerte se classe « lue » ou part en message.
 *    2. ENVOYER — chercher un client, choisir ses véhicules, composer le
 *       message (à partir d'un modèle ou librement) et l'envoyer.
 *    3. MODÈLES — les textes types de la station, écrits une fois et réutilisés.
 *
 *  CE QUI EST DÉDUIT ET CE QUI EST ENREGISTRÉ
 *  Les alertes NE SONT PAS stockées : ce sont une lecture de l'historique à la
 *  lumière des délais du jour (voir `src/lib/rappels.ts`). Ce qui est enregistré,
 *  c'est ce que l'utilisateur en a fait — « lue » ou « envoyée » — et le journal
 *  d'envoi, qui vit dans sa propre table Supabase.
 *
 *  LA PRUDENCE QUI PROTÈGE LE NUMÉRO
 *  Un numéro WhatsApp banni l'est SANS RECOURS. L'écran ne propose donc jamais
 *  d'envoyer sans avoir montré le texte, temporise les envois groupés côté
 *  serveur, et refuse les numéros manifestement invalides avant de les mettre en
 *  file plutôt que de les découvrir trois jours plus tard.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  MessageCircle, Send, Bell, BellOff, FileText, Plus, Search, Check, X, Car,
  Settings2, Loader2, AlertTriangle, CheckCircle2, Clock, Trash2, Edit2, Users,
  Inbox, RefreshCcw,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import {
  ModuleKey, MODULES, BizCar, BizContact, BizMessageTemplate, BizRappel, BizRappelConfig,
  DEFAULT_RAPPEL_CONFIG, MESSAGE_TOKENS, carLabel, carFullLabel,
} from '@/src/lib/bizConfig';
import { RappelAlert, buildRappels } from '@/src/lib/rappels';
import {
  MessageVars, STARTER_TEMPLATES, defaultRappelMessage, displayPhone, missingTokens,
  normalizePhone, renderTemplate, STATUS_LABEL, MessageStatus,
} from '@/src/lib/whatsappCore';
import { MessageRow, SendRecipient, loadMessages, sendMessages } from '@/src/lib/whatsapp';
import { newId, matchesSearch } from '@/src/lib/utils';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission, useAppState } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, Badge, Tabs, EmptyState, Modal, Field, Input, Textarea,
  Select, Switch, SearchInput, formatDate, ViewToggle, Table, RowActions, ActionBtn,
} from '@/src/components/biz/Kit';

const STATUS_TONE: Record<MessageStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  queued: 'warning',
  sent: 'info',
  delivered: 'success',
  read: 'success',
  failed: 'danger',
};

/** Journée locale du jour, `YYYY-MM-DD`. */
const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

const shortDate = (s: string) => {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? String(s).slice(0, 10) : d.toLocaleDateString('fr-FR');
};

/** Un destinataire en cours de composition — un client et UN de ses véhicules. */
interface Draft {
  key: string;
  clientId?: string;
  clientName: string;
  phone: string;
  car?: BizCar;
  carText: string;
  body: string;
  kind: 'libre' | 'rappel';
  rappelKind?: 'lavage' | 'reparation';
  /** L'alerte d'origine, quand le message part d'un rappel. */
  alertId?: string;
  lastVisit?: string;
}

export default function ModuleMessages({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'messages');
  const { settings, currentUserName } = useAppState();
  const { clients, reparations } = biz.state;
  const templates: BizMessageTemplate[] = biz.state.messageTemplates || [];
  const handled: BizRappel[] = biz.state.rappels || [];
  const config: BizRappelConfig = biz.state.rappelConfig || DEFAULT_RAPPEL_CONFIG;

  const [tab, setTab] = useState('alertes');
  // Tableau par défaut sur les trois listes de l'écran (alertes, journal,
  // modèles) : ce sont des files d'attente, elles se balaient en lignes.
  const [view, setView] = useState<'grid' | 'table'>('table');
  const [showConfig, setShowConfig] = useState(false);
  const [composing, setComposing] = useState<Draft[] | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<BizMessageTemplate | null>(null);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [search, setSearch] = useState('');

  // ── Le journal d'envoi, lu dans sa propre table ──────────────────────────
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [journalMissing, setJournalMissing] = useState(false);
  const [loadingJournal, setLoadingJournal] = useState(false);

  const reloadJournal = React.useCallback(async () => {
    setLoadingJournal(true);
    try {
      const res = await loadMessages(moduleKey);
      setMessages(res.rows);
      setJournalMissing(res.missing);
    } catch (err: any) {
      toast.error(String(err?.message || err));
    } finally {
      setLoadingJournal(false);
    }
  }, [moduleKey]);

  useEffect(() => { reloadJournal(); }, [reloadJournal]);

  // ── Les alertes, DÉDUITES à chaque rendu ─────────────────────────────────
  const alerts: RappelAlert[] = useMemo(
    () => buildRappels({ reparations, clients, handled, config, today: todayISO() }),
    [reparations, clients, handled, config]);

  const dueAlerts: RappelAlert[] = useMemo(() => alerts.filter((a: RappelAlert) => a.due), [alerts]);
  const soonAlerts: RappelAlert[] = useMemo(() => alerts.filter((a: RappelAlert) => !a.due), [alerts]);

  // ── Les variables d'un message, pour un client et un véhicule ────────────
  const varsFor = (clientName: string, car: BizCar | undefined, lastVisit?: string, kind?: 'lavage' | 'reparation'): MessageVars => ({
    client: clientName,
    vehicule: carFullLabel(car) || undefined,
    marque: car?.marque || undefined,
    modele: car?.name || undefined,
    immatriculation: car?.immatriculation || undefined,
    kilometrage: typeof car?.kilometrage === 'number' ? car.kilometrage.toLocaleString('fr-FR') : undefined,
    derniere_visite: lastVisit ? shortDate(lastVisit) : undefined,
    prestation: kind === 'lavage' ? 'lavage' : kind === 'reparation' ? 'vidange' : undefined,
    station: settings?.stationName || settings?.name || undefined,
    telephone: settings?.phone || undefined,
  });

  // ── Composer depuis une (ou plusieurs) alerte(s) ─────────────────────────
  const composeFromAlerts = (list: RappelAlert[]) => {
    const drafts: Draft[] = list.map((a: RappelAlert) => {
      const vars = varsFor(a.clientName, a.car, a.lastVisit, a.kind);
      // Un modèle de la bonne nature s'il en existe un, sinon le texte
      // professionnel écrit par l'application — jamais un champ vide.
      const tpl = templates.find((t: BizMessageTemplate) => t.usage === a.kind);
      return {
        key: a.id,
        clientId: a.clientId,
        clientName: a.clientName,
        phone: a.clientPhone || '',
        car: a.car,
        carText: a.carText,
        body: tpl ? renderTemplate(tpl.body, vars) : defaultRappelMessage(a.kind, vars),
        kind: 'rappel',
        rappelKind: a.kind,
        alertId: a.id,
        lastVisit: a.lastVisit,
      };
    });
    setComposing(drafts);
  };

  /**
   * Inscrit ce qui a été FAIT d'une alerte.
   *
   * L'identifiant est déterministe (`intervention:nature:véhicule`), donc deux
   * postes qui traitent la même alerte visent la même ligne : on met à jour
   * quand elle existe déjà, plutôt que d'en ajouter une seconde qu'il faudrait
   * ensuite départager.
   */
  const noteRappel = (a: RappelAlert, status: 'read' | 'sent', messageId?: string) => {
    const row: BizRappel = {
      id: a.id, reparationId: a.reparationId, kind: a.kind, carKey: a.carKey,
      clientId: a.clientId, status, at: new Date().toISOString(), by: currentUserName,
      messageId,
    };
    if (handled.some((r: BizRappel) => r.id === a.id)) biz.update('rappels', row);
    else biz.add('rappels', row);
  };

  // ── Classer une alerte sans écrire ───────────────────────────────────────
  const markRead = (a: RappelAlert) => {
    if (!perm.modifier) return;
    noteRappel(a, 'read');
    toast.success('Alerte classée — elle ne reviendra plus.');
  };

  const markAllRead = () => {
    if (!perm.modifier || dueAlerts.length === 0) return;
    dueAlerts.forEach((a: RappelAlert) => noteRappel(a, 'read'));
    toast.success(`${dueAlerts.length} alerte(s) classée(s).`);
  };

  // ── L'envoi ──────────────────────────────────────────────────────────────
  const [sending, setSending] = useState(false);

  const doSend = async (drafts: Draft[]) => {
    const usable = drafts.filter(d => normalizePhone(d.phone) && d.body.trim());
    if (!usable.length) {
      toast.error('Aucun destinataire n\'a de numéro utilisable.');
      return;
    }
    setSending(true);
    try {
      const recipients: SendRecipient[] = usable.map(d => ({
        phone: d.phone,
        name: d.clientName,
        clientId: d.clientId,
        carLabel: d.carText || undefined,
        body: d.body,
        moduleKey,
        kind: d.kind,
        rappelKind: d.rappelKind,
      }));
      const res = await sendMessages(recipients, currentUserName);

      // Une alerte dont le message est PARTI — ou mis en attente, ce qui n'est
      // pas un échec — quitte la liste : elle a été traitée.
      usable.forEach((d, i) => {
        const rep = res.reports[i];
        if (!d.alertId || !rep) return;
        if (rep.outcome === 'failed') return;
        const src = alerts.find((a: RappelAlert) => a.id === d.alertId);
        if (!src) return;
        noteRappel(src, 'sent', rep.messageId);
      });

      const { sent, queued, failed } = res.counts;
      if (failed && !sent && !queued) toast.error(`${failed} envoi(s) en échec.`);
      else if (queued) {
        toast.success(
          `${sent} envoyé(s), ${queued} en attente — la passerelle est injoignable, ils repartiront seuls.`,
          { duration: 6000 });
      } else toast.success(`${sent} message(s) envoyé(s).`);
      if (!res.persisted) {
        toast('Aucun journal : SUPABASE_SERVICE_ROLE_KEY manque côté serveur.', { icon: '⚠️' });
      }
      setComposing(null);
      reloadJournal();
    } catch (err: any) {
      toast.error(String(err?.message || err));
    } finally {
      setSending(false);
    }
  };

  // ── Les modèles ──────────────────────────────────────────────────────────
  const installStarters = () => {
    STARTER_TEMPLATES.forEach(t => biz.add('messageTemplates', {
      id: newId(), name: t.name, body: t.body, usage: t.usage,
      createdAt: new Date().toISOString(), createdBy: currentUserName,
    } as BizMessageTemplate));
    toast.success('Modèles de départ installés — modifiez-les librement.');
  };

  const filteredMessages: MessageRow[] = useMemo(() => {
    if (!search.trim()) return messages;
    return messages.filter((m: MessageRow) => matchesSearch(search, m.recipientName, m.recipientPhone, m.body));
  }, [messages, search]);

  if (!perm.voir) {
    return <EmptyState icon={MessageCircle} title="Accès refusé" message="Vous n'avez pas accès à cet écran." />;
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader icon={MessageCircle} title="Messages clients"
        subtitle={`${cfg.label} — rappels de passage et envois WhatsApp`}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <button className="btn-secondary" onClick={() => setShowConfig(true)}>
              <Settings2 className="w-4 h-4" /> Délais de rappel
            </button>
            {perm.creer && (
              <button className="btn-primary" onClick={() => setComposing([])}>
                <Send className="w-4 h-4" /> Nouveau message
              </button>
            )}
          </div>
        } />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Bell} label="Rappels échus" value={dueAlerts.length} tone={dueAlerts.length ? 'red' : 'green'}
          sub={config.enabled ? 'À traiter' : 'Rappels désactivés'} />
        <StatCard icon={Clock} label="Bientôt dus" value={soonAlerts.length} tone="amber" sub="Dans les 7 jours" />
        <StatCard icon={Send} label="Messages envoyés" value={messages.filter((m: MessageRow) => m.status !== 'queued' && m.status !== 'failed').length} tone="blue" />
        <StatCard icon={FileText} label="Modèles" value={templates.length} tone="purple" />
      </div>

      {!config.enabled && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 flex items-start gap-3">
          <BellOff className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
          <p className="text-xs font-semibold text-slate-500 leading-relaxed">
            Les rappels sont désactivés : aucune alerte n'est calculée. Les délais réglés sont
            conservés — réactivez-les dans « Délais de rappel » quand vous voulez.
          </p>
        </div>
      )}

      <Tabs active={tab} onChange={setTab} tabs={[
        { id: 'alertes', label: `Alertes (${dueAlerts.length})`, icon: Bell },
        { id: 'aVenir', label: `À venir (${soonAlerts.length})`, icon: Clock },
        { id: 'journal', label: 'Journal des envois', icon: Inbox },
        { id: 'modeles', label: 'Modèles', icon: FileText },
      ]} />

      {/* ── Alertes ─────────────────────────────────────────────────────── */}
      {tab === 'alertes' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {dueAlerts.length > 0 && perm.creer && (
              <button className="btn-primary" onClick={() => composeFromAlerts(dueAlerts)}>
                <Send className="w-4 h-4" /> Envoyer à tous ({dueAlerts.length})
              </button>
            )}
            {dueAlerts.length > 0 && perm.modifier && (
              <button className="btn-secondary" onClick={markAllRead}>
                <Check className="w-4 h-4" /> Tout marquer comme lu
              </button>
            )}
            <div className="ml-auto"><ViewToggle view={view} onChange={setView} /></div>
          </div>
          <AlertList view={view} alerts={dueAlerts} perm={perm} onSend={a => composeFromAlerts([a])} onRead={markRead}
            emptyTitle="Aucun rappel échu"
            emptyMessage="Personne n'est en retard pour un lavage ou une révision. Les rappels apparaîtront ici d'eux-mêmes." />
        </div>
      )}

      {/* ── À venir ─────────────────────────────────────────────────────── */}
      {tab === 'aVenir' && (<div className="space-y-3">
        <div className="flex justify-end"><ViewToggle view={view} onChange={setView} /></div>
        <AlertList view={view} alerts={soonAlerts} perm={perm} onSend={a => composeFromAlerts([a])} onRead={markRead}
          emptyTitle="Rien dans les sept prochains jours"
          emptyMessage="Les rappels s'affichent une semaine avant leur échéance, pour laisser le temps de préparer l'envoi." />
      </div>)}

      {/* ── Journal ─────────────────────────────────────────────────────── */}
      {tab === 'journal' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Client, numéro ou texte…" />
            <button className="btn-secondary" onClick={reloadJournal} disabled={loadingJournal}>
              {loadingJournal ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
              Actualiser
            </button>
            <div className="ml-auto"><ViewToggle view={view} onChange={setView} /></div>
          </div>
          {journalMissing ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-[11px] font-black uppercase tracking-wider text-amber-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Table absente
              </p>
              <p className="text-xs font-semibold text-amber-900/80 mt-1.5 leading-relaxed">
                La table <code className="font-mono">whatsapp_messages</code> n'existe pas encore sur
                cette base. Exécutez la migration
                <code className="font-mono"> supabase/migrations/2026-08-22_whatsapp_messaging.sql</code>
                dans l'éditeur SQL de Supabase. L'envoi fonctionne déjà ; seul le suivi manque.
              </p>
            </div>
          ) : filteredMessages.length === 0 ? (
            <EmptyState icon={Inbox} title="Aucun message" message="Les envois apparaîtront ici, avec leur accusé de remise." />
          ) : view === 'table' ? (
            <Table head={<>
              <th className="table-head">Destinataire</th><th className="table-head">Numéro</th>
              <th className="table-head">Véhicule</th><th className="table-head">Date</th>
              <th className="table-head">Message</th><th className="table-head">État</th>
            </>}>
              {filteredMessages.map((m: MessageRow) => (
                <tr key={m.id}>
                  <td className="table-cell font-bold text-slate-700">{m.recipientName || displayPhone(m.recipientPhone)}</td>
                  <td className="table-cell whitespace-nowrap">{displayPhone(m.recipientPhone)}</td>
                  <td className="table-cell text-slate-500">{m.carLabel || '—'}</td>
                  <td className="table-cell whitespace-nowrap text-slate-500">{formatDate(m.createdAt)}</td>
                  <td className="table-cell">
                    <div className="max-w-[360px] text-slate-600 line-clamp-2 whitespace-pre-wrap" title={m.body}>{m.body}</div>
                    {m.error && <div className="text-[11px] font-bold text-red-600">{m.error}</div>}
                  </td>
                  <td className="table-cell"><Badge tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Badge></td>
                </tr>
              ))}
            </Table>
          ) : (
            <div className="space-y-2">
              {filteredMessages.map((m: MessageRow) => (
                <div key={m.id} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-700 truncate">
                        {m.recipientName || displayPhone(m.recipientPhone)}
                      </p>
                      <p className="text-[11px] font-semibold text-slate-400">
                        {displayPhone(m.recipientPhone)}
                        {m.carLabel ? ` • ${m.carLabel}` : ''}
                        {` • ${formatDate(m.createdAt)}`}
                      </p>
                    </div>
                    <Badge tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Badge>
                  </div>
                  <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed border-l-2 border-slate-200 pl-3">
                    {m.body}
                  </p>
                  {m.error && <p className="text-[11px] font-bold text-red-600">{m.error}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Modèles ─────────────────────────────────────────────────────── */}
      {tab === 'modeles' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {perm.creer && (
              <button className="btn-primary" onClick={() => { setEditingTemplate(null); setShowTemplateForm(true); }}>
                <Plus className="w-4 h-4" /> Nouveau modèle
              </button>
            )}
            {perm.creer && templates.length === 0 && (
              <button className="btn-secondary" onClick={installStarters}>
                <FileText className="w-4 h-4" /> Installer les modèles de départ
              </button>
            )}
            <div className="ml-auto"><ViewToggle view={view} onChange={setView} /></div>
          </div>
          {templates.length === 0 ? (
            <EmptyState icon={FileText} title="Aucun modèle"
              message="Écrivez un texte une fois, réutilisez-le à chaque envoi. Les jetons {client}, {vehicule} ou {kilometrage} sont remplis automatiquement." />
          ) : view === 'table' ? (
            <Table head={<>
              <th className="table-head">Modèle</th><th className="table-head">Usage</th>
              <th className="table-head">Texte</th><th className="table-head text-right">Actions</th>
            </>}>
              {templates.map((t: BizMessageTemplate) => (
                <tr key={t.id}>
                  <td className="table-cell font-bold text-slate-700">{t.name}</td>
                  <td className="table-cell">
                    <Badge tone={t.usage === 'lavage' ? 'info' : t.usage === 'reparation' ? 'warning' : 'neutral'}>
                      {t.usage === 'lavage' ? 'Rappel de lavage' : t.usage === 'reparation' ? 'Rappel de vidange' : 'Message libre'}
                    </Badge>
                  </td>
                  <td className="table-cell">
                    <div className="max-w-[420px] text-slate-600 line-clamp-2 whitespace-pre-wrap" title={t.body}>{t.body}</div>
                  </td>
                  <td className="table-cell text-right">
                    <RowActions>
                      {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => { setEditingTemplate(t); setShowTemplateForm(true); }} />}
                      {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => { biz.remove('messageTemplates', t.id); toast.success('Modèle supprimé.'); }} />}
                    </RowActions>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {templates.map((t: BizMessageTemplate) => (
                <div key={t.id} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-700 truncate">{t.name}</p>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                        {t.usage === 'lavage' ? 'Rappel de lavage' : t.usage === 'reparation' ? 'Rappel de vidange' : 'Message libre'}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {perm.modifier && (
                        <button className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50" title="Modifier"
                          onClick={() => { setEditingTemplate(t); setShowTemplateForm(true); }}>
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {perm.supprimer && (
                        <button className="p-1.5 rounded-lg text-red-500 hover:bg-red-50" title="Supprimer"
                          onClick={() => { biz.remove('messageTemplates', t.id); toast.success('Modèle supprimé.'); }}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed border-l-2 border-slate-200 pl-3">
                    {t.body}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Boîtes ──────────────────────────────────────────────────────── */}
      {showConfig && (
        <RappelConfigModal
          config={config}
          clients={clients}
          canEdit={perm.modifier}
          onClose={() => setShowConfig(false)}
          onSave={next => { biz.patch({ rappelConfig: next }); toast.success('Délais par défaut enregistrés.'); }}
          onSaveClient={client => { biz.update('clients', client); void biz.flush(); }} />
      )}

      {showTemplateForm && (
        <TemplateModal
          initial={editingTemplate}
          onClose={() => { setShowTemplateForm(false); setEditingTemplate(null); }}
          onSave={t => {
            if (editingTemplate) biz.update('messageTemplates', t); else biz.add('messageTemplates', t);
            setShowTemplateForm(false); setEditingTemplate(null);
            toast.success('Modèle enregistré.');
          }} />
      )}

      {composing !== null && (
        <ComposeModal
          drafts={composing}
          clients={clients}
          templates={templates}
          varsFor={varsFor}
          sending={sending}
          onChange={setComposing}
          onClose={() => setComposing(null)}
          onSend={doSend} />
      )}
    </div>
  );
}

// ─── La liste d'alertes ────────────────────────────────────────────────────────

function AlertList({ view, alerts, perm, onSend, onRead, emptyTitle, emptyMessage }: {
  view: 'grid' | 'table';
  alerts: RappelAlert[];
  perm: { creer: boolean; modifier: boolean };
  onSend: (a: RappelAlert) => void;
  onRead: (a: RappelAlert) => void;
  emptyTitle: string;
  emptyMessage: string;
}) {
  if (alerts.length === 0) {
    return <EmptyState icon={CheckCircle2} title={emptyTitle} message={emptyMessage} />;
  }
  if (view === 'table') {
    return (
      <Table head={<>
        <th className="table-head">Client</th><th className="table-head">Téléphone</th>
        <th className="table-head">Véhicule</th><th className="table-head">Dernier passage</th>
        <th className="table-head">Échéance</th><th className="table-head">Délai</th>
        <th className="table-head text-right">Actions</th>
      </>}>
        {alerts.map((a: RappelAlert) => {
          const phoneOk = !!normalizePhone(a.clientPhone);
          return (
            <tr key={a.id} className={a.daysLeft < 0 ? 'bg-red-50/50' : undefined}>
              <td className="table-cell font-bold text-slate-700">{a.clientName}</td>
              <td className="table-cell whitespace-nowrap">
                {a.clientPhone
                  ? displayPhone(normalizePhone(a.clientPhone) || a.clientPhone)
                  : <span className="text-amber-700 font-bold">Aucun téléphone</span>}
                {a.clientPhone && !phoneOk && <div className="text-[11px] font-bold text-amber-700">Numéro invalide</div>}
              </td>
              <td className="table-cell">
                <div className="text-slate-600">{a.carText || 'Véhicule non précisé'}</div>
                {typeof a.kilometrage === 'number' && (
                  <div className="text-[11px] text-slate-400 tabular-nums">{a.kilometrage.toLocaleString('fr-FR')} km</div>
                )}
              </td>
              <td className="table-cell whitespace-nowrap text-slate-500">
                {a.kind === 'lavage' ? 'Lavage' : 'Vidange'} du {shortDate(a.lastVisit)}
                <div className="text-[11px] text-slate-400">{a.ref}</div>
              </td>
              <td className="table-cell whitespace-nowrap text-slate-500">{shortDate(a.dueDate)}</td>
              <td className="table-cell">
                <Badge tone={a.daysLeft < 0 ? 'danger' : a.daysLeft === 0 ? 'warning' : 'info'}>
                  {a.daysLeft < 0 ? `${-a.daysLeft} j de retard` : a.daysLeft === 0 ? "Aujourd'hui" : `dans ${a.daysLeft} j`}
                </Badge>
              </td>
              <td className="table-cell text-right">
                <RowActions>
                  {perm.creer && <ActionBtn icon={Send} tone="blue" title={phoneOk ? 'Envoyer le message' : 'Numéro absent ou invalide'} disabled={!phoneOk} onClick={() => onSend(a)} />}
                  {perm.modifier && <ActionBtn icon={Check} tone="slate" title="Marquer comme lu" onClick={() => onRead(a)} />}
                </RowActions>
              </td>
            </tr>
          );
        })}
      </Table>
    );
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {alerts.map((a: RappelAlert) => {
        const phoneOk = !!normalizePhone(a.clientPhone);
        return (
          <div key={a.id} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-700 truncate">{a.clientName}</p>
                <p className="text-[11px] font-semibold text-slate-400 truncate">
                  {a.clientPhone ? displayPhone(normalizePhone(a.clientPhone) || a.clientPhone) : 'Aucun téléphone'}
                </p>
              </div>
              <Badge tone={a.daysLeft < 0 ? 'danger' : a.daysLeft === 0 ? 'warning' : 'info'}>
                {a.daysLeft < 0 ? `${-a.daysLeft} j de retard` : a.daysLeft === 0 ? "Aujourd'hui" : `dans ${a.daysLeft} j`}
              </Badge>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 space-y-1">
              <p className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5">
                <Car className="w-3.5 h-3.5 text-slate-400" />
                {a.carText || 'Véhicule non précisé'}
                {typeof a.kilometrage === 'number' && (
                  <span className="text-slate-400"> • {a.kilometrage.toLocaleString('fr-FR')} km</span>
                )}
              </p>
              <p className="text-[11px] font-semibold text-slate-400">
                {a.kind === 'lavage' ? 'Lavage' : 'Vidange'} du {shortDate(a.lastVisit)} ({a.ref})
                {' • '}échéance {shortDate(a.dueDate)}
              </p>
            </div>

            {!phoneOk && (
              <p className="text-[11px] font-bold text-amber-700 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Numéro absent ou invalide — complétez la fiche du client pour pouvoir écrire.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {perm.creer && (
                <button className="btn-primary !py-2 !px-3 text-xs" disabled={!phoneOk} onClick={() => onSend(a)}>
                  <Send className="w-3.5 h-3.5" /> Envoyer le message
                </button>
              )}
              {perm.modifier && (
                <button className="btn-ghost !py-2 !px-3 text-xs" onClick={() => onRead(a)}>
                  <Check className="w-3.5 h-3.5" /> Marquer comme lu
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Les délais de rappel ──────────────────────────────────────────────────────

/**
 * ─── LES DÉLAIS DE RAPPEL ───────────────────────────────────────────────────────
 *
 * Deux réglages, dans deux onglets :
 *
 *   • PAR DÉFAUT — le délai de toute la partie (lavage et vidange, séparément),
 *     et l'interrupteur qui coupe les rappels sans perdre les délais.
 *   • PAR CLIENT — on cherche un client, on voit SES véhicules, et on règle le
 *     délai VOITURE PAR VOITURE. Un délai propre à un véhicule l'emporte sur le
 *     réglage par défaut ; laissé vide, le véhicule suit le défaut ; mis à 0, il
 *     ne reçoit plus de rappel de cette nature.
 */
function RappelConfigModal({ config, clients, canEdit, onClose, onSave, onSaveClient }: {
  config: BizRappelConfig;
  clients: BizContact[];
  canEdit: boolean;
  onClose: () => void;
  onSave: (c: BizRappelConfig) => void;
  onSaveClient: (client: BizContact) => void;
}) {
  const [tab, setTab] = useState<'client' | 'defaut'>('client');

  // ── Réglages par défaut ────────────────────────────────────────────────────
  const [enabled, setEnabled] = useState(config.enabled);
  const [lavage, setLavage] = useState(String(config.lavageDays));
  const [reparation, setReparation] = useState(String(config.reparationDays));

  // ── Par client / véhicule ──────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<BizContact | null>(null);
  const [draftCars, setDraftCars] = useState<BizCar[]>([]);

  const results: BizContact[] = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return clients.filter((c: BizContact) => matchesSearch(q, c.name, c.phone)).slice(0, 20);
  }, [clients, query]);

  const pickClient = (c: BizContact) => {
    setSelected(c);
    setDraftCars((c.cars || []).map((v: BizCar) => ({ ...v })));
    setQuery('');
  };

  const patchCarDays = (id: string, key: 'rappelLavageDays' | 'rappelReparationDays', raw: string) =>
    setDraftCars(cars => cars.map(v => (v.id === id
      ? { ...v, [key]: raw === '' ? undefined : Math.max(0, Number(raw) || 0) }
      : v)));

  const resetCar = (id: string) =>
    setDraftCars(cars => cars.map(v => (v.id === id
      ? { ...v, rappelLavageDays: undefined, rappelReparationDays: undefined }
      : v)));

  const saveClient = () => {
    if (!selected) return;
    onSaveClient({ ...selected, cars: draftCars });
    toast.success(`Rappels de ${selected.name} enregistrés.`);
    setSelected(null);
    setDraftCars([]);
  };

  const footer = tab === 'defaut'
    ? (<>
        <button className="btn-ghost" onClick={onClose}>Fermer</button>
        {canEdit && (
          <button className="btn-primary" onClick={() => onSave({
            enabled,
            lavageDays: Math.max(0, Number(lavage) || 0),
            reparationDays: Math.max(0, Number(reparation) || 0),
          })}>Enregistrer les défauts</button>
        )}
      </>)
    : (<>
        <button className="btn-ghost" onClick={onClose}>Fermer</button>
        {canEdit && selected && (
          <button className="btn-primary" onClick={saveClient}>
            <Check className="w-4 h-4" /> Enregistrer les rappels de {selected.name}
          </button>
        )}
      </>);

  return (
    <Modal open onClose={onClose} icon={Settings2} size="xl" formScale fullHeight
      title="Délais de rappel"
      subtitle="Un délai pour toute la partie, ou un délai propre à chaque véhicule"
      footer={footer}>
      <div className="space-y-4">
        <Tabs active={tab} onChange={t => setTab(t as 'client' | 'defaut')} tabs={[
          { id: 'client', label: 'Par client / véhicule', icon: Car },
          { id: 'defaut', label: 'Réglage par défaut', icon: Settings2 },
        ]} />

        {/* ── PAR CLIENT / VÉHICULE ─────────────────────────────────────────── */}
        {tab === 'client' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2">
              <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                Chercher un client
              </p>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input className="input-field pl-9" placeholder="Nom ou téléphone du client…"
                  value={query} onChange={e => setQuery(e.target.value)} />
              </div>

              {query.trim() && results.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white max-h-56 overflow-y-auto custom-scrollbar">
                  {results.map((c: BizContact) => (
                    <button key={c.id} type="button"
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-0"
                      onClick={() => pickClient(c)}>
                      <span className="text-sm font-bold text-slate-700">{c.name}</span>
                      {c.phone && <span className="text-[11px] font-semibold text-slate-400 ml-2">{c.phone}</span>}
                      <span className="ml-2 text-[10px] font-black uppercase tracking-wider text-blue-500">
                        {(c.cars?.length || 0)} véhicule{(c.cars?.length || 0) > 1 ? 's' : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {query.trim() && results.length === 0 && (
                <p className="text-[11px] font-semibold text-slate-400 italic px-1">Aucun client trouvé.</p>
              )}
            </div>

            {!selected ? (
              <EmptyState icon={Users} title="Aucun client sélectionné"
                message="Cherchez un client ci-dessus pour régler le rappel de chacun de ses véhicules." />
            ) : (
              <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-700 truncate">{selected.name}</p>
                    <p className="text-[11px] font-semibold text-slate-400 truncate">
                      {selected.phone || 'Aucun téléphone'}
                      {` • ${draftCars.length} véhicule${draftCars.length > 1 ? 's' : ''}`}
                    </p>
                  </div>
                  <button type="button" className="p-1.5 rounded-lg text-slate-400 hover:bg-white"
                    onClick={() => { setSelected(null); setDraftCars([]); }} title="Changer de client">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {draftCars.length === 0 ? (
                  <p className="text-xs text-blue-900/60 italic py-1">
                    Ce client n'a aucun véhicule enregistré. Ajoutez-en depuis sa fiche (écran Clients).
                  </p>
                ) : (
                  <div className="space-y-2">
                    {draftCars.map((v: BizCar) => {
                      const overridden = typeof v.rappelLavageDays === 'number' || typeof v.rappelReparationDays === 'number';
                      return (
                        <div key={v.id} className="rounded-xl bg-white border border-blue-200 p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] font-black text-slate-700 flex items-center gap-1.5 min-w-0">
                              <Car className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                              <span className="truncate">{carLabel(v) || 'Véhicule'}</span>
                            </p>
                            {overridden && (
                              <button type="button" className="text-[10px] font-black text-slate-400 hover:text-red-600 shrink-0 flex items-center gap-1"
                                onClick={() => resetCar(v.id!)} title="Revenir au délai de la partie">
                                <RefreshCcw className="w-3 h-3" /> Défaut
                              </button>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Lavage (jours)</label>
                              <Input type="number" min={0} inputMode="numeric" className="text-right"
                                placeholder={`Défaut : ${config.lavageDays} j`}
                                value={v.rappelLavageDays ?? ''}
                                onChange={e => patchCarDays(v.id!, 'rappelLavageDays', e.target.value)} />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Vidange (jours)</label>
                              <Input type="number" min={0} inputMode="numeric" className="text-right"
                                placeholder={`Défaut : ${config.reparationDays} j`}
                                value={v.rappelReparationDays ?? ''}
                                onChange={e => patchCarDays(v.id!, 'rappelReparationDays', e.target.value)} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <p className="text-[11px] font-semibold text-blue-900/60 leading-relaxed">
                      Vide = le véhicule suit le délai par défaut de la partie. <strong>0</strong> = ce véhicule
                      ne reçoit aucun rappel de cette nature. N'oubliez pas d'enregistrer.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── RÉGLAGE PAR DÉFAUT ────────────────────────────────────────────── */}
        {tab === 'defaut' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
              <div>
                <p className="text-sm font-bold text-slate-700">Rappels actifs</p>
                <p className="text-xs text-slate-400">Coupe toutes les alertes sans perdre les délais réglés</p>
              </div>
              <Switch checked={enabled} onChange={setEnabled} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Rappeler un LAVAGE après (jours)"
                hint="0 = aucun rappel de lavage. Un mois (30) convient à la plupart des clients.">
                <Input type="number" min={0} inputMode="numeric" className="text-right"
                  value={lavage} onChange={e => setLavage(e.target.value)} />
              </Field>
              <Field label="Rappeler une VIDANGE après (jours)"
                hint="0 = aucun rappel de vidange. Six mois (180) correspond à une révision.">
                <Input type="number" min={0} inputMode="numeric" className="text-right"
                  value={reparation} onChange={e => setReparation(e.target.value)} />
              </Field>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">Comment c'est calculé</p>
              <p className="text-[11px] font-semibold text-slate-500 leading-relaxed">
                L'échéance part du <strong>dernier passage</strong> de chaque véhicule, pour chaque
                nature. Ce délai par défaut s'applique à tout véhicule qui n'a pas son délai propre
                (onglet « Par client / véhicule »). Un client qui lave sa voiture toutes les semaines
                ne reçoit qu'un seul rappel — celui de sa dernière visite. Une alerte classée ou
                envoyée ne revient plus ; une nouvelle visite en recrée une, à la nouvelle échéance.
              </p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Les modèles ───────────────────────────────────────────────────────────────

function TemplateModal({ initial, onClose, onSave }: {
  initial: BizMessageTemplate | null; onClose: () => void; onSave: (t: BizMessageTemplate) => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [usage, setUsage] = useState<'lavage' | 'reparation' | 'libre'>(initial?.usage || 'libre');
  const [body, setBody] = useState(initial?.body || '');

  const insert = (token: string) => setBody(b => `${b}${b && !b.endsWith(' ') && !b.endsWith('\n') ? ' ' : ''}${token}`);

  return (
    <Modal open onClose={onClose} icon={FileText} size="xl" formScale
      title={initial ? 'Modifier le modèle' : 'Nouveau modèle de message'}
      subtitle="Les jetons entre accolades sont remplis à l'envoi"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" disabled={!name.trim() || !body.trim()}
          onClick={() => onSave({
            id: initial?.id || newId(),
            name: name.trim(), body, usage,
            createdAt: initial?.createdAt || new Date().toISOString(),
            createdBy: initial?.createdBy,
          })}>{initial ? 'Enregistrer' : 'Créer'}</button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Nom du modèle" required>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Rappel de lavage" />
          </Field>
          <Field label="Proposé pour" hint="Un modèle « libre » est toujours proposé.">
            <Select value={usage} onChange={e => setUsage(e.target.value as any)}>
              <option value="libre">Message libre</option>
              <option value="lavage">Rappel de lavage</option>
              <option value="reparation">Rappel de vidange</option>
            </Select>
          </Field>
        </div>

        <Field label="Texte du message" required>
          <Textarea rows={10} value={body} onChange={e => setBody(e.target.value)}
            placeholder="Bonjour {client}, …" />
        </Field>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2">
          <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">
            Jetons disponibles — cliquez pour insérer
          </p>
          <div className="flex flex-wrap gap-1.5">
            {MESSAGE_TOKENS.map(t => (
              <button key={t.token} type="button" title={t.label} onClick={() => insert(t.token)}
                className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-mono font-bold text-[#002d87] hover:border-blue-300">
                {t.token}
              </button>
            ))}
          </div>
          <p className="text-[11px] font-semibold text-slate-400 leading-relaxed">
            Un jeton dont la valeur est inconnue disparaît du texte final. Un jeton MAL ORTHOGRAPHIÉ,
            lui, reste visible tel quel — c'est voulu : mieux vaut le voir à la relecture que
            d'envoyer une phrase amputée.
          </p>
        </div>
      </div>
    </Modal>
  );
}

// ─── La composition et l'envoi ─────────────────────────────────────────────────

function ComposeModal({ drafts, clients, templates, varsFor, sending, onChange, onClose, onSend }: {
  drafts: Draft[];
  clients: BizContact[];
  templates: BizMessageTemplate[];
  varsFor: (clientName: string, car: BizCar | undefined, lastVisit?: string, kind?: 'lavage' | 'reparation') => MessageVars;
  sending: boolean;
  onChange: (d: Draft[]) => void;
  onClose: () => void;
  onSend: (d: Draft[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState<BizContact | null>(null);

  const results: BizContact[] = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return clients.filter((c: BizContact) => matchesSearch(q, c.name, c.phone)).slice(0, 20);
  }, [clients, query]);

  /** Ajoute un destinataire : un client, et un de ses véhicules (ou aucun). */
  const addDraft = (client: BizContact, car?: BizCar) => {
    const key = `${client.id}:${car?.id || 'none'}`;
    if (drafts.some(d => d.key === key)) { toast('Ce destinataire est déjà dans la liste.'); return; }
    onChange([...drafts, {
      key,
      clientId: client.id,
      clientName: client.name,
      phone: client.phone || '',
      car,
      carText: carLabel(car) || '',
      body: '',
      kind: 'libre',
    }]);
    setPicking(null);
    setQuery('');
  };

  const patch = (key: string, next: Partial<Draft>) =>
    onChange(drafts.map(d => (d.key === key ? { ...d, ...next } : d)));

  /** Applique un modèle à TOUS les destinataires, chacun avec SES valeurs. */
  const applyTemplate = (tplId: string) => {
    const tpl = templates.find((t: BizMessageTemplate) => t.id === tplId);
    if (!tpl) return;
    onChange(drafts.map(d => ({
      ...d,
      body: renderTemplate(tpl.body, varsFor(d.clientName, d.car, d.lastVisit, d.rappelKind)),
    })));
  };

  const usable = drafts.filter(d => normalizePhone(d.phone) && d.body.trim());
  const invalidPhones = drafts.filter(d => !normalizePhone(d.phone));

  return (
    <Modal open onClose={onClose} icon={Send} size="3xl" formScale fullHeight
      title={drafts.length > 1 ? `Envoyer à ${drafts.length} clients` : 'Nouveau message'}
      subtitle="Les textes sont modifiables avant l'envoi"
      footer={<>
        <button className="btn-ghost" onClick={onClose} disabled={sending}>Annuler</button>
        <button className="btn-primary" disabled={sending || usable.length === 0}
          onClick={() => onSend(drafts)}>
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {sending ? 'Envoi…' : `Envoyer (${usable.length})`}
        </button>
      </>}>
      <div className="space-y-4">
        {/* ── Ajouter un destinataire ──────────────────────────────────── */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2">
          <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">
            Ajouter un destinataire
          </p>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input className="input-field pl-9" placeholder="Nom ou téléphone du client…"
              value={query} onChange={e => { setQuery(e.target.value); setPicking(null); }} />
          </div>

          {!picking && results.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white max-h-48 overflow-y-auto custom-scrollbar">
              {results.map((c: BizContact) => (
                <button key={c.id} type="button"
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-0"
                  onClick={() => ((c.cars || []).length > 0 ? setPicking(c) : addDraft(c))}>
                  <span className="text-sm font-bold text-slate-700">{c.name}</span>
                  {c.phone && <span className="text-[11px] font-semibold text-slate-400 ml-2">{c.phone}</span>}
                  {(c.cars?.length || 0) > 0 && (
                    <span className="ml-2 text-[10px] font-black uppercase tracking-wider text-blue-500">
                      {c.cars!.length} véhicule{c.cars!.length > 1 ? 's' : ''}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Plusieurs voitures : on demande LAQUELLE, parce que le message
              porte ses informations. */}
          {picking && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-black uppercase tracking-wider text-blue-800">
                  Quel véhicule de {picking.name} ?
                </p>
                <button type="button" className="p-1 rounded-lg text-slate-400 hover:bg-white"
                  onClick={() => setPicking(null)}><X className="w-3.5 h-3.5" /></button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(picking.cars || []).map((v: BizCar) => (
                  <button key={v.id} type="button" onClick={() => addDraft(picking, v)}
                    className="text-left rounded-xl bg-white border border-blue-200 px-3 py-2 hover:border-blue-400">
                    <p className="text-sm font-bold text-slate-700 truncate">{carLabel(v) || 'Véhicule'}</p>
                    <p className="text-[11px] font-semibold text-slate-400 truncate">
                      {[v.color, v.year].filter(Boolean).join(' • ') || '—'}
                      {v.kilometrage ? ` • ${v.kilometrage.toLocaleString('fr-FR')} km` : ''}
                    </p>
                  </button>
                ))}
              </div>
              <button type="button" className="text-[11px] font-black text-blue-600 hover:underline"
                onClick={() => addDraft(picking)}>
                Écrire sans préciser de véhicule
              </button>
            </div>
          )}
        </div>

        {/* ── Le modèle appliqué à tous ────────────────────────────────── */}
        {drafts.length > 0 && templates.length > 0 && (
          <Field label="Partir d'un modèle" hint="Chaque destinataire reçoit le texte rempli avec SES informations. Vous pouvez ensuite retoucher chaque message.">
            <Select defaultValue="" onChange={e => { if (e.target.value) applyTemplate(e.target.value); }}>
              <option value="">— Écrire librement —</option>
              {templates.map((t: BizMessageTemplate) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </Field>
        )}

        {invalidPhones.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-[11px] font-bold text-amber-800 leading-relaxed">
              <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
              {invalidPhones.length} destinataire(s) sans numéro utilisable : ils ne seront pas
              envoyés. Corrigez le téléphone sur leur fiche client.
            </p>
          </div>
        )}

        {/* ── Les messages, un par destinataire ────────────────────────── */}
        {drafts.length === 0 ? (
          <EmptyState icon={Users} title="Aucun destinataire"
            message="Cherchez un client ci-dessus pour commencer." />
        ) : (
          <div className="space-y-3">
            {drafts.map((d: Draft) => {
              const phoneOk = !!normalizePhone(d.phone);
              const leftovers = missingTokens(d.body);
              return (
                <div key={d.key} className={`rounded-2xl border p-4 space-y-2 ${phoneOk ? 'border-slate-200 bg-white' : 'border-amber-200 bg-amber-50/40'}`}>
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-700 truncate">{d.clientName}</p>
                      <p className="text-[11px] font-semibold text-slate-400 truncate">
                        {phoneOk ? displayPhone(normalizePhone(d.phone)!) : (d.phone || 'Aucun téléphone')}
                        {d.carText ? ` • ${d.carText}` : ''}
                      </p>
                    </div>
                    <button type="button" className="p-1.5 rounded-lg text-red-500 hover:bg-red-50" title="Retirer"
                      onClick={() => onChange(drafts.filter(x => x.key !== d.key))}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {!phoneOk && (
                    <Field label="Téléphone">
                      <Input value={d.phone} onChange={e => patch(d.key, { phone: e.target.value })}
                        placeholder="0550 00 00 00" />
                    </Field>
                  )}
                  <Textarea rows={6} value={d.body} onChange={e => patch(d.key, { body: e.target.value })}
                    placeholder="Votre message…" />
                  {leftovers.length > 0 && (
                    <p className="text-[11px] font-bold text-amber-700">
                      Jetons non remplacés : {leftovers.join(', ')} — vérifiez leur orthographe.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className="text-[11px] font-semibold text-slate-400 leading-relaxed">
          Les envois groupés sont <strong>volontairement temporisés</strong> (quelques secondes entre
          chaque destinataire) : écrire vite et à beaucoup de monde fait bannir le numéro, et un
          numéro banni l'est sans recours. Si la passerelle est éteinte, les messages sont
          <strong> mis en attente</strong> et repartent seuls — ce n'est pas un échec.
        </p>
      </div>
    </Modal>
  );
}
