/**
 * ─── Fonds de roulement ────────────────────────────────────────────────────────
 * Le calcul est montré comme il se lit :
 *
 *   Caisses + Banques + Créances clients + Stock (prix d'achat) − Dettes fournisseurs
 *
 * Chaque terme est une carte cliquable qui ouvre son détail ligne par ligne :
 * chaque compte bancaire (avec son solde d'ouverture et ses mouvements de la
 * période), la caisse de chaque activité, chaque client débiteur avec sa
 * facture, chaque fournisseur avec la sienne, chaque cuve et chaque référence
 * en stock avec sa quantité et son prix d'achat.
 *
 * Un sélecteur d'activité en tête filtre TOUT l'écran (cartes, calcul, détails)
 * sur une seule partie : carburant, cafétéria, lavage ou finance. Sa caisse ET
 * sa part des comptes bancaires suivent ce filtre — c'est sa trésorerie. Le
 * tiroir et les comptes sont COMMUNS, mais chaque ligne du grand livre dit de
 * quelle activité est le mouvement : ce sont ces lignes qui répartissent les
 * soldes, sans en inventer ni en perdre un dinar. Le solde d'ouverture des
 * comptes, qui n'a aucune ligne derrière lui, revient à l'activité dont ces
 * comptes sont ceux — le Carburant (`BANK_OPENING_PART`).
 *
 * Sous chaque solde, la période se relit en toutes lettres :
 *
 *      hors période + entrées − sorties = solde
 *
 * « Hors période » n'est pas une ouverture : c'est tout ce qui ne tombe pas
 * dans la fenêtre, avant elle comme après. C'est ce qui rend l'égalité vraie
 * quelles que soient les dates choisies.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  PiggyBank, Landmark, Users, Truck, Wallet, ChevronRight, Boxes, Scale,
  ArrowDownRight, ArrowUpRight, Info, Building2, Filter, Layers,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { money, formatDate, Modal, Table, Badge } from '@/src/components/biz/Kit';
import { WorkingCapitalReport, WCBlock, WCRow, WCPart, filterWorkingCapital } from '@/src/lib/workingCapital';
import { TreasuryAccount } from '@/src/lib/treasuryReporting';

const BLOCK_ICON: Record<string, React.ElementType> = {
  cash: PiggyBank, banks: Landmark, receivables: Users, stock: Boxes, payables: Truck,
};

const BLOCK_BG: Record<string, string> = {
  cash: 'linear-gradient(135deg,#001f5c,#003087)',
  banks: 'linear-gradient(135deg,#065f46,#047857)',
  receivables: 'linear-gradient(135deg,#4c1d95,#6d28d9)',
  stock: 'linear-gradient(135deg,#92400e,#b45309)',
  payables: 'linear-gradient(135deg,#991b1b,#dc2626)',
};

function StepCard({ block, onOpen }: { block: WCBlock; onOpen: () => void }) {
  const Icon = BLOCK_ICON[block.key] || Wallet;
  const negative = block.sign === -1;
  return (
    <button onClick={onOpen}
      className="rounded-2xl p-5 text-white text-left transition-transform hover:-translate-y-0.5 w-full"
      style={{ background: BLOCK_BG[block.key] || 'linear-gradient(135deg,#334155,#475569)' }}>
      <div className="flex items-center gap-2 opacity-80">
        <Icon className="w-4 h-4" />
        <span className="text-[11px] font-bold uppercase tracking-wide">{block.label}</span>
      </div>
      {/* « −0,00 DA » n'est pas un montant : un bloc vide n'a pas de signe. */}
      <p className="text-2xl font-black tabular-nums mt-1.5">
        {negative && Math.abs(block.total) >= 0.005 ? '−' : ''}{money(block.total)}
      </p>
      {/* Trésorerie : ce que la PÉRIODE a fait bouger, sous le solde — les flux
          des lignes RETENUES, et d'elles seules. La carte reprenait les flux de
          toute la station sous le solde d'une seule activité, filtre appliqué. */}
      {block.flow && (
        <p className="text-[11px] opacity-90 mt-1 tabular-nums">
          Hors période {money(block.flow.outside)}
          <span className="opacity-70"> · </span>
          <span className="font-bold">+{money(block.flow.in)}</span>
          <span className="opacity-70"> · </span>
          <span className="font-bold">−{money(block.flow.out)}</span>
        </p>
      )}
      <p className="text-[11px] opacity-75 mt-0.5">
        {block.rows.filter(r => !r.informational).length} ligne(s) comptée(s)
        {block.flow ? ` · ${block.flow.count} mouvement(s) sur la période` : ''} — voir le détail →
      </p>
    </button>
  );
}

