import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  Users, Plus, Phone, MapPin, History, TrendingUp, CircleDollarSign,
  FileBarChart, Receipt, Eye, Car, IdCard, ShoppingBag,
  AlertTriangle, DollarSign, MoreVertical, Search, X, Flag, Wallet,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'react-hot-toast';
import { ModuleKey, MODULES, BizContact, BizCar, BizDocPayment, BizReparation, BizSale, carLabel } from '@/src/lib/bizConfig';
import { matchesSearch, cn } from '@/src/lib/utils';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission, useAppState } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, EmptyState, ViewToggle, Table, Badge, RowActions, ActionBtn,
  Edit2, Trash2, Confirm, money, formatDate,
} from '@/src/components/biz/Kit';
import { printFiche } from '@/src/components/biz/ReportFiche';
import { ClientStatementFiche } from '@/src/components/biz/ClientStatementFiche';
import ClientReportModal from '@/src/components/biz/ClientReportModal';
import ClientDossier, { DossierGroup, DossierSection } from '@/src/components/clients/ClientDossier';
import { bizClientStatement, ClientStatement, StatementPayment } from '@/src/lib/clientStatement';
import { clientOpening } from '@/src/lib/clientLedger';
import {
  ContactModal, PayDebtModal, PayDebtMeta, PAY_MODES, withPayment,
  printPaymentReceipt, stationFromSettings,
} from './_shared';
import { Modal, Field, Input, Select } from '@/src/components/biz/Kit';
import { newId } from '@/src/lib/utils';

const shortDate = (s: string) => {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR');
};

