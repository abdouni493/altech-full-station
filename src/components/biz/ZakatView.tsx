/**
 * ─── Zakât ─────────────────────────────────────────────────────────────────────
 * Le calculateur de zakât sur les biens de commerce, entièrement paramétrable :
 * l'utilisateur décide du taux, du nisâb (or, argent ou seuil saisi), de la
 * valorisation du stock, des composants qui entrent dans l'assiette, de la part
 * douteuse des créances, de la date de début du hawl — et peut ajouter ses
 * propres lignes (or personnel, avances, charges à payer…).
 *
 * Les montants viennent de l'application elle-même : caisses, banques, stock,
 * créances clients et dettes fournisseurs. Rien n'est saisi deux fois.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  Moon, Settings2, Scale, Coins, Plus, Trash2, Info, CalendarClock, CheckCircle2,
  AlertTriangle, Landmark, Boxes, Users, Truck, PiggyBank, Sparkles, RotateCcw,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { cn, newId } from '@/src/lib/utils';
import { money, formatDate, Field, Input, Select, Switch, Table, Badge } from '@/src/components/biz/Kit';
import {
  ZakatConfig, ZakatInputs, ZakatResult, ZakatCustomLine, DEFAULT_ZAKAT_CONFIG,
  computeZakat, saveZakatConfig, RATE_LUNAR, RATE_SOLAR, NISAB_GOLD_GRAMS, NISAB_SILVER_GRAMS,
} from '@/src/lib/zakat';

const COMPONENT_ICON: Record<string, React.ElementType> = {
  caisse: PiggyBank, banques: Landmark, creances: Users, dettes: Truck,
  'stock-carburant': Boxes, 'stock-restaurant': Boxes, 'stock-cafeteria': Boxes, 'stock-lavage': Boxes, 'stock-magasin2': Boxes,
};

const INCLUDE_LABEL: { key: keyof ZakatConfig['include']; label: string; hint: string }[] = [
  { key: 'caisse', label: 'Liquidités en caisse', hint: 'Caisse générale et caisses des activités' },
  { key: 'banques', label: 'Comptes bancaires', hint: 'Soldes de tous les comptes' },
  { key: 'stockCarburant', label: 'Stock Carburant', hint: 'Cuves + boutique de la station' },
  { key: 'stockRestaurant', label: 'Stock Restaurant', hint: 'Catalogue + comptoir' },
  { key: 'stockCafeteria', label: 'Stock Cafétéria', hint: 'Catalogue + comptoir' },
  { key: 'stockLavage', label: 'Stock Magasin', hint: 'Catalogue de la partie' },
  { key: 'stockMagasin2', label: 'Stock Magasin 2', hint: 'Catalogue du second magasin' },
  { key: 'creances', label: 'Créances clients', hint: 'Ventes à crédit récupérables' },
  { key: 'dettesFournisseurs', label: 'Dettes fournisseurs (déduites)', hint: 'Retranchées de l\'assiette' },
];

export default function ZakatView({ inputs, config, onConfig }: {
  inputs: ZakatInputs;
  config: ZakatConfig;
  onConfig: (cfg: ZakatConfig) => void;
}) {
  const [tab, setTab] = useState<'resultat' | 'reglages'>('resultat');
  const result = useMemo(() => computeZakat(inputs, config), [inputs, config]);

  const set = (patch: Partial<ZakatConfig>) => {
    const next = { ...config, ...patch };
    onConfig(next);
    saveZakatConfig(next);
  };
  const setInclude = (patch: Partial<ZakatConfig['include']>) =>
    set({ include: { ...config.include, ...patch } });

  return (
    <div className="space-y-6">
      <div className="tab-bar">
        <button className={cn('tab-item flex items-center gap-1.5', tab === 'resultat' && 'tab-item-active')}
          onClick={() => setTab('resultat')}><Scale className="w-4 h-4" /> Calcul de la zakât</button>
        <button className={cn('tab-item flex items-center gap-1.5', tab === 'reglages' && 'tab-item-active')}
          onClick={() => setTab('reglages')}><Settings2 className="w-4 h-4" /> Paramètres du calcul</button>
      </div>

      {tab === 'resultat'
        ? <ZakatResultPanel result={result} config={config} onOpenSettings={() => setTab('reglages')} />
        : <ZakatSettingsPanel config={config} set={set} setInclude={setInclude} result={result} />}
    </div>
  );
}

// ─── Résultat ────────────────────────────────────────────────────────────────
function ZakatResultPanel({ result: z, config, onOpenSettings }: {
  result: ZakatResult; config: ZakatConfig; onOpenSettings: () => void;
}) {
  const due = z.aboveNisab && (z.hawl.complete || z.hawl.unset);
  const included = z.components.filter(c => c.included);

  return (
    <div className="space-y-6">
      {/* ── Le montant ── */}
      <div className="rounded-2xl p-6 text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
        style={{ background: due ? 'linear-gradient(135deg,#065f46,#047857)' : 'linear-gradient(135deg,#001f5c,#003087)' }}>
        <div className="min-w-0">
          <p className="text-sm font-bold uppercase tracking-wide opacity-90 flex items-center gap-2">
            <Moon className="w-4 h-4" /> Zakât due — {z.rate} % de l'assiette
          </p>
          <p className="text-xs opacity-80 mt-1 leading-relaxed">
            Assiette {money(z.base)} = actifs zakatables {money(z.assets)} − dettes exigibles {money(z.liabilities)}.
          </p>
          <p className="text-xs opacity-80 mt-1">
            Nisâb : {money(z.nisab)} ({z.nisabLabel}).{' '}
            {z.aboveNisab
              ? 'L\'assiette dépasse le nisâb : la zakât est due.'
              : `Il manque ${money(z.toNisab)} pour atteindre le nisâb — aucune zakât n'est due.`}
          </p>
        </div>
        <p className="text-4xl font-black tabular-nums shrink-0" style={{ color: due ? '#fff' : '#FFB800' }}>
          {money(z.zakat)}
        </p>
      </div>

      {/* ── Nisâb & hawl ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className={cn('rounded-2xl border p-4', z.aboveNisab ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50')}>
          <div className="flex items-center gap-2">
            {z.aboveNisab
              ? <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              : <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />}
            <p className={cn('text-sm font-black', z.aboveNisab ? 'text-emerald-800' : 'text-amber-800')}>
              {z.aboveNisab ? 'Nisâb atteint' : 'Nisâb non atteint'}
            </p>
          </div>
          <p className={cn('text-xs mt-1 leading-relaxed', z.aboveNisab ? 'text-emerald-700' : 'text-amber-700')}>
            Seuil {money(z.nisab)} — {z.nisabLabel}.
            {z.nisab <= 0 && ' Renseignez le prix du métal dans les paramètres pour fixer le seuil.'}
          </p>
        </div>

        <div className={cn('rounded-2xl border p-4', z.hawl.unset ? 'border-slate-200 bg-slate-50' : z.hawl.complete ? 'border-emerald-200 bg-emerald-50' : 'border-blue-200 bg-blue-50')}>
          <div className="flex items-center gap-2">
            <CalendarClock className={cn('w-5 h-5 shrink-0', z.hawl.unset ? 'text-slate-500' : z.hawl.complete ? 'text-emerald-600' : 'text-blue-600')} />
            <p className="text-sm font-black text-slate-800">Année (hawl)</p>
          </div>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">
            {z.hawl.unset
              ? 'Aucune date de départ saisie — indiquez-la dans les paramètres pour suivre l\'échéance.'
              : z.hawl.complete
                ? `Année complète depuis le ${formatDate(z.hawl.start)} — l'échéance du ${formatDate(z.hawl.end)} est passée.`
                : `Commencée le ${formatDate(z.hawl.start)} · échéance le ${formatDate(z.hawl.end)} — ${z.hawl.daysLeft} jour(s) restants.`}
          </p>
          {!z.hawl.unset && (
            <div className="h-1.5 rounded-full bg-white/70 mt-2 overflow-hidden">
              <div className={cn('h-full rounded-full', z.hawl.complete ? 'bg-emerald-500' : 'bg-blue-500')}
                style={{ width: `${Math.min(100, (z.hawl.daysElapsed / z.hawl.daysTotal) * 100)}%` }} />
            </div>
          )}
        </div>

        <button onClick={onOpenSettings}
          className="rounded-2xl border border-slate-200 bg-white p-4 text-left hover:border-[#003087]/40 hover:shadow-md transition-all">
          <div className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-[#003087] shrink-0" />
            <p className="text-sm font-black text-slate-800">Méthode appliquée</p>
          </div>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            Taux {z.rate} % ({config.yearType === 'lunar' ? 'année lunaire, 354 j' : 'année grégorienne, 365 j'}) ·
            stock valorisé au {config.stockBasis === 'sale' ? 'prix de vente' : 'prix d\'achat'}
            {config.doubtfulPct > 0 ? ` · ${config.doubtfulPct} % de créances douteuses écartées` : ''}.
            <span className="block font-black text-[#003087] mt-1">Modifier les paramètres →</span>
          </p>
        </button>
      </div>

      {/* ── L'assiette, composant par composant ── */}
      <div className="space-y-3">
        <h3 className="font-black text-[#002d87] flex items-center gap-2">
          <Coins className="w-5 h-5 text-[#FFB800]" /> Composition de l'assiette zakatable
        </h3>
        <Table head={<>
          <th className="table-head">Composant</th>
          <th className="table-head">Retenu</th>
          <th className="table-head text-right">Montant</th>
        </>}>
          {z.components.map(c => {
            const Icon = COMPONENT_ICON[c.key] || (c.custom ? Sparkles : Coins);
            return (
              <tr key={c.key} className={cn(!c.included && 'opacity-45')}>
                <td className="table-cell">
                  <div className="font-bold text-slate-700 flex items-center gap-2">
                    <Icon className="w-4 h-4 text-slate-400 shrink-0" />
                    {c.label}
                    {c.custom && <Badge tone="info">Ligne ajoutée</Badge>}
                  </div>
                  <div className="text-[11px] text-slate-400">{c.hint}</div>
                </td>
                <td className="table-cell">
                  {c.included
                    ? <Badge tone={c.sign === 1 ? 'success' : 'danger'}>{c.sign === 1 ? 'Ajouté' : 'Déduit'}</Badge>
                    : <Badge tone="neutral">Exclu</Badge>}
                </td>
                <td className={cn('table-cell text-right tabular-nums font-black',
                  !c.included ? 'text-slate-400 line-through' : c.sign === 1 ? 'text-emerald-600' : 'text-red-600')}>
                  {c.sign === -1 ? '−' : ''}{money(c.gross)}
                </td>
              </tr>
            );
          })}
          <tr className="bg-slate-50">
            <td className="table-cell font-black text-slate-600" colSpan={2}>Total des actifs zakatables</td>
            <td className="table-cell text-right tabular-nums font-black text-emerald-600">{money(z.assets)}</td>
          </tr>
          <tr className="bg-slate-50">
            <td className="table-cell font-black text-slate-600" colSpan={2}>Total des dettes exigibles</td>
            <td className="table-cell text-right tabular-nums font-black text-red-600">−{money(z.liabilities)}</td>
          </tr>
          <tr className="bg-blue-50/60">
            <td className="table-cell font-black text-[#002d87]" colSpan={2}>ASSIETTE ZAKATABLE</td>
            <td className="table-cell text-right tabular-nums font-black text-[#002d87]">{money(z.base)}</td>
          </tr>
          <tr className="bg-blue-50/60">
            <td className="table-cell font-black text-[#002d87]" colSpan={2}>ZAKÂT ({z.rate} %)</td>
            <td className="table-cell text-right tabular-nums font-black text-emerald-600">{money(z.zakat)}</td>
          </tr>
        </Table>
        <p className="text-[11px] text-slate-400 italic">
          {included.length} composant(s) retenu(s). Les immobilisations — bâtiment, cuves, pompes, matériel, véhicules
          de service — ne sont pas zakatables : elles servent à travailler et ne sont pas destinées à la vente.
          Elles n'apparaissent donc nulle part dans ce calcul.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
        <p className="text-xs text-slate-500 leading-relaxed">
          <b className="text-slate-700">Méthode retenue.</b> Zakât sur les biens de commerce (زكاة عروض التجارة) :
          liquidités + marchandise destinée à la vente + créances récupérables − dettes exigibles, le tout à
          {' '}{z.rate} % dès lors que l'assiette atteint le nisâb et qu'une année complète s'est écoulée.
          C'est le calcul appliqué par les calculateurs de référence. Ce résultat reste une aide au calcul :
          pour un cas particulier (créances anciennes, associés, dettes à long terme), demandez l'avis d'un savant.
        </p>
      </div>
    </div>
  );
}