function RowList({ rows, negative }: { rows: WCRow[]; negative?: boolean }) {
  if (!rows.length) {
    return <div className="rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center text-sm font-bold text-slate-400">Aucune ligne.</div>;
  }
  return (
    <Table head={<>
      <th className="table-head">Libellé</th>
      <th className="table-head">Activité</th>
      <th className="table-head">Date</th>
      <th className="table-head text-right">Montant</th>
    </>}>
      {rows.map(r => (
        <tr key={r.id} className={cn('hover:bg-slate-50', r.informational && 'bg-slate-50/60')}>
          <td className="table-cell">
            <div className="font-bold text-slate-700 flex items-center gap-1.5 flex-wrap">
              {r.emoji && <span>{r.emoji}</span>}{r.label}
              {r.informational && <Badge tone="neutral">Hors total</Badge>}
            </div>
            {r.sub && <div className="text-[11px] text-slate-400">{r.sub}</div>}
          </td>
          <td className="table-cell text-slate-400 text-xs">{r.partLabel || '—'}</td>
          <td className="table-cell whitespace-nowrap text-slate-500">{r.date ? formatDate(r.date) : '—'}</td>
          <td className={cn('table-cell text-right tabular-nums font-black',
            r.informational ? 'text-slate-400'
              : negative ? 'text-red-600' : r.amount < 0 ? 'text-red-600' : 'text-emerald-600')}>
            {!r.informational && negative && Math.abs(r.amount) >= 0.005 ? '−' : ''}{money(r.amount)}
          </td>
        </tr>
      ))}
    </Table>
  );
}

/**
 * Un compte bancaire déroulé : son ouverture, son solde et ses mouvements.
 *
 * `highlight` est l'activité regardée quand l'écran est filtré. Le compte garde
 * alors son solde ENTIER — c'est l'argent que la station possède vraiment, et
 * il ne change pas parce qu'on regarde une activité — et la ligne « dont … »
 * dit ce que cette activité y détient. Sans elle, filtrer effaçait purement et
 * simplement les comptes de l'écran.
 */
