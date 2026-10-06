/**
 * ─── Calcul de la Zakât (zakât sur les biens de commerce) ──────────────────────
 *
 * Méthode retenue — celle des calculateurs de zakât de référence (Zakat
 * Foundation, National Zakat Foundation, Islamic Relief), appliquée au commerce
 * (زكاة عروض التجارة) :
 *
 *   ASSIETTE ZAKATABLE
 *     + Liquidités          : caisse(s) et comptes bancaires
 *     + Marchandise         : le stock destiné à la vente, valorisé à sa VALEUR
 *                             MARCHANDE (prix de vente) au jour de l'échéance —
 *                             le prix de revient reste possible en option
 *     + Créances récupérables : ce que les clients doivent et qu'on s'attend à
 *                             encaisser ; la part jugée douteuse est écartée
 *                             (elle ne sera zakatée qu'une fois encaissée)
 *     − Dettes exigibles    : ce qui est dû aux fournisseurs, les salaires et
 *                             charges à payer à court terme
 *     = ASSIETTE
 *
 *   Les IMMOBILISATIONS (bâtiment, cuves, pompes, matériel, véhicules de
 *   service) ne sont PAS zakatables : elles servent à travailler, elles ne sont
 *   pas destinées à la vente. C'est pourquoi rien ici ne les additionne.
 *
 *   NISÂB : seuil au-dessous duquel aucune zakât n'est due — la contre-valeur de
 *   85 g d'or ou de 595 g d'argent (le nisâb argent, plus bas, est souvent
 *   préféré car plus favorable aux ayants droit). Saisissable à la main aussi.
 *
 *   TAUX : 2,5 % sur une année LUNAIRE (hawl = 354 jours). Si la comptabilité
 *   suit l'année grégorienne (365,25 j), le taux équivalent est 2,577 %.
 *
 *   HAWL : la zakât n'est due que si l'assiette est restée au-dessus du nisâb
 *   pendant une année complète. La date de départ est choisie par l'utilisateur.
 *
 * Tout est paramétrable : taux, mode de nisâb et prix du métal, valorisation du
 * stock, composants inclus ou exclus, part douteuse des créances, plus des
 * lignes libres (or personnel, avances, charges à payer…). Les réglages sont
 * conservés dans le navigateur.
 * ──────────────────────────────────────────────────────────────────────────────
 */

// ─── Réglages ────────────────────────────────────────────────────────────────
export type NisabMode = 'gold' | 'silver' | 'manual';
export type YearType = 'lunar' | 'solar';
export type StockBasis = 'sale' | 'purchase';

/** Une ligne ajoutée à la main par l'utilisateur (actif ou passif). */
export interface ZakatCustomLine {
  id: string;
  label: string;
  amount: number;
  kind: 'asset' | 'liability';
  note?: string;
}

/** Composants calculés depuis l'application, activables un par un. */
export interface ZakatIncludes {
  caisse: boolean;
  banques: boolean;
  stockCarburant: boolean;
  stockRestaurant: boolean;
  stockCafeteria: boolean;
  stockLavage: boolean;
  /** Stock du second magasin (absent des réglages enregistrés avant lui ⇒ inclus). */
  stockMagasin2?: boolean;
  creances: boolean;
  dettesFournisseurs: boolean;
}

export interface ZakatConfig {
  /** Taux appliqué à l'assiette, en %. */
  rate: number;
  /** Année de référence — pilote le taux conseillé et la durée du hawl. */
  yearType: YearType;
  nisabMode: NisabMode;
  goldPricePerGram: number;
  silverPricePerGram: number;
  goldGrams: number;
  silverGrams: number;
  nisabManual: number;
  /** Valorisation de la marchandise : valeur marchande ou prix de revient. */
  stockBasis: StockBasis;
  /** Part des créances jugée irrécouvrable, en % — écartée de l'assiette. */
  doubtfulPct: number;
  include: ZakatIncludes;
  /** Début de l'année zakatable (hawl). */
  hawlStart: string;
  customLines: ZakatCustomLine[];
}

/** Taux canoniques : 2,5 % en année lunaire, son équivalent en année solaire. */
export const RATE_LUNAR = 2.5;
export const RATE_SOLAR = 2.577;
/** Durée du hawl, en jours. */
export const HAWL_DAYS: Record<YearType, number> = { lunar: 354, solar: 365 };
/** Nisâb classique : 85 g d'or, 595 g d'argent. */
export const NISAB_GOLD_GRAMS = 85;
export const NISAB_SILVER_GRAMS = 595;