// ─── Paramètres ──────────────────────────────────────────────────────────────
function ZakatSettingsPanel({ config: c, set, setInclude, result: z }: {
  config: ZakatConfig;
  set: (patch: Partial<ZakatConfig>) => void;
  setInclude: (patch: Partial<ZakatConfig['include']>) => void;
  result: ZakatResult;
}) {
  const [line, setLine] = useState<{ label: string; amount: string; kind: 'asset' | 'liability' }>({
    label: '', amount: '', kind: 'asset',
  });

  const addLine = () => {
    const amount = Number(line.amount) || 0;
    if (!line.label.trim() || amount <= 0) { toast.error('Un libellé et un montant sont requis'); return; }
    const next: ZakatCustomLine = { id: newId(), label: line.label.trim(), amount, kind: line.kind };
    set({ customLines: [...c.customLines, next] });
    setLine({ label: '', amount: '', kind: 'asset' });
    toast.success('Ligne ajoutée au calcul');
  };
  const removeLine = (id: string) => set({ customLines: c.customLines.filter(l => l.id !== id) });

  return (
    <div className="space-y-5">
      {/* ── Taux & année ── */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <header className="px-5 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200">
          <h4 className="text-[13px] font-black uppercase tracking-wider text-[#002d87] flex items-center gap-2">
            <Moon className="w-4 h-4" /> Taux et année de référence
          </h4>
          <p className="text-[11px] text-slate-400 mt-0.5">
            2,5 % sur une année lunaire (354 jours). Sur une comptabilité en année grégorienne, l'équivalent est 2,577 %.
          </p>
        </header>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Type d'année">
            <Select value={c.yearType}
              onChange={e => {
                const yearType = e.target.value as ZakatConfig['yearType'];
                set({ yearType, rate: yearType === 'lunar' ? RATE_LUNAR : RATE_SOLAR });
              }}>
              <option value="lunar">Année lunaire (hégirienne) — 354 jours</option>
              <option value="solar">Année grégorienne — 365 jours</option>
            </Select>
          </Field>
          <Field label="Taux appliqué (%)" hint="Modifiable si votre référence retient un autre taux.">
            <Input type="number" step="0.001" min={0} value={c.rate}
              onChange={e => set({ rate: Number(e.target.value) })} className="text-right" />
          </Field>
          <Field label="Début de l'année zakatable (hawl)"
            hint="La zakât n'est due qu'après une année complète au-dessus du nisâb.">
            <Input type="date" value={c.hawlStart ? c.hawlStart.slice(0, 10) : ''}
              onChange={e => set({ hawlStart: e.target.value })} />
          </Field>
        </div>
      </section>

      {/* ── Nisâb ── */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <header className="px-5 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200">
          <h4 className="text-[13px] font-black uppercase tracking-wider text-[#002d87] flex items-center gap-2">
            <Scale className="w-4 h-4" /> Nisâb — le seuil d'imposition
          </h4>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Contre-valeur de {NISAB_GOLD_GRAMS} g d'or ou de {NISAB_SILVER_GRAMS} g d'argent. Le nisâb argent, plus bas,
            est souvent préféré : il rend la zakât due plus tôt, au bénéfice des ayants droit.
          </p>
        </header>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Mode de calcul du nisâb">
              <Select value={c.nisabMode} onChange={e => set({ nisabMode: e.target.value as ZakatConfig['nisabMode'] })}>
                <option value="silver">Argent — {NISAB_SILVER_GRAMS} g</option>
                <option value="gold">Or — {NISAB_GOLD_GRAMS} g</option>
                <option value="manual">Montant saisi à la main</option>
              </Select>
            </Field>

            {c.nisabMode === 'gold' && (
              <>
                <Field label="Prix du gramme d'or (DA)">
                  <Input type="number" step="0.01" min={0} value={c.goldPricePerGram}
                    onChange={e => set({ goldPricePerGram: Number(e.target.value) })} className="text-right" />
                </Field>
                <Field label="Grammes retenus">
                  <Input type="number" step="1" min={0} value={c.goldGrams}
                    onChange={e => set({ goldGrams: Number(e.target.value) })} className="text-right" />
                </Field>
              </>
            )}
            {c.nisabMode === 'silver' && (
              <>
                <Field label="Prix du gramme d'argent (DA)">
                  <Input type="number" step="0.01" min={0} value={c.silverPricePerGram}
                    onChange={e => set({ silverPricePerGram: Number(e.target.value) })} className="text-right" />
                </Field>
                <Field label="Grammes retenus">
                  <Input type="number" step="1" min={0} value={c.silverGrams}
                    onChange={e => set({ silverGrams: Number(e.target.value) })} className="text-right" />
                </Field>
              </>
            )}
            {c.nisabMode === 'manual' && (
              <Field label="Nisâb (DA)" hint="Le seuil publié par votre référence locale.">
                <Input type="number" step="0.01" min={0} value={c.nisabManual}
                  onChange={e => set({ nisabManual: Number(e.target.value) })} className="text-right" />
              </Field>
            )}
          </div>

          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">Nisâb calculé</span>
            <span className="font-black tabular-nums text-lg text-[#002d87]">{money(z.nisab)}</span>
          </div>
        </div>
      </section>

      {/* ── Composants ── */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <header className="px-5 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200">
          <h4 className="text-[13px] font-black uppercase tracking-wider text-[#002d87] flex items-center gap-2">
            <Coins className="w-4 h-4" /> Ce qui entre dans l'assiette
          </h4>
          <p className="text-[11px] text-slate-400 mt-0.5">Désactivez un poste pour l'exclure entièrement du calcul.</p>
        </header>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {INCLUDE_LABEL.map(item => (
              <div key={item.key} className="rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-3 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-700">{item.label}</p>
                  <p className="text-[11px] text-slate-400">{item.hint}</p>
                </div>
                <Switch checked={c.include[item.key]} onChange={v => setInclude({ [item.key]: v } as any)} />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <Field label="Valorisation de la marchandise"
              hint="La valeur marchande (prix de vente) est la position la plus répandue pour les biens de commerce.">
              <Select value={c.stockBasis} onChange={e => set({ stockBasis: e.target.value as ZakatConfig['stockBasis'] })}>
                <option value="sale">Prix de vente — valeur marchande</option>
                <option value="purchase">Prix d'achat — prix de revient</option>
              </Select>
            </Field>
            <Field label="Créances jugées douteuses (%)"
              hint="Cette part est écartée de l'assiette : elle ne sera zakatée qu'une fois encaissée.">
              <Input type="number" step="1" min={0} max={100} value={c.doubtfulPct}
                onChange={e => set({ doubtfulPct: Number(e.target.value) })} className="text-right" />
            </Field>
          </div>
        </div>
      </section>

      {/* ── Lignes libres ── */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <header className="px-5 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200">
          <h4 className="text-[13px] font-black uppercase tracking-wider text-[#002d87] flex items-center gap-2">
            <Sparkles className="w-4 h-4" /> Lignes ajoutées à la main
          </h4>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Ce que l'application ne connaît pas : or et argent personnels, placements, avances reçues,
            salaires ou impôts à payer…
          </p>
        </header>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <Field label="Libellé">
              <Input value={line.label} onChange={e => setLine({ ...line, label: e.target.value })}
                placeholder="Or personnel, avance client…" />
            </Field>
            <Field label="Montant (DA)">
              <Input type="number" step="0.01" min={0} value={line.amount}
                onChange={e => setLine({ ...line, amount: e.target.value })} className="text-right" />
            </Field>
            <Field label="Nature">
              <Select value={line.kind} onChange={e => setLine({ ...line, kind: e.target.value as 'asset' | 'liability' })}>
                <option value="asset">Actif — s'ajoute à l'assiette</option>
                <option value="liability">Dette — se retranche</option>
              </Select>
            </Field>
            <button className="btn-primary h-[46px]" onClick={addLine}><Plus className="w-4 h-4" /> Ajouter</button>
          </div>

          {c.customLines.length === 0 ? (
            <p className="text-xs text-slate-400 italic">Aucune ligne ajoutée.</p>
          ) : (
            <div className="space-y-2">
              {c.customLines.map(l => (
                <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                  <Badge tone={l.kind === 'asset' ? 'success' : 'danger'}>{l.kind === 'asset' ? 'Actif' : 'Dette'}</Badge>
                  <span className="font-bold text-slate-700 text-sm min-w-0 flex-1 truncate">{l.label}</span>
                  <span className={cn('font-black tabular-nums', l.kind === 'asset' ? 'text-emerald-600' : 'text-red-600')}>
                    {l.kind === 'liability' ? '−' : ''}{money(l.amount)}
                  </span>
                  <button onClick={() => removeLine(l.id)} title="Retirer cette ligne"
                    className="p-2 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 transition-all">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-xs text-slate-500">
          Les paramètres sont conservés sur ce poste et réappliqués à chaque ouverture de l'écran.
        </p>
        <button className="btn-outline !py-2 !px-4 text-xs"
          onClick={() => { set({ ...DEFAULT_ZAKAT_CONFIG, customLines: [] }); toast.success('Paramètres réinitialisés'); }}>
          <RotateCcw className="w-4 h-4" /> Réinitialiser
        </button>
      </div>
    </div>
  );
}
