/**
 * ─── Écran « Retours clients » d'une partie ────────────────────────────────────
 *
 * Le même tableau de bord sert les trois parties (Carburant, Cafétéria, Lavage) :
 * seul l'avis affiché change. Chaque avis est une carte datée avec le nom du
 * client, ses coordonnées, son message, et trois décisions. Le nom et le
 * téléphone sont FACULTATIFS sur la page publique : un avis peut arriver
 * anonyme, et l'écran doit le dire clairement plutôt que d'afficher un vide.
 *
 *   • MARQUER COMME LU — c'est ce geste, et lui seul, qui éteint la pastille
 *     rouge de la barre latérale. Un avis reste « nouveau » tant que personne
 *     ne l'a explicitement traité : ouvrir la page ne suffit pas, sinon un
 *     simple passage effacerait l'alerte sans que le message soit lu.
 *   • VOIR LE DÉTAIL — le message entier, les coordonnées cliquables (appeler,
 *     écrire) et l'historique de traitement.
 *   • SUPPRIMER — définitif, avec confirmation.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  MessageSquare, Mail, Phone, User, UserX, Trash2, Eye, Check, CheckCheck, Undo2,
  Clock, Inbox, CalendarDays, MailOpen,
} from 'lucide-react';
import { ClientFeedback, FeedbackPart, FEEDBACK_PART_META, feedbackAuthor } from '@/src/lib/feedbacks';
import { matchesSearch } from '@/src/lib/utils';
import { useFeedbacks, usePartFeedbacks } from '@/src/store/FeedbackContext';
import { useAppState } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, Badge, SearchInput, ViewToggle, CardGrid, GlassCard, Table, EmptyState,
  RowActions, ActionBtn, Confirm, Modal, formatDate, formatDateTime,
  PeriodFilter, Period, inPeriod,
} from '@/src/components/biz/Kit';

type StatusFilter = 'all' | 'unread' | 'read';

export interface FeedbacksBoardProps {
  part: FeedbackPart;
  /** Sous-titre de l'en-tête — le nom de la partie tel qu'elle s'appelle chez elle. */
  subtitle?: string;
  /** Marquer lu / non lu. */
  canModify?: boolean;
  canDelete?: boolean;
}