export default function ModuleClients({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'clients');
  const { settings, currentUserName } = useAppState();
  const { clients } = biz.state;

  const [search, setSearch] = useState('');
  // Tableau par défaut : un fichier client se balaie en lignes — nom, téléphone,
  // achats, règlements, reste dû. Les cartes restent à un clic.
  const [view, setView] = useState<'grid' | 'table'>('table');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BizContact | null>(null);
  /** Le client dont le dossier est ouvert, et la rubrique par laquelle entrer. */
  const [dossier, setDossier] = useState<{ client: BizContact; section: string } | null>(null);
  const [report, setReport] = useState<BizContact | null>(null);
  const [toDelete, setToDelete] = useState<BizContact | null>(null);
  /** Le client dont on encaisse la dette, et le menu d'actions ouvert. */
  const [paying, setPaying] = useState<BizContact | null>(null);
  const [actionMenuOpen, setActionMenuOpen] = useState<string | null>(null);

  // Le menu d'une carte se ferme dès qu'on clique ailleurs — même règle que
  // l'écran Clients du Carburant.
  useEffect(() => {
    const close = () => setActionMenuOpen(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const filtered = clients.filter((c: BizContact) => matchesSearch(search, c.name, c.phone, c.address));

  /**
   * Le compte COMPLET de chaque client — toutes ses ventes et toutes ses
   * interventions, depuis toujours. Les bornes de période sont laissées vides :
   * les cartes et le dossier montrent la vie entière du compte, et c'est le
   * rapport imprimable qui, seul, se restreint à une période.
   */
  const statements = useMemo(() => {
    const out: Record<string, ClientStatement> = {};
    for (const c of clients) out[c.id] = bizClientStatement(biz.state, c, cfg.label);
    return out;
  }, [biz.state, clients, cfg.label]);

  const del = () => {
    if (toDelete) { biz.remove('clients', toDelete.id); toast.success('Client supprimé'); setToDelete(null); }
  };

  /**
   * ─── Encaisser la dette d'un client de partie ───────────────────────
   *
   * L'écran ne savait pas encaisser : il fallait retrouver la facture dans
   * « Ventes » ou l'intervention dans « Vidanges », une par une, pour solder un
   * client qui venait payer TOUT ce qu'il devait. Le règlement est donc réparti
   * sur ses documents non soldés, du PLUS ANCIEN au plus récent — la règle
   * comptable habituelle.
   *
   * Chaque document reçoit un versement DATÉ (`withPayment`) : le compte du
   * client montre le règlement au jour où il a été encaissé, et la caisse de la
   * partie le compte ce jour-là (`docPaymentSlices`, `lib/bizReporting`) — pas à
   * la date de la facture qu'il solde.
   */
  const settleDebt = async (client: BizContact, amount: number, meta: PayDebtMeta) => {
    let left = amount;
    const byDate = (a: { date: string }, b: { date: string }) =>
      new Date(a.date).getTime() - new Date(b.date).getTime();
    const stamp = () => `${meta.date}T${new Date().toTimeString().slice(0, 8)}`;

    const openSales = (biz.state.sales || [])
      .filter((x: BizSale) => x.clientId === client.id && Number(x.rest) > 0
        && x.status !== 'retournée' && x.status !== 'échangée')
      .sort(byDate);
    const openReps = (biz.state.reparations || [])
      .filter((r: BizReparation) => r.clientId === client.id && Number(r.rest) > 0 && r.status !== 'canceled')
      .sort(byDate);

    let settled = 0;
    // Les deux journaux du client vivent sur SA fiche (`openingPayments`,
    // `advancePayments`) : on les accumule ici pour n'écrire la fiche qu'UNE
    // fois. Deux `biz.update('clients', …)` séparés se remplaceraient l'un
    // l'autre — l'UPDATE du store écrit l'objet entier, il ne fusionne pas.
    const openingPayments = [...(client.openingPayments || [])];
    const advancePayments = [...(client.advancePayments || [])];
    let clientTouched = false;

    // ── La DETTE INITIALE d'abord ──────────────────────────────────────────
    // C'est la plus ancienne dette du compte : la règle du « plus ancien au
    // plus récent » commence par elle. Sans ce passage, un client qui venait
    // solder toute son ardoise laissait sa reprise intacte — et sa carte
    // continuait d'afficher une dette que plus aucune facture n'expliquait.
    const op = clientOpening(client as any);
    const openPaid = (client.openingPayments || []).reduce((t, x) => t + (Number(x.amount) || 0), 0);
    const openRest = Math.max(0, op.debt - openPaid);
    if (left > 0.004 && openRest > 0) {
      const part = Math.min(left, openRest);
      openingPayments.push({
        id: newId(), date: stamp(), amount: part,
        mode: meta.mode, reference: meta.reference, by: currentUserName,
      });
      clientTouched = true;
      left -= part; settled += part;
    }

    for (const doc of openSales) {
      if (left <= 0.004) break;
      const part = Math.min(left, Number(doc.rest) || 0);
      if (part <= 0) continue;
      const next = withPayment(doc, part, meta, currentUserName);
      biz.update('sales', { ...next, status: next.rest > 0 ? 'crédit' : 'payée' });
      left -= part; settled += part;
    }
    for (const doc of openReps) {
      if (left <= 0.004) break;
      const part = Math.min(left, Number(doc.rest) || 0);
      if (part <= 0) continue;
      const next = withPayment(doc, part, meta, currentUserName);
      biz.update('reparations', next);
      left -= part; settled += part;
    }

    // ── LE TROP-PERÇU DEVIENT UNE AVANCE ────────────────────────────────────
    // Ce qui reste une fois toutes les dettes soldées n'est plus « sans document
    // à solder » : c'est de l'argent que le client a bien remis. Il devient une
    // avance à son crédit — utilisable sur ses prochains achats — et entre dans
    // la caisse de la partie comme n'importe quel règlement (voir
    // `moduleCaisseMovements` / `clientNetPosition`, lib/bizReporting).
    let advanceCreated = 0;
    if (left > 0.004) {
      advanceCreated = left;
      advancePayments.push({
        id: newId(), date: stamp(), amount: left,
        mode: meta.mode, reference: meta.reference, by: currentUserName,
      });
      clientTouched = true;
      settled += left; left = 0;
    }

    if (clientTouched) biz.update('clients', { ...client, openingPayments, advancePayments });

    setPaying(null);
    if (settled <= 0) { toast.error('Ce client n’a aucune dette ni avance à enregistrer'); return; }

    // On ATTEND le verdict du serveur avant d’annoncer l’encaissement : un
    // règlement qui n’existerait que dans ce navigateur serait perdu au premier
    // rechargement, et le client aurait payé pour rien.
    //
    // Le tour de boucle laissé au navigateur n’est pas une politesse : le store
    // ne connaît l’état modifié qu’une fois le rendu passé. Envoyer sans
    // l’attendre expédiait l’état d’AVANT le règlement — l’écran annonçait alors
    // un enregistrement qui ne le contenait pas encore.
    await new Promise(resolve => setTimeout(resolve, 0));
    const res = await biz.flush();
    if (!res.ok) {
      toast.error(`Règlement NON enregistré sur le serveur — ${res.error}`);
      return;
    }
    // Le trop-perçu n'est plus « sans document à solder » : il est porté à
    // l'avance du client, et le message le dit clairement.
    toast.success(advanceCreated > 0.004
      ? `${money(settled)} encaissés — dont ${money(advanceCreated)} portés en avance`
      : `${money(settled)} encaissés sur le compte de ${client.name}`);
  };

  // Les totaux de l'en-tête se lisent sur les MÊMES relevés que les cartes :
  // un chiffre de tête qui ne se retrouve pas dans le détail ne sert à rien.
  const totals = useMemo(() => {
    let debt = 0, ops = 0, charged = 0, paid = 0, debtors = 0, advance = 0;
    for (const c of clients) {
      const st = statements[c.id];
      if (!st) continue;
      // La dette NETTE : ce qu'on peut réellement réclamer. L'avance déjà
      // versée par le client est son argent, pas une créance de la station.
      debt += st.netDebt;
      advance += st.advanceLeft;
      ops += st.allLines.length;
      charged += st.totals.charged;
      paid += st.totals.paid;
      if (st.netDebt > 0) debtors++;
    }
    return { debt, ops, charged, paid, debtors, advance };
  }, [clients, statements]);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={Users} title="Clients" subtitle={`${cfg.label} — base clients`}
        actions={perm.creer ? <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}><Plus className="w-4 h-4" /> Nouveau client</button> : undefined} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Clients" value={clients.length} tone="blue"
          sub={totals.debtors > 0 ? `${totals.debtors} avec une dette` : 'aucune dette en cours'} />
        <StatCard icon={TrendingUp} label="Opérations" value={totals.ops} tone="purple"
          sub="ventes, interventions et règlements" />
        <StatCard icon={Receipt} label="Total consommé" value={money(totals.charged)} tone="green"
          sub={`${money(totals.paid)} encaissés`} />
        <StatCard icon={CircleDollarSign} label="Dettes clients" value={money(totals.debt)} tone="red"
          sub={totals.advance > 0
            ? `reste dû, ${money(totals.advance)} d'avances déduites`
            : "reste dû, d'après les documents"} />
      </div>

      {/* ── Rechercher un client ─────────────────────────────────────────
          Le champ tenait dans une bande grise de la hauteur d'un bouton : rien
          n'indiquait qu'il attendait une frappe, ni ce qu'il venait de retenir.
          Il est maintenant une vraie boîte de recherche — large, qui s'allume au
          focus, se vide d'un clic, et DIT combien de clients elle a gardés. */}
      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm px-5 sm:px-6 py-5">
        <label htmlFor={`client-search-${moduleKey}`} className="block text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2 ml-1">
          Rechercher un client
        </label>
        <div className="group relative">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300 group-focus-within:text-[#003087] transition-colors pointer-events-none" />
          <input
            id={`client-search-${moduleKey}`}
            type="search"
            autoComplete="off"
            placeholder="Nom, téléphone ou adresse…"
            value={search}
            onChange={(e: any) => setSearch(e.target.value)}
            className="w-full h-16 pl-14 pr-32 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold text-[#002d87] placeholder:text-slate-400 placeholder:font-medium outline-none transition-all focus:bg-white focus:border-[#003087] focus:ring-4 focus:ring-blue-100"
          />
          <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
            {search && (
              <button onClick={() => setSearch('')} title="Effacer la recherche"
                className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all">
                <X className="w-4 h-4" />
              </button>
            )}
            <span className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-500 tabular-nums whitespace-nowrap">
              {filtered.length} / {clients.length}
            </span>
          </div>
        </div>
        <div className="mt-4 flex justify-end"><ViewToggle view={view} onChange={setView} /></div>
      </div>

      {filtered.length === 0 ? <EmptyState icon={Users} title="Aucun client" action={perm.creer ? <button className="btn-primary" onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> Nouveau client</button> : undefined} /> : view === 'table' ? (
        /* ── Le fichier client en tableau ─────────────────────────────────
           Les mêmes chiffres que la carte — consommé, réglé, reste dû — mais
           alignés en colonnes : c'est ainsi qu'on repère d'un coup d'œil qui
           doit de l'argent. Les actions du menu « … » deviennent des boutons
           de ligne, dans le même ordre. */
        <Table head={<>
          <th className="table-head">Client</th><th className="table-head">Téléphone</th>
          {cfg.isService && <th className="table-head">Véhicules</th>}
          <th className="table-head">Depuis</th>
          <th className="table-head text-right">Total achats</th><th className="table-head text-right">Règlements</th>
          <th className="table-head text-right">Reste dû</th><th className="table-head">État</th>
          <th className="table-head text-right">Actions</th>
        </>}>
          {filtered.map(c => {
            const st = statements[c.id];
            const debt = st?.netDebt || 0;
            const advanceLeft = st?.advanceLeft || 0;
            return (
              <tr key={c.id}>
                <td className="table-cell">
                  <div className="font-bold text-[#002d87] uppercase tracking-tight">{c.name}</div>
                  {c.address && <div className="text-[11px] text-slate-400 truncate max-w-[220px]" title={c.address}>{c.address}</div>}
                </td>
                <td className="table-cell whitespace-nowrap">{c.phone || '—'}</td>
                {cfg.isService && (
                  <td className="table-cell">
                    {(c.cars?.length || 0) > 0
                      ? <div className="flex flex-wrap gap-1 max-w-[220px]">
                        {c.cars!.map((v: BizCar) => (
                          <Badge key={v.id || carLabel(v)} tone="info">{carLabel(v) || 'Véhicule'}</Badge>
                        ))}
                      </div>
                      : <span className="text-slate-400">—</span>}
                  </td>
                )}
                <td className="table-cell whitespace-nowrap text-slate-500">{c.createdAt ? formatDate(c.createdAt) : '—'}</td>
                <td className="table-cell tabular-nums text-right font-bold text-[#002d87]">{money(st?.totals.charged || 0)}</td>
                <td className="table-cell tabular-nums text-right text-emerald-600">{money(st?.totals.paid || 0)}</td>
                <td className="table-cell tabular-nums text-right">
                  {debt > 0
                    ? <span className="font-black text-red-600">{money(debt)}</span>
                    : advanceLeft > 0
                      ? <span className="font-black text-teal-700">+{money(advanceLeft)}</span>
                      : <span className="text-slate-400">{money(0)}</span>}
                </td>
                <td className="table-cell">
                  {debt > 0
                    ? <Badge tone="danger">Débiteur</Badge>
                    : advanceLeft > 0 ? <Badge tone="info">Avance</Badge> : <Badge tone="success">Soldé</Badge>}
                </td>
                <td className="table-cell text-right">
                  <RowActions>
                    <ActionBtn icon={Eye} tone="blue" title="Dossier client" onClick={() => setDossier({ client: c, section: 'resume' })} />
                    <ActionBtn icon={History} tone="slate" title="Historique complet" onClick={() => setDossier({ client: c, section: 'journal' })} />
                    {debt > 0 && perm.modifier && <ActionBtn icon={DollarSign} tone="green" title="Payer la dette" onClick={() => setPaying(c)} />}
                    {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => { setEditing(c); setShowForm(true); }} />}
                    <ActionBtn icon={FileBarChart} tone="blue" title="Générer un rapport" onClick={() => setReport(c)} />
                    {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(c)} />}
                  </RowActions>
                </td>
              </tr>
            );
          })}
        </Table>
      ) : (
        /* ── Les cartes clients ───────────────────────────────────
           Même dessin que l’écran Clients du Carburant : un client est un client,
           qu’il prenne du gasoil, un café ou un lavage, et rien ne justifiait
           qu’on doive réapprendre à lire sa fiche en changeant d’activité.
           Les trois chiffres se relisent l’un l’autre : consommé − réglé = reste. */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((c, index) => {
            const st = statements[c.id];
            // Ce que le client doit une fois son avance imputée — la carte
            // annonçait la dette brute et taisait l'avance : elle réclamait de
            // l'argent que la station détenait déjà.
            const debt = st?.netDebt || 0;
            const advanceLeft = st?.advanceLeft || 0;
            return (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.03 }}
                className={cn(
                  'group relative bg-white rounded-3xl border transition-all p-5 pt-6 space-y-4 flex flex-col hover:shadow-xl hover:-translate-y-0.5',
                  actionMenuOpen === c.id ? 'z-50 border-blue-300 ring-4 ring-blue-50 shadow-xl' : 'z-10 border-slate-100 hover:border-blue-200 shadow-sm',
                )}
              >
                {/* Le liseré de tête — la seule couleur de la carte. */}
                <div className="h-1.5 absolute top-0 left-0 right-0 rounded-t-3xl bg-gradient-to-r from-[#001f5c] via-[#003087] to-[#FFB800]" />

                {/* ── Identité ──────────────────────────────────────────────
                    La carte ne raconte plus que quatre choses : QUI est le
                    client, ce qu'il a acheté, ce qu'il a payé, ce qu'il doit.
                    Les six pastilles d'avant — nombre de documents, de
                    règlements, d'opérations, date de la dernière — poussaient
                    les trois chiffres qui comptent tout en bas d'une carte
                    qu'on ne fait que survoler. Elles vivent dans le dossier. */}
                <div className="flex items-start gap-3.5 pt-4">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-black uppercase shrink-0 shadow-md border-2 border-white"
                    style={{ background: 'linear-gradient(135deg, #001f5c 0%, #003087 100%)', color: '#FFB800' }}>
                    {c.name[0]}
                  </div>
                  <div className="min-w-0 flex-1 pr-8">
                    <h4 className="font-black text-[#002d87] uppercase tracking-tight text-sm leading-tight truncate">{c.name}</h4>
                    <div className="flex flex-wrap items-center gap-1 mt-1.5">
                      <span className="text-[8px] font-black uppercase px-2.5 py-1 rounded-full leading-none border inline-block bg-blue-50 text-blue-700 border-blue-100">
                        {cfg.label}
                      </span>
                      <span className={cn('text-[8px] font-black uppercase px-2.5 py-1 rounded-full leading-none border inline-block',
                        debt > 0 ? 'bg-red-50 text-red-700 border-red-100' : 'bg-green-50 text-green-700 border-green-100')}>
                        {debt > 0 ? 'Débiteur' : 'Soldé'}
                      </span>
                      {advanceLeft > 0 && (
                        <span className="text-[8px] font-black uppercase px-2.5 py-1 rounded-full leading-none border inline-block bg-teal-50 text-teal-700 border-teal-100">
                          Avance {money(advanceLeft)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Menu d’actions */}
                <div className="absolute top-4 right-4">
                  <motion.button
                    onClick={(e: any) => { e.stopPropagation(); setActionMenuOpen(actionMenuOpen === c.id ? null : c.id); }}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                    className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 group-hover:text-blue-900 transition-all bg-white/80 backdrop-blur-sm shadow-sm border border-slate-100"
                  >
                    <MoreVertical className="w-5 h-5" />
                  </motion.button>

                  <AnimatePresence>
                    {actionMenuOpen === c.id && (
                      <motion.div
                        initial={{ opacity: 0, y: -8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 mt-2 w-56 bg-white border border-slate-100 rounded-2xl shadow-2xl z-[60] overflow-hidden"
                      >
                        <div className="divide-y divide-slate-100">
                          <button
                            onClick={() => { setDossier({ client: c, section: 'resume' }); setActionMenuOpen(null); }}
                            className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                          >
                            <Eye className="w-4 h-4 text-slate-500" /> Dossier Client
                          </button>
                          {perm.modifier && (
                            <button
                              onClick={() => { setEditing(c); setShowForm(true); setActionMenuOpen(null); }}
                              className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                            >
                              <Edit2 className="w-4 h-4 text-blue-500" /> Modifier
                            </button>
                          )}
                          {perm.modifier && (
                            <button
                              onClick={() => { setEditing(c); setShowForm(true); setActionMenuOpen(null); }}
                              className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-amber-700 hover:bg-amber-50 flex items-center gap-3 transition-colors"
                            >
                              <Flag className="w-4 h-4 text-amber-500" /> Reprise (dette / avance)
                            </button>
                          )}
                          {/* Rien à encaisser d'un client dont l'avance couvre
                              déjà tout ce qu'il a pris. */}
                          {debt > 0 && perm.modifier && (
                            <button
                              onClick={() => { setPaying(c); setActionMenuOpen(null); }}
                              className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-emerald-700 hover:bg-emerald-50 flex items-center gap-3 transition-colors"
                            >
                              <DollarSign className="w-4 h-4 text-emerald-500" /> Payer la Dette
                            </button>
                          )}
                          <button
                            onClick={() => { setDossier({ client: c, section: 'journal' }); setActionMenuOpen(null); }}
                            className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                          >
                            <History className="w-4 h-4 text-slate-500" /> Historique Complet
                          </button>
                          <button
                            onClick={() => { setReport(c); setActionMenuOpen(null); }}
                            className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-blue-900 hover:bg-blue-50 flex items-center gap-3 transition-colors"
                          >
                            <FileBarChart className="w-4 h-4 text-blue-600" /> Générer un Rapport
                          </button>
                          {perm.supprimer && (
                            <button
                              onClick={() => { setToDelete(c); setActionMenuOpen(null); }}
                              className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" /> Supprimer
                            </button>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* ── Informations personnelles ──────────────────────────── */}
                <div className="rounded-2xl border border-slate-100 bg-slate-50/60 divide-y divide-slate-100/80">
                  <div className="flex items-center gap-2.5 px-3.5 py-2.5">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="text-[11px] font-bold text-slate-600 truncate">{c.phone || 'Téléphone non renseigné'}</span>
                  </div>
                  <div className="flex items-center gap-2.5 px-3.5 py-2.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="text-[11px] font-bold text-slate-600 truncate">{c.address || 'Adresse non renseignée'}</span>
                  </div>
                  <div className="flex items-center gap-2.5 px-3.5 py-2.5">
                    <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="text-[11px] font-bold text-slate-600 truncate">
                      Client depuis {c.createdAt ? formatDate(c.createdAt) : 'N/A'}
                    </span>
                  </div>
                  {/* ── Son parc, quand la partie en tient un ────────────────
                      Un client de lavage se reconnaît à ses voitures avant de
                      se reconnaître à son adresse : elles se lisent donc sur la
                      carte, sans avoir à ouvrir le dossier. */}
                  {cfg.isService && (c.cars?.length || 0) > 0 && (
                    <div className="flex items-start gap-2.5 px-3.5 py-2.5">
                      <Car className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <div className="min-w-0 flex flex-wrap gap-1">
                        {c.cars!.map((v: BizCar) => (
                          <span key={v.id || carLabel(v)}
                            className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100 leading-none">
                            {carLabel(v) || 'Véhicule'}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Les trois chiffres du compte ────────────────────────
                    Achats − règlements = dette, dette initiale de reprise
                    comprise : les trois se relisent l'un l'autre. */}
                <div className="mt-auto grid grid-cols-3 gap-2">
                  <div className="rounded-2xl border border-slate-100 bg-white p-3 text-center">
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 leading-tight">Total achats</p>
                    <p className="text-[13px] font-black text-[#002d87] tabular-nums leading-none truncate">{money(st?.totals.charged || 0)}</p>
                  </div>
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-3 text-center">
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 leading-tight">Total règlements</p>
                    <p className="text-[13px] font-black text-emerald-700 tabular-nums leading-none truncate">{money(st?.totals.paid || 0)}</p>
                  </div>
                  <div className={cn('rounded-2xl border p-3 text-center',
                    debt > 0 ? 'bg-red-50/70 border-red-100'
                      : advanceLeft > 0 ? 'bg-teal-50/70 border-teal-100' : 'bg-slate-50 border-slate-100')}>
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 leading-tight">
                      {debt > 0 || advanceLeft <= 0 ? 'Total dettes' : 'Avance détenue'}
                    </p>
                    <p className={cn('text-[13px] font-black tabular-nums leading-none truncate',
                      debt > 0 ? 'text-red-600' : advanceLeft > 0 ? 'text-teal-700' : 'text-slate-400')}>
                      {money(debt > 0 || advanceLeft <= 0 ? debt : advanceLeft)}
                    </p>
                  </div>
                </div>

              </motion.div>
            );
          })}
        </div>
      )}

      <ContactModal biz={biz} coll="clients" open={showForm} onClose={() => setShowForm(false)} initial={editing} />

      {dossier && (
        <BizClientDossier
          key={dossier.client.id}
          client={dossier.client} moduleKey={moduleKey} partLabel={cfg.label}
          settings={settings} initialSection={dossier.section}
          onClose={() => setDossier(null)}
          onReport={() => { setReport(dossier.client); setDossier(null); }}
          onPayDebt={perm.modifier ? () => { setPaying(dossier.client); setDossier(null); } : undefined}
          onEditOpening={perm.modifier ? () => { setEditing(dossier.client); setShowForm(true); setDossier(null); } : undefined}
          canEdit={perm.modifier}
          canDelete={perm.supprimer}
        />
      )}

      {report && (
        <BizClientReport
          client={report} moduleKey={moduleKey} partLabel={cfg.label}
          settings={settings} onClose={() => setReport(null)} />
      )}

      {/* Encaisser la dette d’un client — le montant est réparti sur ses documents
          non soldés, du plus ancien au plus récent (`settleDebt`). Les totaux
          affichés sont ceux de SON relevé : le reste proposé est exactement le
          reste dû que montre sa carte. */}
      {paying && (
        <PayDebtModal
          open
          onClose={() => setPaying(null)}
          title={`Payer la dette — ${paying.name}`}
          total={statements[paying.id]?.totals.charged || 0}
          alreadyPaid={statements[paying.id]?.totals.paid || 0}
          advanceHeld={statements[paying.id]?.advanceHeld || 0}
          allowAdvance
          onPay={(amount, meta) => settleDebt(paying, amount, meta)}
        />
      )}

      <Confirm open={!!toDelete} title="Supprimer le client" message={`Supprimer « ${toDelete?.name} » ?`} onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

// ─── Le dossier d'un client de partie ─────────────────────────────────────────
/**
 * Tout le compte d'un client Cafétéria ou Lavage, sur le gabarit partagé
 * (`components/clients/ClientDossier`). L'écran d'avant ne listait qu'une date,
 * une référence et trois montants ; il ne disait ni ce qui avait été acheté, ni
 * quand l'argent était entré, ni ce que le client devait encore.
 *
 * Une partie « service » ajoute sa rubrique propre : le PARC du client — chaque
 * véhicule passé à l'atelier, ce qu'il a coûté et quand il est venu la dernière
 * fois. C'est la question qu'on pose vraiment d'un client de lavage.
 */
function BizClientDossier({
  client, moduleKey, partLabel, settings, initialSection, onClose, onReport, onPayDebt,
  onEditOpening, canEdit, canDelete,
}: {
  client: BizContact; moduleKey: ModuleKey; partLabel: string; settings: any;
  initialSection: string; onClose: () => void; onReport: () => void;
  /** Encaisser la dette depuis la rubrique « Règlements » — comme au Carburant. */
  onPayDebt?: () => void;
  /** Reprendre la dette initiale — elle vit sur la fiche, pas sur un document. */
  onEditOpening?: () => void;
  canEdit?: boolean;
  canDelete?: boolean;
  /** `@types/react` absent : le `key` doit être déclaré pour être accepté. */
  key?: React.Key;
}) {
  const biz = useBiz(moduleKey);
  const cfg = MODULES[moduleKey];
  const ficheRef = React.useRef<HTMLDivElement>(null);
  const { currentUserName } = useAppState();

  /** Le versement qu'on corrige, et celui qu'on s'apprête à effacer. */
  const [editingPay, setEditingPay] = useState<any>(null);
  const [payForm, setPayForm] = useState({ amount: 0, date: '', mode: 'Espèces', reference: '' });
  const [payToDelete, setPayToDelete] = useState<any>(null);

  /**
   * ─── Retrouver le versement derrière une ligne de règlement ───────────────
   *
   * Le relevé aplatit tout : un versement peut venir d'une vente, d'une
   * intervention, ou de la dette de reprise. L'identifiant de la ligne porte
   * l'origine (`<docId>-pay-<payId>`, `open-pay-<payId>`) — c'est lui qu'on
   * décode, sinon un bouton « corriger » ne saurait pas quel document rouvrir.
   *
   * Les versements RECONSTRUITS (`inferred`) n'existent pas en base : ils sont
   * déduits du cumul `paid` d'un vieux document. On refuse de les corriger
   * plutôt que d'inventer une ligne que le document ne porte pas.
   */
  const locatePayment = (payment: StatementPayment): any => {
    const lineId = String(payment.lineId || '');
    if (lineId.startsWith('open-pay-')) {
      const payId = lineId.slice('open-pay-'.length);
      const pay = (client.openingPayments || []).find((x: BizDocPayment) => x.id === payId);
      return pay ? { origin: 'opening', pay } : null;
    }
    // Un dépôt d'avance (trop-perçu) : sa ligne porte `adv-<payId>` et vit sur la
    // fiche du client, pas sur un document.
    if (lineId.startsWith('adv-')) {
      const payId = lineId.slice('adv-'.length);
      const pay = (client.advancePayments || []).find((x: BizDocPayment) => x.id === payId);
      return pay ? { origin: 'advance', pay } : null;
    }
    const cut = lineId.lastIndexOf('-pay-');
    if (cut < 0) return null;
    const docId = lineId.slice(0, cut);
    const payId = lineId.slice(cut + 5);
    for (const coll of ['sales', 'reparations'] as const) {
      const doc = ((biz.state as any)[coll] || []).find((d: any) => d.id === docId);
      if (!doc) continue;
      const pay = (doc.payments || []).find((x: BizDocPayment) => x.id === payId);
      if (pay) return { origin: coll, doc, pay };
    }
    return null;
  };

  /** Réécrit les versements d'un document et remet d'aplomb `paid` / `rest`. */
  const rewriteDoc = (origin: 'sales' | 'reparations', doc: any, payments: BizDocPayment[]) => {
    const paid = payments.reduce((t, x) => t + (Number(x.amount) || 0), 0);
    const total = Number(doc.total) || 0;
    const rest = Math.max(0, total - paid);
    const next: any = { ...doc, payments, paid, rest };
    if (origin === 'sales' && doc.status !== 'retournée' && doc.status !== 'échangée') {
      next.status = rest > 0 ? 'crédit' : 'payée';
    }
    biz.update(origin, next);
  };

  const savePayment = () => {
    if (!editingPay) return;
    const amount = Math.max(0, Number(payForm.amount) || 0);
    if (amount <= 0) { toast.error('Montant invalide'); return; }
    const patch = (x: BizDocPayment) => (x.id !== editingPay.pay.id ? x : {
      ...x, amount, date: payForm.date || x.date, mode: payForm.mode,
      reference: payForm.reference || undefined,
    });

    if (editingPay.origin === 'opening') {
      biz.update('clients', { ...client, openingPayments: (client.openingPayments || []).map(patch) });
    } else if (editingPay.origin === 'advance') {
      biz.update('clients', { ...client, advancePayments: (client.advancePayments || []).map(patch) });
    } else {
      const doc = editingPay.doc;
      const next = (doc.payments || []).map(patch);
      // Un versement ne peut pas dépasser ce que le document facture : au-delà,
      // le « reste » deviendrait négatif et la dette du client fondrait sans
      // qu'aucun billet ne soit entré.
      const sum = next.reduce((t: number, x: BizDocPayment) => t + (Number(x.amount) || 0), 0);
      if (sum > (Number(doc.total) || 0) + 0.004) {
        toast.error(`Le total des versements dépasserait le montant du document (${money(Number(doc.total) || 0)})`);
        return;
      }
      rewriteDoc(editingPay.origin, doc, next);
    }
    toast.success('Règlement corrigé');
    setEditingPay(null);
    void biz.flush();
  };

  const deletePayment = () => {
    if (!payToDelete) return;
    if (payToDelete.origin === 'opening') {
      biz.update('clients', {
        ...client,
        openingPayments: (client.openingPayments || []).filter((x: BizDocPayment) => x.id !== payToDelete.pay.id),
      });
    } else if (payToDelete.origin === 'advance') {
      biz.update('clients', {
        ...client,
        advancePayments: (client.advancePayments || []).filter((x: BizDocPayment) => x.id !== payToDelete.pay.id),
      });
    } else {
      const doc = payToDelete.doc;
      rewriteDoc(payToDelete.origin, doc, (doc.payments || []).filter((x: BizDocPayment) => x.id !== payToDelete.pay.id));
    }
    toast.success('Règlement supprimé');
    setPayToDelete(null);
    void biz.flush();
  };

  /** Le reçu d'un versement, réimprimable des années après. */
  const printPayment = (payment: StatementPayment) => {
    printPaymentReceipt({
      title: 'Reçu de règlement',
      ref: `REG-${String(payment.id).slice(-8).toUpperCase()}`,
      date: payment.date,
      station: stationFromSettings(settings),
      party: { label: 'Client', name: client.name, phone: client.phone, address: client.address },
      info: [
        { label: 'Activité', value: partLabel },
        { label: 'Mode de règlement', value: payment.mode || 'Espèces' },
        { label: 'Référence', value: payment.reference || '' },
        { label: 'Encaissé par', value: currentUserName || '' },
      ],
      amount: payment.amount,
      mode: payment.mode || 'Espèces',
      reference: payment.reference,
    });
  };

  // Aucune borne : le dossier d'un client, c'est son compte entier.
  const st = useMemo(
    () => bizClientStatement(biz.state, client, partLabel),
    [biz.state, client, partLabel]);

  /** Les interventions de ce client, pour la rubrique « Parc automobile ». */
  const interventions: BizReparation[] = useMemo(
    () => (biz.state.reparations || []).filter((r: BizReparation) => r.clientId === client.id),
    [biz.state.reparations, client.id]);

  /** Un véhicule par plaque — ou, à défaut, par marque et modèle. */
  const parc = useMemo(() => {
    const map = new Map<string, {
      label: string; plate?: string; visits: number; total: number; rest: number; last: string;
    }>();
    for (const r of interventions) {
      if (r.status === 'canceled') continue;
      const plate = r.car?.immatriculation?.trim();
      const label = [r.car?.marque, r.car?.name].filter(Boolean).join(' ') || 'Véhicule';
      const key = plate || label;
      const cur = map.get(key) || { label, plate, visits: 0, total: 0, rest: 0, last: '' };
      cur.visits += 1;
      cur.total += Number(r.total) || 0;
      cur.rest += Number(r.rest) || 0;
      if (!cur.last || new Date(r.date).getTime() > new Date(cur.last).getTime()) cur.last = r.date;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [interventions]);

  const identity: DossierGroup[] = [
    {
      title: 'Coordonnées',
      icon: IdCard,
      rows: [
        { label: 'Nom du client', value: client.name },
        { label: 'Téléphone', value: client.phone },
        { label: 'Adresse', value: client.address },
        { label: 'Client depuis', value: client.createdAt ? formatDate(client.createdAt) : undefined },
      ],
    },
    {
      title: 'Le compte en un coup d\'œil',
      icon: ShoppingBag,
      rows: [
        { label: 'Activité', value: partLabel },
        { label: 'Opérations enregistrées', value: `${st.allLines.length}` },
        { label: 'Première opération', value: st.allLines.length ? shortDate(st.allLines[st.allLines.length - 1].date) : undefined },
        { label: 'Dernière opération', value: st.allLines.length ? shortDate(st.allLines[0].date) : undefined },
        { label: 'Total consommé', value: money(st.totals.charged) },
        { label: 'Total encaissé', value: money(st.totals.paid) },
        { label: 'Reste dû', value: money(st.closingDebt), hint: st.closingDebt > 0 ? 'sur les documents du compte' : 'compte soldé' },
        ...(cfg.isService ? [{ label: 'Véhicules suivis', value: `${parc.length}` }] : []),
      ],
    },
  ];

  const extraSections: DossierSection[] = cfg.isService && parc.length > 0 ? [{
    id: 'parc',
    label: 'Parc automobile',
    icon: Car,
    count: parc.length,
    hint: 'Les véhicules de ce client passés à l\'atelier',
    render: () => (
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <header className="flex items-center gap-3 px-5 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200">
          <Car className="w-4 h-4 text-[#002d87]" />
          <h4 className="text-xs font-black uppercase tracking-wider text-[#002d87]">Véhicules ({parc.length})</h4>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50">
              <tr className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2.5">Véhicule</th>
                <th className="px-4 py-2.5">Immatriculation</th>
                <th className="px-4 py-2.5 text-right">Passages</th>
                <th className="px-4 py-2.5">Dernier passage</th>
                <th className="px-4 py-2.5 text-right">Total facturé</th>
                <th className="px-4 py-2.5 text-right">Reste dû</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {parc.map(v => (
                <tr key={v.plate || v.label} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-black text-slate-700">{v.label}</td>
                  <td className="px-4 py-2.5 font-bold text-slate-500 whitespace-nowrap">{v.plate || '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-bold text-slate-500">{v.visits}</td>
                  <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{shortDate(v.last)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-black text-[#002d87] whitespace-nowrap">{money(v.total)}</td>
                  <td className={cn('px-4 py-2.5 text-right tabular-nums font-black whitespace-nowrap',
                    v.rest > 0 ? 'text-red-600' : 'text-slate-300')}>{money(v.rest)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50">
              <tr className="text-[#002d87] font-black">
                <td colSpan={4} className="px-4 py-3 uppercase text-[10px] tracking-widest">Total du parc</td>
                <td className="px-4 py-3 text-right tabular-nums">{money(parc.reduce((s, v) => s + v.total, 0))}</td>
                <td className="px-4 py-3 text-right tabular-nums text-red-600">{money(parc.reduce((s, v) => s + v.rest, 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    ),
  }] : [];

  const op = clientOpening(client as any);
  const openingPaid = (client.openingPayments || []).reduce((t, x) => t + (Number(x.amount) || 0), 0);

  return (
    <>
      <ClientDossier
        open onClose={onClose}
        statement={st}
        identity={identity}
        extraSections={extraSections}
        initialSection={initialSection}
        onReport={onReport}
        onPayDebt={onPayDebt}
        onPrintStatement={() => printFiche(ficheRef.current)}
        // La reprise du compte, montrée pour ce qu'elle est : une ardoise
        // reprise d'un carnet, pas une vente. C'est le premier endroit où l'on
        // regarde quand un solde ne tombe pas juste.
        opening={{
          debt: op.debt,
          advance: op.advance,
          date: client.openingDate || client.createdAt || '',
          notes: client.openingNotes,
          paid: openingPaid,
          onEdit: onEditOpening,
        }}
        // ── Le compte d'avance ────────────────────────────────────────────
        // Il n'était JAMAIS transmis : la rubrique « Compte d'avance » et la
        // tuile « Avance disponible » n'existaient pas pour un client de
        // cafétéria ou de lavage. L'avance saisie à l'ouverture de sa fiche
        // était donc écrite en base, et invisible partout — pas de mouvement,
        // pas de solde, pas de déduction sur ce qu'il devait.
        advance={(st.advanceHeld > 0 || op.advance > 0) ? {
          available: st.advanceLeft,
          recharged: st.totals.advanceRecharged,
          used: st.totals.advanceUsed,
        } : undefined}
        onEditPayment={canEdit ? (payment) => {
          const found = locatePayment(payment);
          if (!found) {
            toast.error(payment.inferred
              ? "Ce versement est reconstruit d'un ancien document : corrigez-le depuis le document lui-même"
              : "Versement introuvable");
            return;
          }
          setEditingPay(found);
          setPayForm({
            amount: Number(found.pay.amount) || 0,
            date: String(found.pay.date || '').slice(0, 10),
            mode: found.pay.mode || 'Espèces',
            reference: found.pay.reference || '',
          });
        } : undefined}
        onDeletePayment={canDelete ? (payment) => {
          const found = locatePayment(payment);
          if (!found) { toast.error("Versement introuvable"); return; }
          setPayToDelete(found);
        } : undefined}
        onPrintPayment={printPayment}
        badges={
          <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-blue-100">
            {st.allLines.length} opération(s)
          </span>
        }
      >
        {/* La feuille A4, hors écran : c'est elle que `printFiche` clone. */}
        <ClientStatementFiche ref={ficheRef} statement={st} settings={settings} />
      </ClientDossier>

      {/* ── Corriger un versement ──────────────────────────────────────────
          Le relevé se lisait, il ne se corrigeait pas : un montant tapé de
          travers restait au compte pour toujours. Le versement est repris à sa
          source — dans la vente, l'intervention ou la reprise qui le porte — et
          le reste dû du document se recalcule aussitôt. */}
      <Modal open={!!editingPay} onClose={() => setEditingPay(null)} icon={Wallet} size="lg" formScale
        title="Corriger le règlement" subtitle={client.name}
        zClass="z-[100]"
        footer={<>
          <button className="btn-ghost" onClick={() => setEditingPay(null)}>Annuler</button>
          <button className="btn-primary" onClick={savePayment} disabled={!payForm.amount || payForm.amount <= 0}>
            Enregistrer la correction
          </button>
        </>}>
        <div className="space-y-4">
          {editingPay && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-[11px] font-semibold text-slate-500 leading-relaxed">
              {editingPay.origin === 'opening'
                ? 'Versement encaissé sur la dette initiale du client.'
                : editingPay.origin === 'advance'
                  ? "Dépôt d'avance (trop-perçu) porté au crédit du client."
                  : `Versement rattaché à ${editingPay.doc?.ref || 'un document'} — le reste dû sera recalculé.`}
              {' '}Montant d'origine : <b className="text-[#002d87]">{money(Number(editingPay.pay?.amount) || 0)}</b>.
            </div>
          )}
          <Field label="Montant (DA)">
            <Input type="number" inputMode="decimal" className="text-right" value={payForm.amount}
              onChange={(e: any) => setPayForm(f => ({ ...f, amount: Number(e.target.value) || 0 }))} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Date">
              <Input type="date" value={payForm.date}
                onChange={(e: any) => setPayForm(f => ({ ...f, date: e.target.value }))} />
            </Field>
            <Field label="Mode de règlement">
              <Select value={payForm.mode} onChange={(e: any) => setPayForm(f => ({ ...f, mode: e.target.value }))}>
                {PAY_MODES.map(m => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
            <Field label="Référence">
              <Input value={payForm.reference} placeholder="Optionnel"
                onChange={(e: any) => setPayForm(f => ({ ...f, reference: e.target.value }))} />
            </Field>
          </div>
        </div>
      </Modal>

      <Confirm open={!!payToDelete} title="Supprimer ce règlement"
        message={payToDelete
          ? `Supprimer le versement de ${money(Number(payToDelete.pay?.amount) || 0)} ? La dette du client remontera d'autant.`
          : ''}
        onConfirm={deletePayment} onCancel={() => setPayToDelete(null)} />
    </>
  );
}

// ─── Rapport de période ───────────────────────────────────────────────────────
function BizClientReport({
  client, moduleKey, partLabel, settings, onClose,
}: {
  client: BizContact; moduleKey: ModuleKey; partLabel: string; settings: any; onClose: () => void;
}) {
  const biz = useBiz(moduleKey);
  const state = biz.state;
  const build = useCallback(
    (from: string, to: string) => bizClientStatement(state, client, partLabel, from, to),
    [state, client, partLabel]);

  return (
    <ClientReportModal open onClose={onClose} build={build} settings={settings}
      clientName={client.name} partLabel={partLabel} />
  );
}