export const DEFAULT_ZAKAT_CONFIG: ZakatConfig = {
  rate: RATE_LUNAR,
  yearType: 'lunar',
  nisabMode: 'silver',
  goldPricePerGram: 0,
  silverPricePerGram: 0,
  goldGrams: NISAB_GOLD_GRAMS,
  silverGrams: NISAB_SILVER_GRAMS,
  nisabManual: 0,
  stockBasis: 'sale',
  doubtfulPct: 0,
  include: {
    caisse: true,
    banques: true,
    stockCarburant: true,
    stockRestaurant: true,
    stockCafeteria: true,
    stockLavage: true,
    stockMagasin2: true,
    creances: true,
    dettesFournisseurs: true,
  },
  hawlStart: '',
  customLines: [],
};

const STORAGE_KEY = 'stationpro_zakat_v1';

export function loadZakatConfig(): ZakatConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ZAKAT_CONFIG };
    const saved = JSON.parse(raw);
    return {
      ...DEFAULT_ZAKAT_CONFIG,
      ...saved,
      include: { ...DEFAULT_ZAKAT_CONFIG.include, ...(saved?.include || {}) },
      customLines: Array.isArray(saved?.customLines) ? saved.customLines : [],
    };
  } catch {
    return { ...DEFAULT_ZAKAT_CONFIG };
  }
}

export function saveZakatConfig(cfg: ZakatConfig): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch { /* quota */ }
}

// ─── Entrées prises dans l'application ───────────────────────────────────────
/** Les montants que l'application sait fournir, avant tout arbitrage. */
export interface ZakatInputs {
  caisse: number;
  banques: number;
  /** Valeur du stock par partie, dans les deux valorisations. */
  stock: { key: 'carburant' | 'restaurant' | 'cafeteria' | 'lavage' | 'magasin2'; label: string; emoji: string; buyValue: number; sellValue: number }[];
  creances: number;
  dettesFournisseurs: number;
}

// ─── Résultat ────────────────────────────────────────────────────────────────
export interface ZakatComponent {
  key: string;
  label: string;
  hint: string;
  /** +1 : entre dans l'assiette. −1 : la diminue. */
  sign: 1 | -1;
  /** Montant brut, avant application des exclusions (part douteuse…). */
  gross: number;
  /** Montant réellement retenu (0 quand le composant est désactivé). */
  amount: number;
  included: boolean;
  /** Composant issu d'une ligne libre saisie par l'utilisateur. */
  custom?: boolean;
}

export interface ZakatResult {
  components: ZakatComponent[];
  /** Somme des composants positifs retenus. */
  assets: number;
  /** Somme des composants négatifs retenus. */
  liabilities: number;
  /** assets − liabilities. Jamais négative dans le calcul de la zakât. */
  base: number;
  nisab: number;
  nisabLabel: string;
  /** L'assiette atteint-elle le nisâb ? */
  aboveNisab: boolean;
  rate: number;
  /** Zakât due — 0 tant que le nisâb n'est pas atteint. */
  zakat: number;
  /** Ce qui manque pour atteindre le nisâb (0 s'il est atteint). */
  toNisab: number;
  hawl: {
    start: string;
    end: string;
    daysTotal: number;
    daysElapsed: number;
    daysLeft: number;
    complete: boolean;
    /** Aucune date de départ saisie : l'échéance ne peut pas être vérifiée. */
    unset: boolean;
  };
}

const num = (v: any): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Valeur du nisâb selon le mode choisi, avec son libellé explicatif. */
export function nisabOf(cfg: ZakatConfig): { value: number; label: string } {
  if (cfg.nisabMode === 'manual') {
    return { value: num(cfg.nisabManual), label: 'Seuil saisi manuellement' };
  }
  if (cfg.nisabMode === 'gold') {
    const g = num(cfg.goldGrams) || NISAB_GOLD_GRAMS;
    return {
      value: g * num(cfg.goldPricePerGram),
      label: `${g} g d'or × ${num(cfg.goldPricePerGram).toLocaleString('fr-FR')} DA/g`,
    };
  }
  const g = num(cfg.silverGrams) || NISAB_SILVER_GRAMS;
  return {
    value: g * num(cfg.silverPricePerGram),
    label: `${g} g d'argent × ${num(cfg.silverPricePerGram).toLocaleString('fr-FR')} DA/g`,
  };
}

/** État du hawl (année de possession) à la date du jour. */
export function hawlOf(cfg: ZakatConfig, now = new Date()): ZakatResult['hawl'] {
  const daysTotal = HAWL_DAYS[cfg.yearType];
  const startMs = cfg.hawlStart ? new Date(cfg.hawlStart).getTime() : NaN;
  if (!cfg.hawlStart || Number.isNaN(startMs)) {
    return { start: '', end: '', daysTotal, daysElapsed: 0, daysLeft: daysTotal, complete: false, unset: true };
  }
  const endMs = startMs + daysTotal * 86_400_000;
  const elapsed = Math.floor((now.getTime() - startMs) / 86_400_000);
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    daysTotal,
    daysElapsed: Math.max(0, elapsed),
    daysLeft: Math.max(0, daysTotal - elapsed),
    complete: now.getTime() >= endMs,
    unset: false,
  };
}