export default function FeedbacksBoard({
  part, subtitle, canModify = true, canDelete = true,
}: FeedbacksBoardProps) {
  const meta = FEEDBACK_PART_META[part];
  const { loading, tableMissing, markRead, markUnread, markAllRead, remove } = useFeedbacks();
  const feedbacks = usePartFeedbacks(part);
  const { currentUserName } = useAppState();

  const [search, setSearch] = useState('');
  // Tableau par défaut : une boîte d'avis se dépouille en lignes — qui, quand,
  // lu ou non. Les cartes, où le message se lit en entier, restent à un clic.
  const [view, setView] = useState<'grid' | 'table'>('table');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [detail, setDetail] = useState<ClientFeedback | null>(null);
  const [toDelete, setToDelete] = useState<ClientFeedback | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const stats = useMemo(() => {
    const unread = feedbacks.filter(f => f.status === 'unread').length;
    const thisMonth = feedbacks.filter(f => inPeriod(f.createdAt, 'month')).length;
    return { total: feedbacks.length, unread, read: feedbacks.length - unread, thisMonth };
  }, [feedbacks]);

  const filtered = useMemo(() => feedbacks.filter(f => {
    const matchQ = matchesSearch(search, f.fullName, f.phone, f.email, f.message);
    return matchQ && (status === 'all' || f.status === status) && inPeriod(f.createdAt, period, from, to);
  }), [feedbacks, search, status, period, from, to]);

  const doMarkRead = async (f: ClientFeedback) => {
    const res = await markRead(f.id, currentUserName || undefined);
    if (res.ok) toast.success(`Avis de ${feedbackAuthor(f)} marqué comme lu`);
    else toast.error(res.error || 'Impossible de marquer cet avis');
  };

  const doMarkUnread = async (f: ClientFeedback) => {
    const res = await markUnread(f.id);
    if (res.ok) toast.success('Avis remis en « nouveau »');
    else toast.error(res.error || 'Impossible de marquer cet avis');
  };

  const doMarkAll = async () => {
    setConfirmAll(false);
    const res = await markAllRead(part, currentUserName || undefined);
    if (res.ok) toast.success(`${stats.unread} avis marqué(s) comme lu(s)`);
    else toast.error(res.error || 'Impossible de marquer les avis');
  };

  const doDelete = async () => {
    if (!toDelete) return;
    const target = toDelete;
    setToDelete(null);
    if (detail?.id === target.id) setDetail(null);
    const res = await remove(target.id);
    if (res.ok) toast.success('Avis supprimé');
    else toast.error(res.error || 'Suppression impossible');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        icon={MessageSquare}
        title="Retours clients"
        subtitle={subtitle ? `${subtitle} — avis déposés par les clients` : 'Avis déposés par les clients'}
        actions={canModify && stats.unread > 0 ? (
          <button onClick={() => setConfirmAll(true)}
            className="h-11 px-4 rounded-xl font-black text-sm text-white flex items-center gap-2 transition-transform active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #059669, #10b981)', boxShadow: '0 4px 14px rgba(16,185,129,0.35)' }}
            title="Marquer tous les avis non lus comme lus">
            <CheckCheck className="w-4 h-4" /> Tout marquer lu ({stats.unread})
          </button>
        ) : undefined}
      />

      {/* Alerte — des avis n'ont encore été lus par personne. */}
      {stats.unread > 0 && (
        <div className="rounded-2xl p-4 flex flex-wrap items-center gap-3"
          style={{ background: 'linear-gradient(135deg, #b45309, #f59e0b)', boxShadow: '0 8px 24px rgba(245,158,11,0.28)' }}>
          <span className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <MessageSquare className="w-5 h-5 text-white animate-pulse" />
          </span>
          <div className="min-w-0">
            <p className="font-black text-white">
              {stats.unread} nouvel{stats.unread > 1 ? 'x' : ''} avis client{stats.unread > 1 ? 's' : ''} non lu{stats.unread > 1 ? 's' : ''}
            </p>
            <p className="text-[12px] text-amber-50">
              La pastille rouge reste affichée dans le menu tant qu'un avis n'a pas été marqué comme lu.
            </p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2 shrink-0">
            <button onClick={() => setStatus('unread')}
              className="text-xs font-black text-white bg-white/20 hover:bg-white/30 rounded-lg px-3 py-2 transition-colors">
              Voir les nouveaux
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Inbox}        label="Non lus"      value={stats.unread}    tone="red" />
        <StatCard icon={MailOpen}     label="Lus"          value={stats.read}      tone="green" />
        <StatCard icon={MessageSquare} label="Total reçus" value={stats.total}     tone="blue" />
        <StatCard icon={CalendarDays} label="Ce mois"      value={stats.thisMonth} tone="purple" />
      </div>

      <div className="card-glass p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Nom, téléphone, e-mail, message…" />
          <div className="flex flex-wrap gap-1.5">
            {(['all', 'unread', 'read'] as StatusFilter[]).map(s => {
              const n = s === 'all' ? feedbacks.length : feedbacks.filter(f => f.status === s).length;
              const label = s === 'all' ? 'Tous' : s === 'unread' ? 'Non lus' : 'Lus';
              return (
                <button key={s} onClick={() => setStatus(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
                    status === s ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                  {label}
                  <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black tabular-nums ${
                    status === s ? 'bg-white/20' : (s === 'unread' && n > 0 ? 'bg-red-500 text-white' : 'bg-white text-slate-400')}`}>
                    {n}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="ml-auto"><ViewToggle view={view} onChange={setView} /></div>
        </div>
        <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title={loading ? 'Chargement des avis…' : feedbacks.length === 0 ? 'Aucun avis pour le moment' : 'Aucun avis ne correspond'}
          message={
            tableMissing
              ? "Le service de retours n'est pas encore activé sur cette base : exécutez la migration supabase/migrations/2026-08-14_client_feedbacks.sql."
              : feedbacks.length === 0
                ? `Les clients déposent leur avis depuis la page publique /client, en choisissant « ${meta.label} ».`
                : 'Changez de filtre ou de période pour retrouver un avis.'
          }
        />
      ) : view === 'table' ? (
        <Table head={<>
          <th className="table-head">Client</th><th className="table-head">Contact</th>
          <th className="table-head">Message</th><th className="table-head">Reçu le</th>
          <th className="table-head">État</th><th className="table-head text-right">Actions</th>
        </>}>
          {filtered.map(f => {
            const isNew = f.status === 'unread';
            return (
              <tr key={f.id} className={isNew ? 'bg-amber-50/60' : undefined}>
                <td className={`table-cell font-bold ${f.fullName ? 'text-slate-700' : 'text-slate-400 italic'}`}>
                  {feedbackAuthor(f)}
                </td>
                <td className="table-cell whitespace-nowrap text-slate-500">
                  <div>{f.phone || 'Sans téléphone'}</div>
                  {f.email && <div className="text-[11px] truncate max-w-[200px]" title={f.email}>{f.email}</div>}
                </td>
                <td className="table-cell">
                  <button onClick={() => setDetail(f)}
                    className="text-left max-w-[380px] text-slate-600 line-clamp-2 whitespace-pre-line hover:text-[#003087]"
                    title="Voir le détail">
                    {f.message}
                  </button>
                </td>
                <td className="table-cell whitespace-nowrap text-slate-500">
                  {formatDateTime(f.createdAt)}
                  {f.readAt && <div className="text-[11px] text-emerald-600">Lu par {f.readBy || "l'équipe"}</div>}
                </td>
                <td className="table-cell"><Badge tone={isNew ? 'warning' : 'success'}>{isNew ? 'Nouveau' : 'Lu'}</Badge></td>
                <td className="table-cell text-right">
                  <RowActions>
                    <ActionBtn icon={Eye} tone="blue" title="Voir le détail" onClick={() => setDetail(f)} />
                    {isNew && canModify && (
                      <ActionBtn icon={Check} tone="green" title="Marquer comme lu — l'alerte du menu se décrémente" onClick={() => doMarkRead(f)} />
                    )}
                    {!isNew && canModify && (
                      <ActionBtn icon={Undo2} tone="amber" title="Remettre en non lu" onClick={() => doMarkUnread(f)} />
                    )}
                    {canDelete && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(f)} />}
                  </RowActions>
                </td>
              </tr>
            );
          })}
        </Table>
      ) : (
        <CardGrid>
          {filtered.map(f => (
            <FeedbackCard
              key={f.id} feedback={f}
              canModify={canModify} canDelete={canDelete}
              onOpen={() => setDetail(f)}
              onRead={() => doMarkRead(f)}
              onUnread={() => doMarkUnread(f)}
              onDelete={() => setToDelete(f)}
            />
          ))}
        </CardGrid>
      )}

      {detail && (
        <FeedbackDetail
          feedback={detail}
          canModify={canModify} canDelete={canDelete}
          onClose={() => setDetail(null)}
          onRead={() => doMarkRead(detail)}
          onUnread={() => doMarkUnread(detail)}
          onDelete={() => setToDelete(detail)}
        />
      )}

      <Confirm
        open={!!toDelete}
        title="Supprimer cet avis"
        message={`Supprimer définitivement l'avis de ${toDelete ? feedbackAuthor(toDelete) : ''} ? Cette action est irréversible.`}
        onConfirm={doDelete} onCancel={() => setToDelete(null)}
      />
      <Confirm
        open={confirmAll} danger={false} confirmLabel="Tout marquer lu"
        title="Marquer tous les avis comme lus"
        message={`Marquer les ${stats.unread} avis non lus de « ${meta.label} » comme lus ? L'alerte du menu disparaîtra.`}
        onConfirm={doMarkAll} onCancel={() => setConfirmAll(false)}
      />
    </div>
  );
}

// ─── Carte d'un avis ──────────────────────────────────────────────────────────
function FeedbackCard({
  feedback: f, canModify, canDelete, onOpen, onRead, onUnread, onDelete,
}: {
  feedback: ClientFeedback; canModify: boolean; canDelete: boolean;
  onOpen: () => void; onRead: () => void; onUnread: () => void; onDelete: () => void;
  // Déclaré comme dans le kit (`Kit.tsx`) : ces types React n'acceptent `key`
  // sur un composant que s'il fait partie de ses props.
  key?: React.Key;
}) {
  const isNew = f.status === 'unread';
  return (
    <GlassCard className={isNew ? '!border-amber-300 ring-1 ring-amber-200' : undefined}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {/* Nom et téléphone sont facultatifs sur la page publique : un avis
              anonyme se présente comme tel plutôt que d'afficher un vide. */}
          <h3 className={`font-black truncate flex items-center gap-1.5 ${f.fullName ? 'text-slate-800' : 'text-slate-400 italic'}`}>
            <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />{feedbackAuthor(f)}
          </h3>
          {f.phone ? (
            <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
              <Phone className="w-3 h-3" />{f.phone}
            </p>
          ) : (
            <p className="text-xs text-slate-300 flex items-center gap-1 mt-0.5 italic">
              <Phone className="w-3 h-3" />Sans téléphone
            </p>
          )}
        </div>
        <Badge tone={isNew ? 'warning' : 'success'}>{isNew ? 'Nouveau' : 'Lu'}</Badge>
      </div>

      {f.email && (
        <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1 truncate">
          <Mail className="w-3 h-3 shrink-0" />{f.email}
        </p>
      )}

      {/* Le message, coupé à quatre lignes : le détail montre tout. */}
      <p className="text-sm text-slate-600 mt-3 leading-relaxed line-clamp-4 whitespace-pre-line">
        {f.message}
      </p>

      <p className="text-[11px] text-slate-400 mt-3 flex items-center gap-1">
        <Clock className="w-3 h-3" />{formatDateTime(f.createdAt)}
        {f.readAt && <> • lu par {f.readBy || 'l\'équipe'} le {formatDate(f.readAt)}</>}
      </p>

      <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
        {isNew && canModify && (
          <button
            className="w-full h-10 rounded-xl font-black text-sm text-white flex items-center justify-center gap-1.5 transition-transform active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #059669, #10b981)', boxShadow: '0 4px 12px rgba(16,185,129,0.35)' }}
            onClick={onRead}
            title="Marquer comme lu — l'alerte du menu se décrémente">
            <Check className="w-4 h-4" /> Marquer comme lu
          </button>
        )}
        <div className="flex items-center justify-between">
          <button onClick={onOpen}
            className="text-xs font-black text-[#003087] hover:text-[#001f5c] flex items-center gap-1.5 transition-colors">
            <Eye className="w-4 h-4" /> Voir le détail
          </button>
          <RowActions>
            {!isNew && canModify && (
              <ActionBtn icon={Undo2} tone="amber" title="Remettre en non lu" onClick={onUnread} />
            )}
            {canDelete && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={onDelete} />}
          </RowActions>
        </div>
      </div>
    </GlassCard>
  );
}

// ─── Détail d'un avis ─────────────────────────────────────────────────────────
function FeedbackDetail({
  feedback: f, canModify, canDelete, onClose, onRead, onUnread, onDelete,
}: {
  feedback: ClientFeedback; canModify: boolean; canDelete: boolean;
  onClose: () => void; onRead: () => void; onUnread: () => void; onDelete: () => void;
}) {
  const isNew = f.status === 'unread';
  const meta = FEEDBACK_PART_META[f.part];

  return (
    <Modal
      open onClose={onClose} icon={MessageSquare} size="lg"
      title={f.fullName ? `Avis de ${f.fullName}` : 'Avis anonyme'}
      subtitle={`${meta.emoji} ${meta.label} — reçu le ${formatDateTime(f.createdAt)}`}
      footer={<>
        {canDelete && (
          <button className="btn-ghost !text-red-600" onClick={onDelete}>
            <Trash2 className="w-4 h-4" /> Supprimer
          </button>
        )}
        {canModify && (isNew
          ? <button className="btn-primary" onClick={() => { onRead(); onClose(); }}>
              <Check className="w-4 h-4" /> Marquer comme lu
            </button>
          : <button className="btn-ghost" onClick={() => { onUnread(); onClose(); }}>
              <Undo2 className="w-4 h-4" /> Remettre en non lu
            </button>
        )}
      </>}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={isNew ? 'warning' : 'success'}>{isNew ? 'Nouveau — non lu' : 'Lu'}</Badge>
          <Badge tone="info">{meta.label}</Badge>
        </div>

        {/* Coordonnées — cliquables quand elles existent : rappeler un client ne
            doit pas demander de recopier. Les trois champs sont facultatifs sur
            la page publique, d'où la tuile « Non communiqué » plutôt qu'un trou. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ContactTile icon={User} label="Nom" value={f.fullName || 'Non communiqué'} muted={!f.fullName} />
          {f.phone
            ? <ContactTile icon={Phone} label="Téléphone" value={f.phone} href={`tel:${f.phone.replace(/\s/g, '')}`} />
            : <ContactTile icon={Phone} label="Téléphone" value="Non communiqué" muted />}
          {f.email
            ? <ContactTile icon={Mail} label="E-mail" value={f.email} href={`mailto:${f.email}`} />
            : <ContactTile icon={Mail} label="E-mail" value="Non communiqué" muted />}
        </div>

        {!f.phone && !f.email && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-start gap-2.5">
            <UserX className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800 font-semibold">
              Avis déposé anonymement — aucune coordonnée pour répondre à ce client.
            </p>
          </div>
        )}

        <div>
          <p className="label-field">Message du client</p>
          <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{f.message}</p>
          </div>
        </div>

        <div className="rounded-xl bg-[#001f5c] text-white p-3 space-y-1">
          <p className="text-[11px] text-blue-200 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> Déposé le {formatDateTime(f.createdAt)}
          </p>
          {f.readAt && (
            <p className="text-[11px] text-blue-200 flex items-center gap-1.5">
              <MailOpen className="w-3.5 h-3.5" /> Lu le {formatDateTime(f.readAt)}
              {f.readBy ? ` par ${f.readBy}` : ''}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ContactTile({
  icon: Icon, label, value, href, muted,
}: { icon: React.ElementType; label: string; value: string; href?: string; muted?: boolean }) {
  const body = (
    <>
      <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${muted ? 'bg-slate-100' : 'bg-[#eef3fc]'}`}>
        <Icon className={`w-4 h-4 ${muted ? 'text-slate-300' : 'text-[#003087]'}`} />
      </span>
      <span className="min-w-0">
        <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</span>
        <span className={`block text-sm truncate ${muted ? 'text-slate-400 italic font-semibold' : 'font-bold text-slate-700'}`}>{value}</span>
      </span>
    </>
  );
  const className = 'flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3';
  return href
    ? <a href={href} className={`${className} hover:border-[#003087]/40 transition-colors`}>{body}</a>
    : <div className={className}>{body}</div>;
}