function AccountCard({ account: a, highlight }: {
  account: TreasuryAccount;
  highlight?: { key: string; label: string };
  key?: React.Key;
}) {
  const [open, setOpen] = useState(false);
  const share = highlight ? a.parts.find(p => p.key === highlight.key) : undefined;
  // Quand tout le compte revient à l'activité regardée, répéter le montant sous
  // lui-même n'apprend rien — et laisse croire à deux chiffres différents.
  const whole = !!share && Math.abs(share.balance - a.balance) < 0.005;
  return (
    <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
        <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white flex items-center justify-center shrink-0">
          <Building2 className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-black text-slate-800 text-sm truncate">{a.name}</p>
          <p className="text-[11px] text-slate-400">
            {a.accountNumber ? `N° ${a.accountNumber} · ` : ''}
            Début de période {money(a.openingBalance)} · {a.movesCount} mouvement(s)
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] uppercase font-bold text-slate-400">Solde du compte</p>
          <p className={cn('font-black tabular-nums', a.balance >= 0 ? 'text-[#002d87]' : 'text-red-600')}>{money(a.balance)}</p>
          {highlight && (whole ? (
            <p className="text-[11px] mt-0.5 whitespace-nowrap font-bold text-emerald-600">
              entièrement {highlight.label}
            </p>
          ) : (
            <p className="text-[11px] tabular-nums mt-0.5 whitespace-nowrap">
              <span className="text-slate-400">dont {highlight.label} </span>
              <b className={(share?.balance || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}>{money(share?.balance || 0)}</b>
            </p>
          ))}
        </div>
        <ChevronRight className={cn('w-4 h-4 text-slate-300 transition-transform shrink-0', open && 'rotate-90')} />
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3 bg-slate-50/60 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-white p-2.5 border border-slate-100">
              <p className="text-[10px] uppercase font-bold text-slate-400">Entrées (période)</p>
              <p className="font-black tabular-nums text-emerald-600 text-sm">+{money(a.credit)}</p>
            </div>
            <div className="rounded-xl bg-white p-2.5 border border-slate-100">
              <p className="text-[10px] uppercase font-bold text-slate-400">Sorties (période)</p>
              <p className="font-black tabular-nums text-red-600 text-sm">−{money(a.debit)}</p>
            </div>
            <div className="rounded-xl bg-white p-2.5 border border-slate-100">
              <p className="text-[10px] uppercase font-bold text-slate-400">Début de période</p>
              <p className="font-black tabular-nums text-slate-600 text-sm">{money(a.openingBalance)}</p>
              <p className="text-[10px] text-slate-400">Ouverture du compte {money(a.initialBalance)}</p>
            </div>
          </div>
          {/* À qui est l'argent de ce compte. Un compte est commun : sans cette
              répartition, une activité regardée seule n'avait aucune banque. */}
          {a.parts.some(p => p.balance !== 0) && (
            <div className="rounded-xl bg-white p-2.5 border border-slate-100">
              <p className="text-[10px] uppercase font-bold text-slate-400">
                Part de chaque activité <span className="normal-case font-medium">— leur somme fait le solde du compte, {money(a.balance)}</span>
              </p>
              <div className="flex flex-wrap gap-x-2 gap-y-1 mt-1">
                {a.parts.filter(p => p.balance !== 0).map(p => (
                  <span key={p.key} className={cn('text-[11px] tabular-nums rounded-lg px-2 py-0.5',
                    highlight?.key === p.key ? 'bg-[#eef3fc] ring-1 ring-[#003087]/25' : '')}>
                    <b className="text-slate-600">{p.label}</b>{' '}
                    <span className={p.balance >= 0 ? 'text-emerald-600 font-black' : 'text-red-600 font-black'}>{money(p.balance)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {a.moves.length === 0 ? (
            <p className="text-xs text-slate-400 italic px-1">Aucun mouvement sur la période.</p>
          ) : (
            <div className="space-y-1.5">
              {a.moves.map(m => (
                <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2">
                  <Badge tone={m.amount >= 0 ? 'success' : 'danger'}>
                    {m.amount >= 0 ? <ArrowDownRight className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />} {m.nature}
                  </Badge>
                  <span className="text-xs text-slate-600 min-w-0 flex-1 truncate">{m.label}</span>
                  <span className="text-[11px] text-slate-400">{m.counterpart}</span>
                  {m.reference && <span className="badge badge-info">{m.reference}</span>}
                  <span className="text-[11px] text-slate-400">{formatDate(m.date)}</span>
                  <span className={cn('font-black tabular-nums text-sm ml-auto', m.amount >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                    {m.amount >= 0 ? '+' : '−'}{money(Math.abs(m.amount))}
                  </span>
                </div>
              ))}
            </div>
          )}
          {a.notes && <p className="text-[11px] text-slate-400 italic px-1">{a.notes}</p>}
        </div>
      )}
    </div>
  );
}

export default function WorkingCapitalView({ report: full }: { report: WorkingCapitalReport }) {
  const [detail, setDetail] = useState<WCBlock | null>(null);
  /** Activité regardée : `all`, `systeme` (finance) ou la clé d'une partie. */
  const [partKey, setPartKey] = useState<string>('all');

  // Le filtre recalcule TOUS les totaux depuis les lignes conservées : l'écran
  // ne peut jamais afficher un total qui ne correspond pas à son détail.
  //
  // Le type est écrit à la main : `@types/react` n'étant pas installé, ce que
  // rend un `useMemo` vaut `any`, et plus rien de ce qu'on en lit n'est
  // vérifié. Sans cette annotation, une faute de frappe sur un total traverse
  // la compilation pour n'apparaître qu'à l'écran.
  const r: WorkingCapitalReport = useMemo(() => filterWorkingCapital(full, partKey), [full, partKey]);

  // La Finance a son propre bouton : la reprendre depuis `parts`, où elle
  // figure désormais comme ligne du tableau, en afficherait deux.
  const filters: { key: string; label: string; emoji: string }[] = useMemo(() => ([
    { key: 'all', label: 'Toutes les activités', emoji: '🏢' },
    { key: 'systeme', label: 'Finance (caisse & banques)', emoji: '🏦' },
    ...full.parts.filter((p: WCPart) => p.key !== 'systeme')
      .map((p: WCPart) => ({ key: p.key, label: p.label, emoji: p.emoji })),
  ]), [full.parts]);

  const filtered = partKey !== 'all';
  const activeFilter = filters.find(f => f.key === partKey);
  const positive = r.workingCapital >= 0;
  /**
   * L'activité regardée détient TOUT l'argent en banque. C'est le cas normal du
   * Carburant : les comptes sont les siens, tous les mouvements viennent de lui
   * et le solde d'ouverture aussi. L'écran dit alors « la totalité revient à
   * … » au lieu de répéter le même montant sur deux lignes, ce qui donnait
   * l'impression de deux chiffres qui ne se rejoignent pas.
   */
  const bankIsWhole = filtered && Math.abs(r.stationBankTotal - r.bankTotal) < 0.005;

  const steps: { label: string; value: number; sign: '' | '+' | '−' | '='; tone: string }[] = [
    { label: 'Caisses (espèces)', value: r.cashTotal, sign: '', tone: 'text-[#002d87]' },
    { label: filtered && !bankIsWhole ? 'Comptes bancaires (sa part)' : 'Comptes bancaires', value: r.bankTotal, sign: '+', tone: 'text-emerald-700' },
    { label: 'Créances clients', value: r.receivablesTotal, sign: '+', tone: 'text-violet-700' },
    { label: "Stock (prix d'achat)", value: r.stockValue, sign: '+', tone: 'text-amber-700' },
    { label: 'Dettes fournisseurs', value: r.payablesTotal, sign: '−', tone: 'text-red-600' },
    { label: 'Fonds de roulement', value: r.workingCapital, sign: '=', tone: positive ? 'text-emerald-600' : 'text-red-600' },
  ];

  return (
    <div className="space-y-8">
      {/* ── Filtre par activité — pilote tout l'écran ── */}
      <div className="card-glass p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-[#FFB800]" />
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Filtrer par activité</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filters.map(f => (
            <button key={f.key} onClick={() => setPartKey(f.key)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
                partKey === f.key ? 'bg-[#003087] text-white shadow' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>
              {f.emoji} {f.label}
            </button>
          ))}
        </div>
        {filtered && (
          <p className="text-[11px] text-slate-400 italic">
            Chaque montant ci-dessous ne compte que les lignes de « {activeFilter?.label} » — sa caisse et SA PART des
            comptes bancaires : c'est sa trésorerie, au même solde que l'écran Caisse Générale.
            {partKey !== 'systeme' && ' Le tiroir de la Finance est la part du tiroir commun qui n\'appartient à aucune activité.'}
            {' '}Les comptes bancaires, eux, restent déroulés en entier plus bas : la station y détient
            en tout {money(r.stationBankTotal)}
            {bankIsWhole ? ', qui reviennent en entier à cette activité.' : `, dont ${money(r.bankTotal)} pour cette activité.`}
          </p>
        )}
      </div>

      {/* ── Le résultat ── */}
      <div className="rounded-2xl p-6 text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
        style={{ background: positive ? 'linear-gradient(135deg,#001f5c,#003087)' : 'linear-gradient(135deg,#7f1d1d,#b91c1c)' }}>
        <div>
          <p className="text-sm font-bold uppercase tracking-wide opacity-90 flex items-center gap-2">
            <Scale className="w-4 h-4" /> Fonds de roulement
            {filtered && <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-white/15">{activeFilter?.label}</span>}
          </p>
          <p className="text-xs opacity-75 mt-1 leading-relaxed">
            Trésorerie ({money(r.treasuryTotal)}) + créances clients ({money(r.receivablesTotal)})
            + stock au prix d'achat ({money(r.stockValue)}) − dettes fournisseurs ({money(r.payablesTotal)}).
          </p>
          {/* D'où sort la trésorerie : les tiroirs d'un côté, la banque de
              l'autre. Le chiffre était annoncé sans jamais être décomposé —
              c'est pourtant là que se logeait l'erreur. */}
          {/* Filtré, « comptes bancaires » n'est plus le total en banque mais la
              PART de l'activité : le mot manquait, et le chiffre passait pour
              l'argent de la station. Les deux sont dits. */}
          <p className="text-xs opacity-75 mt-1 tabular-nums">
            Trésorerie = caisses {money(r.cashTotal)}
            {!filtered && <> ({money(r.activitiesCash)} activités + {money(r.financeCash)} Finance)</>}
            {' '}+ {filtered && !bankIsWhole ? 'sa part des comptes bancaires' : 'comptes bancaires'} {money(r.bankTotal)}
            {filtered && (bankIsWhole
              ? <> (la totalité des {r.accounts.length} comptes)</>
              : <> (sur {money(r.stationBankTotal)} en banque, tous comptes confondus)</>)}.
          </p>
          <p className="text-xs opacity-75 mt-1">
            Dont {money(r.fuelStockValue)} de carburant en cuve et {money(r.goodsStockValue)} de marchandise.
            Hors stock (disponible financier seul) : {money(r.financialWorkingCapital)}.
          </p>
        </div>
        <p className="text-4xl font-black tabular-nums shrink-0" style={{ color: positive ? '#FFB800' : '#fff' }}>
          {money(r.workingCapital)}
        </p>
      </div>

      {/* ── Les cinq termes, cliquables ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <StepCard block={r.cash} onOpen={() => setDetail(r.cash)} />
        <StepCard block={r.banks} onOpen={() => setDetail(r.banks)} />
        <StepCard block={r.receivables} onOpen={() => setDetail(r.receivables)} />
        <StepCard block={r.stock} onOpen={() => setDetail(r.stock)} />
        <StepCard block={r.payables} onOpen={() => setDetail(r.payables)} />
      </div>

      {/* ── Le calcul, étape par étape ── */}
      <div className="card-glass p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Comment le fonds de roulement est calculé</p>
        <div className="flex flex-wrap items-stretch gap-2">
          {steps.map((s, i) => (
            <React.Fragment key={s.label}>
              {i > 0 && <span className="self-center text-slate-300 font-black text-lg px-0.5">{s.sign}</span>}
              <div className={cn('rounded-xl px-3 py-2 flex-1 min-w-[140px]', s.sign === '=' ? 'bg-slate-100' : 'bg-slate-50')}>
                <p className="text-[10px] uppercase font-bold text-slate-400 leading-tight">{s.label}</p>
                <p className={cn('font-black tabular-nums text-sm mt-0.5', s.tone)}>{money(s.value)}</p>
              </div>
            </React.Fragment>
          ))}
        </div>
        <div className="flex flex-wrap gap-4 mt-3 pt-3 border-t border-slate-100 text-[11px] text-slate-500">
          <span><b className="text-slate-700">Trésorerie immédiate</b> {money(r.treasuryTotal)}</span>
          <span><b className="text-slate-700">Hors stock</b> {money(r.financialWorkingCapital)}</span>
          <span><b className="text-slate-700">Crédit net</b> {money(r.netCredit)} (créances − dettes)</span>
          {r.liquidityRatio !== null && (
            <span>
              <b className="text-slate-700">Ratio de liquidité</b> {r.liquidityRatio.toFixed(2)} —
              {r.liquidityRatio >= 1 ? ' le disponible couvre les dettes' : ' les dettes dépassent le disponible'}
            </span>
          )}
          {r.coverageRatio !== null && (
            <span><b className="text-slate-700">Couverture avec le stock</b> {r.coverageRatio.toFixed(2)}</span>
          )}
        </div>
      </div>

      {/* ── Par activité — chaque ligne porte son propre TOTAL ── */}
      <div className="space-y-3">
        <h3 className="font-black text-[#002d87] flex items-center gap-2">
          <Wallet className="w-5 h-5 text-[#FFB800]" /> Détail par activité
        </h3>
        {/* Une ligne par tiroir — les trois activités ET la Finance, qui porte
            le reste du tiroir commun. La colonne « Comptes bancaires » se
            totalise exactement à l'argent réel en banque, et le total du
            tableau au fonds de roulement affiché en haut : il manquait la
            Finance, et l'écart n'était expliqué nulle part. */}
        <Table head={<>
          <th className="table-head">Activité</th>
          <th className="table-head text-right">Caisse (espèces)</th>
          <th className="table-head text-right">Comptes bancaires</th>
          <th className="table-head text-right">Créances clients</th>
          <th className="table-head text-right">Stock (prix d'achat)</th>
          <th className="table-head text-right">Dettes fournisseurs</th>
          <th className="table-head text-right">Net financier</th>
          <th className="table-head text-right">Total de l'activité</th>
        </>}>
          {r.parts.map((p: WCPart) => (
            <tr key={p.key} className="cursor-pointer hover:bg-slate-50" onClick={() => setPartKey(p.key)}>
              <td className="table-cell font-bold whitespace-nowrap">{p.emoji} {p.label}</td>
              <td className={cn('table-cell tabular-nums text-right', p.cash >= 0 ? 'text-[#002d87]' : 'text-red-600')}>{money(p.cash)}</td>
              <td className="table-cell tabular-nums text-right text-emerald-700">{p.bank ? money(p.bank) : <span className="text-slate-300">—</span>}</td>
              <td className="table-cell tabular-nums text-right text-violet-700">{money(p.receivables)}</td>
              <td className="table-cell tabular-nums text-right text-amber-700">{money(p.stockValue)}</td>
              <td className="table-cell tabular-nums text-right text-red-600">{money(p.payables)}</td>
              <td className={cn('table-cell tabular-nums text-right', p.net >= 0 ? 'text-emerald-600' : 'text-red-600')}>{money(p.net)}</td>
              <td className={cn('table-cell tabular-nums text-right font-black', p.total >= 0 ? 'text-emerald-600' : 'text-red-600')}>{money(p.total)}</td>
            </tr>
          ))}
          <tr className="bg-blue-50/60">
            <td className="table-cell font-black text-[#002d87]">TOTAL — FONDS DE ROULEMENT</td>
            <td className="table-cell tabular-nums text-right font-black text-[#002d87]">{money(r.parts.reduce((s: number, p: WCPart) => s + p.cash, 0))}</td>
            <td className="table-cell tabular-nums text-right font-black text-emerald-700">{money(r.parts.reduce((s: number, p: WCPart) => s + p.bank, 0))}</td>
            <td className="table-cell tabular-nums text-right font-black text-violet-700">{money(r.parts.reduce((s: number, p: WCPart) => s + p.receivables, 0))}</td>
            <td className="table-cell tabular-nums text-right font-black text-amber-700">{money(r.parts.reduce((s: number, p: WCPart) => s + p.stockValue, 0))}</td>
            <td className="table-cell tabular-nums text-right font-black text-red-600">{money(r.parts.reduce((s: number, p: WCPart) => s + p.payables, 0))}</td>
            <td className="table-cell tabular-nums text-right font-black">{money(r.parts.reduce((s: number, p: WCPart) => s + p.net, 0))}</td>
            <td className="table-cell tabular-nums text-right font-black text-[#002d87]">{money(r.parts.reduce((s: number, p: WCPart) => s + p.total, 0))}</td>
          </tr>
        </Table>
        <p className="text-[11px] text-slate-400 italic flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Cliquez sur une ligne pour ne garder que cette activité. La colonne « Caisse » est le tiroir de chacune, lu
          sur ses propres mouvements — le même solde que l'écran Caisse Générale — et il entre bien dans le fonds de
          roulement. La colonne « Comptes bancaires » est SA PART des comptes : ce qu'elle y a versé moins ce qu'elle
          en a réglé. Les comptes sont communs, aucun n'appartient à une activité, mais chaque ligne du grand livre dit
          de qui est le mouvement — et la somme de la colonne fait exactement l'argent réel en banque
          ({money(r.stationBankTotal)}), sans en inventer ni en perdre un dinar. Le solde d'ouverture des comptes, qui
          n'a aucune ligne derrière lui, revient au Carburant : ce sont ses comptes, et il y dormait auparavant sous
          « Finance », invisible partout. La Finance n'est donc plus que la part du tiroir commun qui n'appartient à
          aucune activité. Le calcul retient les caisses ({money(r.cashTotal)}), la banque ({money(r.bankTotal)}), les
          créances ({money(r.receivablesTotal)}) et le stock au prix d'achat ({money(r.stockValue)}), moins les dettes
          ({money(r.payablesTotal)}).
        </p>
      </div>

      {/* ── Ce que pèse le stock ── */}
      <div className="space-y-3">
        <h3 className="font-black text-[#002d87] flex items-center gap-2">
          <Boxes className="w-5 h-5 text-[#FFB800]" /> Stock compté dans le fonds de roulement
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-[10px] uppercase font-black text-amber-700">Carburant en cuve</p>
            <p className="text-2xl font-black tabular-nums text-amber-800">{money(r.fuelStockValue)}</p>
            <p className="text-[11px] text-amber-700 mt-0.5">Litres restants × prix d'achat du carburant</p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-[10px] uppercase font-black text-amber-700">Marchandise</p>
            <p className="text-2xl font-black tabular-nums text-amber-800">{money(r.goodsStockValue)}</p>
            <p className="text-[11px] text-amber-700 mt-0.5">Catalogues & comptoirs, au prix d'achat</p>
          </div>
          <button onClick={() => setDetail(r.stock)}
            className="rounded-2xl border border-[#003087]/20 bg-[#eef3fc] p-4 text-left hover:bg-[#e2ebfa] transition-colors">
            <p className="text-[10px] uppercase font-black text-[#002d87]">Total stock</p>
            <p className="text-2xl font-black tabular-nums text-[#002d87]">{money(r.stockValue)}</p>
            <p className="text-[11px] font-black text-[#003087] mt-0.5 flex items-center gap-1">
              <Layers className="w-3 h-3" /> Voir chaque cuve et chaque référence →
            </p>
          </button>
        </div>
      </div>

      {/* ── Les comptes bancaires ── */}
      {/* Chaque compte est déroulé en entier — solde, ouverture et mouvements —
          que l'écran soit filtré ou non : le solde d'un compte est l'argent que
          la station possède vraiment, et il ne change pas parce qu'on regarde
          une activité. Filtré, l'écran les effaçait et n'affichait plus que la
          part de l'activité : le total réel en banque n'était alors visible
          nulle part. Les deux chiffres sont désormais montrés ensemble et
          nommés — le total de tous les comptes, puis ce que l'activité y
          détient. Seule la PART entre dans son fonds de roulement : compter le
          total sur chaque activité compterait le même argent quatre fois. */}
      <div className="space-y-3">
        <h3 className="font-black text-[#002d87] flex items-center gap-2 flex-wrap">
          <Landmark className="w-5 h-5 text-[#FFB800]" /> Comptes bancaires
          <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
            {r.accounts.length} compte(s) · {money(r.stationBankTotal)} au total
          </span>
          {filtered && (bankIsWhole
            ? <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-emerald-600 text-white">la totalité revient à {activeFilter?.label}</span>
            : <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">part de {activeFilter?.label} : {money(r.bankTotal)}</span>)}
        </h3>
        {r.accounts.length === 0 ? (
          <div className="card-glass p-8 text-center text-sm text-slate-400">Aucun compte bancaire enregistré.</div>
        ) : (
          <div className="space-y-2">
            {r.accounts.map((a: TreasuryAccount) => (
              <AccountCard key={a.id} account={a}
                highlight={filtered && activeFilter ? { key: partKey, label: activeFilter.label } : undefined} />
            ))}
            {/* Le total de TOUS les comptes d'abord — c'est l'argent réel — puis
                la part retenue par le filtre, qui est celle qui compte dans le
                fonds de roulement affiché en haut. */}
            <div className="rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3 space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
                  Total de tous les comptes bancaires
                </span>
                <span className={cn('font-black tabular-nums', r.stationBankTotal >= 0 ? 'text-[#002d87]' : 'text-red-600')}>{money(r.stationBankTotal)}</span>
              </div>
              {filtered && (bankIsWhole ? (
                <p className="text-[11px] font-bold text-emerald-700 pt-1.5 border-t border-slate-200">
                  Cette somme revient en entier à « {activeFilter?.label} » — c'est elle qui entre dans son fonds de roulement.
                </p>
              ) : (
                <div className="flex items-center justify-between gap-3 pt-1.5 border-t border-slate-200">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    Dont part de {activeFilter?.label} — comptée dans le fonds de roulement
                  </span>
                  <span className={cn('font-black tabular-nums', r.bankTotal >= 0 ? 'text-emerald-700' : 'text-red-600')}>{money(r.bankTotal)}</span>
                </div>
              ))}
            </div>
            {/* Filtré, le détail des parts explique ligne par ligne d'où sort ce
                que l'activité détient sur chaque compte. */}
            {filtered && (
              <>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 pt-1">
                  Part de {activeFilter?.label}, compte par compte
                </p>
                <RowList rows={r.banks.rows} />
                <p className="text-[11px] text-slate-400 italic">{r.banks.note}</p>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Détail d'un terme ── */}
      <Modal open={!!detail} onClose={() => setDetail(null)}
        icon={detail ? (BLOCK_ICON[detail.key] || Wallet) : Wallet} size="2xl" fullHeight
        title={detail?.label || ''} subtitle={detail?.hint}
        footer={<>
          <div className="mr-auto flex items-center gap-2 text-sm font-black text-[#002d87]">
            <span className="text-slate-400 font-bold text-xs uppercase tracking-wide">Total</span>
            {detail?.sign === -1 ? '−' : ''}{money(detail?.total || 0)}
          </div>
          <button className="btn-ghost" onClick={() => setDetail(null)}>Fermer</button>
        </>}>
        {detail && (
          <div className="space-y-3">
            {detail.note && <p className="text-[11px] text-slate-400 italic px-1">{detail.note}</p>}
            {/* Le total en pied de fenêtre est celui du bloc : filtré, c'est la
                PART de l'activité. Y dérouler des comptes entiers ferait
                cohabiter deux chiffres qui ne s'additionnent pas — le détail
                montre alors les parts, qui font exactement ce total. */}
            {detail.key === 'banks' && !filtered && r.accounts.length
              ? <div className="space-y-2">{r.accounts.map((a: TreasuryAccount) => <AccountCard key={a.id} account={a} />)}</div>
              : <RowList rows={detail.rows} negative={detail.sign === -1} />}
          </div>
        )}
      </Modal>
    </div>
  );
}