/**
 * Calcule la zakât due sur les biens de commerce de la station.
 *
 * La zakât n'est prélevée que si l'assiette atteint le nisâb : en dessous, le
 * résultat est explicitement zéro (et non « un petit montant »), c'est la règle.
 */
export function computeZakat(inputs: ZakatInputs, cfg: ZakatConfig, now = new Date()): ZakatResult {
  const inc = cfg.include;
  const stockValueOf = (s: ZakatInputs['stock'][number]) =>
    cfg.stockBasis === 'sale' ? s.sellValue : s.buyValue;
  const stockHint = cfg.stockBasis === 'sale'
    ? 'valorisé au prix de vente (valeur marchande)'
    : 'valorisé au prix d\'achat (prix de revient)';

  const doubtful = Math.min(100, Math.max(0, num(cfg.doubtfulPct)));
  const creancesNettes = num(inputs.creances) * (1 - doubtful / 100);

  const stockPart = (key: 'carburant' | 'restaurant' | 'cafeteria' | 'lavage' | 'magasin2', on: boolean): ZakatComponent => {
    const s = inputs.stock.find(x => x.key === key);
    const gross = s ? stockValueOf(s) : 0;
    return {
      key: `stock-${key}`,
      label: `Marchandise — ${s?.label || key}`,
      hint: `${s?.emoji || ''} Stock destiné à la vente, ${stockHint}`.trim(),
      sign: 1, gross, amount: on ? gross : 0, included: on,
    };
  };

  const components: ZakatComponent[] = [
    {
      key: 'caisse', label: 'Liquidités en caisse',
      hint: 'Caisse générale et caisses des activités',
      sign: 1, gross: num(inputs.caisse), amount: inc.caisse ? num(inputs.caisse) : 0, included: inc.caisse,
    },
    {
      key: 'banques', label: 'Comptes bancaires',
      hint: 'Soldes de tous les comptes de la station',
      sign: 1, gross: num(inputs.banques), amount: inc.banques ? num(inputs.banques) : 0, included: inc.banques,
    },
    stockPart('carburant', inc.stockCarburant),
    stockPart('restaurant', inc.stockRestaurant !== false),
    stockPart('cafeteria', inc.stockCafeteria),
    stockPart('lavage', inc.stockLavage),
    // Le second magasin n'apparaît que s'il existe (son stock est alors fourni).
    ...(inputs.stock.some(x => x.key === 'magasin2') ? [stockPart('magasin2', inc.stockMagasin2 !== false)] : []),
    {
      key: 'creances', label: 'Créances clients récupérables',
      hint: doubtful > 0
        ? `Encours clients moins ${doubtful} % jugés douteux (${Math.round(num(inputs.creances)).toLocaleString('fr-FR')} DA d'encours total)`
        : 'Ventes à crédit que la station s\'attend à encaisser',
      sign: 1, gross: creancesNettes, amount: inc.creances ? creancesNettes : 0, included: inc.creances,
    },
    {
      key: 'dettes', label: 'Dettes fournisseurs exigibles',
      hint: 'Achats reçus et non réglés — déduits de l\'assiette',
      sign: -1, gross: num(inputs.dettesFournisseurs),
      amount: inc.dettesFournisseurs ? num(inputs.dettesFournisseurs) : 0,
      included: inc.dettesFournisseurs,
    },
    ...cfg.customLines.map((l): ZakatComponent => ({
      key: `custom-${l.id}`,
      label: l.label || (l.kind === 'asset' ? 'Actif ajouté' : 'Dette ajoutée'),
      hint: l.note || (l.kind === 'asset' ? 'Ligne ajoutée manuellement — entre dans l\'assiette' : 'Ligne ajoutée manuellement — déduite de l\'assiette'),
      sign: l.kind === 'asset' ? 1 : -1,
      gross: num(l.amount), amount: num(l.amount), included: true, custom: true,
    })),
  ];

  const assets = components.filter(c => c.sign === 1).reduce((s, c) => s + c.amount, 0);
  const liabilities = components.filter(c => c.sign === -1).reduce((s, c) => s + c.amount, 0);
  const base = assets - liabilities;

  const { value: nisab, label: nisabLabel } = nisabOf(cfg);
  // Un nisâb à zéro veut dire « prix du métal non renseigné » : on ne peut pas
  // décider, alors on ne bloque pas le calcul — le seuil sera simplement à 0.
  const aboveNisab = base > 0 && base >= nisab;
  const rate = num(cfg.rate);

  return {
    components,
    assets, liabilities, base,
    nisab, nisabLabel, aboveNisab,
    rate,
    zakat: aboveNisab ? (base * rate) / 100 : 0,
    toNisab: aboveNisab ? 0 : Math.max(0, nisab - Math.max(0, base)),
    hawl: hawlOf(cfg, now),
  };
}
