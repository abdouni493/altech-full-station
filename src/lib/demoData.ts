/**
 * ─── JEU DE DONNÉES CONSTANT POUR LES TESTS (MODE DÉMO) ───────────────────────
 * Lignes « telles que la base les stockerait » (colonnes snake_case), chargées
 * dans la base locale de `mockSupabase.ts`. Chaque interface de l'application a
 * ainsi quelque chose à afficher, sans aucune connexion à une base de données.
 *
 * Les dates sont relatives au jour d'ouverture (aujourd'hui, hier, J-2…) pour
 * que les tableaux de bord, rapports et filtres « ce mois-ci » soient remplis.
 * ──────────────────────────────────────────────────────────────────────────────
 */

export interface DemoAccount {
  id: string;
  email: string;
  username: string;
  password: string;
  name: string;
}

/** Identifiants du compte administrateur de démonstration. */
export const DEMO_ADMIN = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'admin@demo.dz',
  username: 'admin',
  password: 'demo1234',
  name: 'Administrateur Démo',
} as const;

const POMPISTE_AUTH_ID = '00000000-0000-4000-8000-000000000002';
const CHEF_AUTH_ID = '00000000-0000-4000-8000-000000000003';
const GERANT_AUTH_ID = '00000000-0000-4000-8000-000000000004';
const CAF_WORKER_AUTH_ID = '00000000-0000-4000-8000-000000000005';

/** Comptes qui peuvent se connecter (mot de passe : demo1234). */
export const DEMO_ACCOUNTS: DemoAccount[] = [
  { ...DEMO_ADMIN },
  { id: POMPISTE_AUTH_ID, email: 'pompiste@demo.dz', username: 'pompiste', password: 'demo1234', name: 'Karim Benali' },
  { id: CHEF_AUTH_ID, email: 'chef@demo.dz', username: 'chef', password: 'demo1234', name: 'Mourad Haddad' },
  { id: GERANT_AUTH_ID, email: 'gerant@demo.dz', username: 'gerant', password: 'demo1234', name: 'Samir Khelifi' },
  { id: CAF_WORKER_AUTH_ID, email: 'cafeteria@demo.dz', username: 'cafeteria', password: 'demo1234', name: 'Nadia Belkacem' },
];

// ─── Dates ─────────────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0');
function dayAgo(n: number): Date { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d; }
/** YYYY-MM-DD, n jours avant aujourd'hui. */
const D = (n: number) => { const d = dayAgo(n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** Horodatage ISO, n jours avant aujourd'hui à l'heure h. */
const T = (n: number, h = 10, m = 0) => { const d = dayAgo(n); d.setHours(h, m, 0, 0); return d.toISOString(); };
/** Mois courant / précédent au format YYYY-MM. */
const M = (back: number) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - back); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };

const round2 = (n: number) => Math.round(n * 100) / 100;

// ─── Carburant ─────────────────────────────────────────────────────────────────
const PRICES = { ESSENCE: 45.62, GASOIL: 29.01, GPL: 9, SUPER: 47.5, DIESEL: 29.01 };
const BUY_PRICES = { ESSENCE: 41.5, GASOIL: 26.2, GPL: 7.5, SUPER: 43, DIESEL: 26.2 };

const tracks = [
  { id: 'trk-1', name: 'Piste 1', created_at: T(60) },
  { id: 'trk-2', name: 'Piste 2', created_at: T(60) },
];

const tanks = [
  { id: 'tank-1', name: 'Cuve Essence', type: 'ESSENCE', capacity: 30000, current: 18450, degrees: 152, alert_threshold: 5000, notes: 'Cuve principale essence', is_favorite: true, created_at: T(60) },
  { id: 'tank-2', name: 'Cuve Gasoil', type: 'GASOIL', capacity: 40000, current: 26300, degrees: 168, alert_threshold: 6000, notes: null, is_favorite: true, created_at: T(60) },
  { id: 'tank-3', name: 'Cuve GPL', type: 'GPL', capacity: 20000, current: 4200, degrees: 61, alert_threshold: 5000, notes: 'Niveau bas — commande en cours', is_favorite: false, created_at: T(60) },
];

const pumps = [
  { id: 'pump-1', number: 1, name: 'Pompe 1', tank_id: 'tank-1', track_id: 'trk-1', type: 'ESSENCE', last_index: 0, status: 'Actif', current_brigade_start_index: null, created_at: T(60, 8) },
  { id: 'pump-2', number: 2, name: 'Pompe 2', tank_id: 'tank-2', track_id: 'trk-2', type: 'GASOIL', last_index: 0, status: 'Actif', current_brigade_start_index: null, created_at: T(60, 9) },
];

const NOZZLES = [
  { id: 'noz-1', pump_id: 'pump-1', name: 'Pistolet Essence', tank_id: 'tank-1', fuel: 'ESSENCE' as const, start: 125000 },
  { id: 'noz-2', pump_id: 'pump-1', name: 'Pistolet Gasoil', tank_id: 'tank-2', fuel: 'GASOIL' as const, start: 238000 },
  { id: 'noz-3', pump_id: 'pump-2', name: 'Pistolet Gasoil', tank_id: 'tank-2', fuel: 'GASOIL' as const, start: 310500 },
  { id: 'noz-4', pump_id: 'pump-2', name: 'Pistolet GPL', tank_id: 'tank-3', fuel: 'GPL' as const, start: 54000 },
];

// ─── Personnel ─────────────────────────────────────────────────────────────────
const pompistes = [
  { id: 'pmp-1', name: 'Karim Benali', phone: '0550 12 34 56', email: 'pompiste@demo.dz', cin: '109876543', address: 'Cité 200 logements, Sétif', photo_url: null, status: 'Actif', track_id: 'trk-1', chef_id: 'chef-1', base_salary: 38000, salary_type: 'mois', work_days: null, cnas_date: D(400), has_access: true, username: 'pompiste', auth_user_id: POMPISTE_AUTH_ID, permissions: { dashboard: true, my_brigade: true, my_payments: true }, hire_date: D(400), created_at: T(400) },
  { id: 'pmp-2', name: 'Yacine Mansouri', phone: '0551 22 33 44', email: null, cin: '108765432', address: 'El Eulma', photo_url: null, status: 'Actif', track_id: 'trk-2', chef_id: 'chef-1', base_salary: 36000, salary_type: 'mois', work_days: null, cnas_date: D(300), has_access: false, username: null, auth_user_id: null, permissions: {}, hire_date: D(300), created_at: T(300) },
  { id: 'pmp-3', name: 'Rachid Bouzid', phone: '0660 45 67 89', email: null, cin: '107654321', address: 'Ain Arnat', photo_url: null, status: 'Actif', track_id: 'trk-1', chef_id: 'chef-2', base_salary: 1500, salary_type: 'jour', work_days: [0, 1, 2, 3, 4, 6], cnas_date: null, has_access: false, username: null, auth_user_id: null, permissions: {}, hire_date: D(120), created_at: T(120) },
  { id: 'pmp-4', name: 'Fares Djebbar', phone: '0770 98 76 54', email: null, cin: '106543210', address: 'Sétif centre', photo_url: null, status: 'Inactif', track_id: 'trk-2', chef_id: 'chef-2', base_salary: 35000, salary_type: 'mois', work_days: null, cnas_date: null, has_access: false, username: null, auth_user_id: null, permissions: {}, hire_date: D(500), created_at: T(500) },
];

const brigade_chefs = [
  { id: 'chef-1', name: 'Mourad Haddad', phone: '0552 11 22 33', email: 'chef@demo.dz', cin: '105432109', address: 'Sétif', photo_url: null, status: 'Actif', base_salary: 48000, has_access: true, username: 'chef', auth_user_id: CHEF_AUTH_ID, permissions: { dashboard: true, brigades: true, brigades_create: true, pumps: true, tanks: true }, hire_date: D(700), created_at: T(700) },
  { id: 'chef-2', name: 'Hichem Saadi', phone: '0553 44 55 66', email: null, cin: '104321098', address: 'Bougaa', photo_url: null, status: 'Actif', base_salary: 46000, has_access: false, username: null, auth_user_id: null, permissions: {}, hire_date: D(350), created_at: T(350) },
];

const chef_pompiste_assignments = [
  { chef_id: 'chef-1', pompiste_id: 'pmp-1' },
  { chef_id: 'chef-1', pompiste_id: 'pmp-2' },
  { chef_id: 'chef-2', pompiste_id: 'pmp-3' },
  { chef_id: 'chef-2', pompiste_id: 'pmp-4' },
];

const gerants = [
  { id: 'ger-1', name: 'Samir Khelifi', phone: '0554 77 88 99', email: 'gerant@demo.dz', cin: '103210987', address: 'Sétif', photo_url: null, status: 'Actif', base_salary: 65000, salary_type: 'mois', work_days: null, cnas_date: D(800), has_access: true, username: 'gerant', auth_user_id: GERANT_AUTH_ID, permissions: { dashboard: true, brigades: true, clients: true, suppliers: true, fuel_purchases: true, expenses: true, reports: true, statistics: true, tanks: true, pumps: true, inventory: true }, hire_date: D(800), created_at: T(800) },
];

const magasin_workers = [
  { id: 'mag-1', name: 'Amina Zerrouki', phone: '0555 10 20 30', email: null, cin: '102109876', address: 'Sétif', photo_url: null, status: 'Actif', base_salary: 34000, salary_type: 'mois', work_days: null, cnas_date: D(200), has_access: false, username: null, auth_user_id: null, permissions: {}, hire_date: D(200), created_at: T(200) },
  { id: 'mag-2', name: 'Lyes Ferhat', phone: '0556 40 50 60', email: null, cin: '101098765', address: 'El Eulma', photo_url: null, status: 'Actif', base_salary: 1300, salary_type: 'jour', work_days: [0, 1, 2, 3, 4], cnas_date: null, has_access: false, username: null, auth_user_id: null, permissions: {}, hire_date: D(90), created_at: T(90) },
];

const worker_acomptes = [
  { id: 'acp-1', worker_id: 'pmp-1', worker_type: 'pompiste', date: D(10), amount: 5000, description: 'Avance sur salaire', is_paid: false, month_paid: null, created_at: T(10) },
  { id: 'acp-2', worker_id: 'pmp-2', worker_type: 'pompiste', date: D(6), amount: 3000, description: 'Avance', is_paid: false, month_paid: null, created_at: T(6) },
  { id: 'acp-3', worker_id: 'chef-1', worker_type: 'chef_brigade', date: D(12), amount: 8000, description: 'Avance', is_paid: false, month_paid: null, created_at: T(12) },
  { id: 'acp-4', worker_id: 'mag-1', worker_type: 'magasin', date: D(4), amount: 2000, description: 'Avance', is_paid: false, month_paid: null, created_at: T(4) },
];

const worker_absences = [
  { id: 'abs-1', worker_id: 'pmp-2', worker_type: 'pompiste', date: D(15), cost: 1200, description: 'Absence non justifiée', is_paid: false, month_paid: null, created_at: T(15) },
  { id: 'abs-2', worker_id: 'ger-1', worker_type: 'gerant', date: D(20), cost: 2100, description: 'Congé sans solde', is_paid: false, month_paid: null, created_at: T(20) },
];

const payRec = (id: string, worker_id: string, worker_type: string, base: number, acomptes = 0, absences = 0) => ({
  id, worker_id, worker_type, month: M(1), base_salary: base, total_acomptes: acomptes, total_absences: absences,
  bonus_decalage: 0, retenue_decalage: 0, net_salary: base - acomptes - absences,
  payment_date: D(28), payment_mode: 'ESPECES', cheque_number: null, notes: 'Salaire du mois précédent', is_paid: true,
  paid_days: null, paid_months: [M(1)], decalage_ids: null, prime_type: null, prime_value: null, prime_amount: null, created_at: T(28),
});

const worker_payment_records = [
  payRec('pay-1', 'pmp-1', 'pompiste', 38000, 4000),
  payRec('pay-2', 'pmp-2', 'pompiste', 36000),
  payRec('pay-3', 'chef-1', 'chef_brigade', 48000, 5000),
  payRec('pay-4', 'ger-1', 'gerant', 65000),
  payRec('pay-5', 'mag-1', 'magasin', 34000),
];

// ─── Clients & fournisseurs ────────────────────────────────────────────────────
const clients = [
  { id: 'cli-1', name: 'Transport Hamdi SARL', phone: '036 84 12 12', cin: null, email: 'contact@hamdi-transport.dz', address: 'Zone industrielle, Sétif', contact_person: 'M. Hamdi', balance: 0, debt: 86500, credit_limit: 300000, payment_delay: 30, type: 'ENTREPRISE', payment_mode: 'CREDIT', nif: '000219012345678', nis: '0002190123', article: '19012345', rc: '19/00-0123456B12', advance_balance: 0, opening_debt: 40000, opening_advance: 0, opening_date: D(90), opening_notes: 'Reprise de dette', created_at: T(90) },
  { id: 'cli-2', name: 'APC Sétif', phone: '036 90 00 00', cin: null, email: null, address: 'Sétif', contact_person: 'Service parc auto', balance: 0, debt: 0, credit_limit: 500000, payment_delay: 60, type: 'GOUVERNEMENT', payment_mode: 'ADVANCE', nif: null, nis: null, article: null, rc: null, advance_balance: 120000, opening_debt: 0, opening_advance: 150000, opening_date: D(60), opening_notes: null, created_at: T(60) },
  { id: 'cli-3', name: 'Ahmed Touati', phone: '0661 23 45 67', cin: '100987654', email: null, address: 'El Eulma', contact_person: null, balance: 0, debt: 12400, credit_limit: 50000, payment_delay: 15, type: 'PARTICULIER', payment_mode: 'CREDIT', nif: null, nis: null, article: null, rc: null, advance_balance: 0, opening_debt: 0, opening_advance: 0, opening_date: null, opening_notes: null, created_at: T(45) },
  { id: 'cli-4', name: 'Taxi Ben Ali', phone: '0772 33 44 55', cin: '100876543', email: null, address: 'Sétif', contact_person: null, balance: 0, debt: 0, credit_limit: 0, payment_delay: 0, type: 'PARTICULIER', payment_mode: 'CASH', nif: null, nis: null, article: null, rc: null, advance_balance: 0, opening_debt: 0, opening_advance: 0, opening_date: null, opening_notes: null, created_at: T(30) },
];

const client_transactions = [
  { id: 'ctx-1', client_id: 'cli-1', date: D(20), type: 'PAYMENT', amount: 30000, mode: 'CHEQUE', receipt_number: 'CHQ-458721', receipt_photo_url: null, notes: 'Règlement partiel', created_at: T(20) },
  { id: 'ctx-2', client_id: 'cli-2', date: D(25), type: 'RECHARGE', amount: 50000, mode: 'VIREMENT', receipt_number: 'VIR-2231', receipt_photo_url: null, notes: 'Recharge avance', created_at: T(25) },
  { id: 'ctx-3', client_id: 'cli-3', date: D(5), type: 'PAYMENT', amount: 5000, mode: 'ESPECES', receipt_number: null, receipt_photo_url: null, notes: null, created_at: T(5) },
];

const client_appointments = [
  { id: 'capp-1', client_id: 'cli-1', sale_id: null, date: D(-7), amount: 40000, notes: 'Échéance mensuelle', is_paid: false },
];

const suppliers = [
  { id: 'sup-1', ref: 'FRN-001', name: 'Distributeur Carburant Est', contact: 'Service commercial', phone: '036 50 50 50', email: 'commandes@dce.dz', address: 'Route nationale 5, Sétif', balance: 450000, total_purchases: 3850000, nif: '000119087654321', nis: null, article: null, rc: '19/00-0099887B05', type: 'CARBURANT', created_at: T(200) },
  { id: 'sup-2', ref: 'FRN-002', name: 'Lubrifiants du Centre', contact: 'Mme Ouali', phone: '036 71 71 71', email: null, address: 'Bordj Bou Arreridj', balance: 38000, total_purchases: 265000, nif: null, nis: null, article: null, rc: null, type: 'PRODUITS', created_at: T(150) },
  { id: 'sup-3', ref: 'FRN-003', name: 'Accessoires Auto Pro', contact: 'M. Kaci', phone: '0560 99 88 77', email: null, address: 'Alger', balance: 0, total_purchases: 92000, nif: null, nis: null, article: null, rc: null, type: 'PRODUITS', created_at: T(120) },
];

const supplier_appointments = [
  { id: 'sapp-1', supplier_id: 'sup-1', purchase_id: null, date: D(-5), amount: 200000, notes: 'Règlement BL carburant', is_paid: false, created_at: T(10) },
];

const supplier_debt_payments = [
  { id: 'sdp-1', supplier_id: 'sup-1', purchase_id: null, delivery_note_id: 'dn-1', date: D(12), amount: 300000, total_due: 750000, rest: 450000, payment_mode: 'VIREMENT', cheque_number: null, notes: 'Acompte', created_at: T(12) },
];

const drivers = [
  { id: 'drv-1', name: 'Bilal Messaoudi', status: 'Actif', phone: '0557 66 77 88', email: null, address: 'Sétif', created_at: T(200) },
  { id: 'drv-2', name: 'Nabil Chergui', status: 'Actif', phone: '0558 11 00 22', email: null, address: 'Alger', created_at: T(150) },
];

// ─── Produits boutique carburant ───────────────────────────────────────────────
const product_brands = [
  { id: 'brd-1', name: 'TotalEnergies', created_at: T(100) },
  { id: 'brd-2', name: 'Castrol', created_at: T(100) },
  { id: 'brd-3', name: 'Générique', created_at: T(100) },
];

const prod = (id: string, ref: string, name: string, category: string, buy: number, sell: number, stock: number, min: number, brand: string, unit = 'unité') => ({
  id, ref, name, category, buy_price: buy, selling_price: sell, stock, min_stock: min, barcode: `613${ref.replace(/\D/g, '').padStart(10, '0')}`,
  image_url: null, unit, brand: product_brands.find(b => b.id === brand)?.name, brand_id: brand, last_selling_price: sell, tva_rate: 19,
  sell_by_details: false, detail_capacity: null, detail_unit: null, created_at: T(100),
});

const products = [
  prod('prd-1', 'P001', 'Huile moteur 5W30 — 5 L', 'Lubrifiants', 3200, 4100, 24, 5, 'brd-1'),
  prod('prd-2', 'P002', 'Huile moteur 10W40 — 4 L', 'Lubrifiants', 2100, 2750, 18, 5, 'brd-2'),
  prod('prd-3', 'P003', 'Liquide de refroidissement 1 L', 'Lubrifiants', 350, 550, 40, 10, 'brd-3'),
  prod('prd-4', 'P004', 'Lave-glace 5 L', 'Lavage', 280, 450, 3, 8, 'brd-3'),
  prod('prd-5', 'P005', 'Désodorisant voiture', 'Accessoires', 120, 250, 60, 15, 'brd-3'),
  prod('prd-6', 'P006', 'Balai d\'essuie-glace 55 cm', 'Accessoires', 650, 1000, 12, 4, 'brd-3'),
  prod('prd-7', 'P007', 'Eau minérale 1,5 L', 'Magasin', 30, 50, 120, 24, 'brd-3'),
  prod('prd-8', 'P008', 'Liquide de frein DOT4 0,5 L', 'Lubrifiants', 420, 650, 2, 5, 'brd-1'),
];

const shopSale = (id: string, n: number, client: string | null, items: { p: typeof products[number]; q: number }[], mode: string, paidRatio = 1) => {
  const subtotal = items.reduce((s, it) => s + it.p.selling_price * it.q, 0);
  const total = subtotal;
  const paid = round2(total * paidRatio);
  return {
    sale: { id, date: T(n, 11), client_id: client, seller_id: 'mag-1', subtotal, tva_amount: 0, total, payment_mode: mode, cheque_number: null, bon_number: null, bon_photo_url: null, amount_paid: paid, rest: round2(total - paid), status: paid >= total ? 'Payé' : 'Dette', notes: null, printed_at: null, invoice_image_url: null, created_at: T(n, 11) },
    items: items.map((it, i) => ({ id: `${id}-it${i}`, sale_id: id, product_id: it.p.id, product_name: it.p.name, quantity: it.q, price: it.p.selling_price, tva: 0 })),
  };
};

const SHOP_SALES = [
  shopSale('ss-1', 0, null, [{ p: products[0], q: 1 }, { p: products[4], q: 2 }], 'ESPECES'),
  shopSale('ss-2', 1, 'cli-3', [{ p: products[1], q: 2 }], 'CREDIT', 0),
  shopSale('ss-3', 2, null, [{ p: products[6], q: 6 }, { p: products[2], q: 1 }], 'ESPECES'),
  shopSale('ss-4', 4, 'cli-1', [{ p: products[5], q: 2 }, { p: products[3], q: 1 }], 'CHEQUE'),
  shopSale('ss-5', 8, null, [{ p: products[7], q: 1 }], 'ESPECES'),
];

const purchases = [
  { id: 'pur-1', date: D(14), supplier_id: 'sup-2', invoice_number: 'FA-2026-0412', due_date: D(-16), driver_id: null, total: 64000, amount_paid: 26000, rest: 38000, status: 'Dette partielle', payment_mode: 'ESPECES', cheque_number: null, linked_delivery_note_id: null, notes: 'Réassort lubrifiants', type: 'RECEPTION', tva_rate: 0, tva_active: false, tank_id: null, receipt_photo_url: null, bl_number: 'BL-8841', discount_type: null, discount_value: null, discount_amount: null, subtotal: 64000, tva_amount: 0, appointment_active: true, appointment_date: D(-16), appointment_amount: 38000, appointment_notes: 'Solde facture', appointment_paid: false, appointment_paid_at: null, created_at: T(14) },
  { id: 'pur-2', date: D(30), supplier_id: 'sup-3', invoice_number: 'FA-AP-1209', due_date: null, driver_id: null, total: 15600, amount_paid: 15600, rest: 0, status: 'Payé', payment_mode: 'ESPECES', cheque_number: null, linked_delivery_note_id: null, notes: null, type: 'RECEPTION', tva_rate: 0, tva_active: false, tank_id: null, receipt_photo_url: null, bl_number: null, discount_type: null, discount_value: null, discount_amount: null, subtotal: 15600, tva_amount: 0, appointment_active: false, appointment_date: null, appointment_amount: null, appointment_notes: null, appointment_paid: null, appointment_paid_at: null, created_at: T(30) },
];

const purchase_items = [
  { id: 'pi-1', purchase_id: 'pur-1', product_id: 'prd-1', product_name: products[0].name, quantity: 12, buy_price: 3200, selling_price: 4100, min_stock: 5, unit: 'unité', total: 38400, tank_id: null, tva_active: false, tva_rate: 0 },
  { id: 'pi-2', purchase_id: 'pur-1', product_id: 'prd-2', product_name: products[1].name, quantity: 10, buy_price: 2100, selling_price: 2750, min_stock: 5, unit: 'unité', total: 21000, tank_id: null, tva_active: false, tva_rate: 0 },
  { id: 'pi-3', purchase_id: 'pur-1', product_id: 'prd-3', product_name: products[2].name, quantity: 13, buy_price: 350, selling_price: 550, min_stock: 10, unit: 'unité', total: 4550, tank_id: null, tva_active: false, tva_rate: 0 },
  { id: 'pi-4', purchase_id: 'pur-2', product_id: 'prd-6', product_name: products[5].name, quantity: 24, buy_price: 650, selling_price: 1000, min_stock: 4, unit: 'unité', total: 15600, tank_id: null, tva_active: false, tva_rate: 0 },
];

const purchase_payments = [
  { id: 'pp-1', purchase_id: 'pur-1', date: D(14), amount: 26000, mode: 'ESPECES', cheque_number: null, bordereau_number: null, account_id: null, notes: null, created_at: T(14) },
  { id: 'pp-2', purchase_id: 'pur-2', date: D(30), amount: 15600, mode: 'ESPECES', cheque_number: null, bordereau_number: null, account_id: null, notes: null, created_at: T(30) },
];

// ─── Approvisionnement carburant ───────────────────────────────────────────────
const delivery_notes = [
  { id: 'dn-1', date: D(12), supplier_id: 'sup-1', tank_id: 'tank-2', liters: 20000, price_per_liter: BUY_PRICES.GASOIL, status: 'Reçu', total: 20000 * BUY_PRICES.GASOIL + 10000 * BUY_PRICES.ESSENCE, expiry_date: null, bl_number: 'BL-C-77120', bl_date: D(12), creation_date: D(12), immatriculation: '01234-119-19', driver_id: 'drv-1', created_at: T(12) },
  { id: 'dn-2', date: D(3), supplier_id: 'sup-1', tank_id: 'tank-3', liters: 8000, price_per_liter: BUY_PRICES.GPL, status: 'Reçu', total: 8000 * BUY_PRICES.GPL, expiry_date: null, bl_number: 'BL-C-77391', bl_date: D(3), creation_date: D(3), immatriculation: '05678-119-19', driver_id: 'drv-2', created_at: T(3) },
];

const delivery_note_items = [
  { id: 'dni-1', delivery_note_id: 'dn-1', tank_id: 'tank-2', liters: 20000, price_per_liter: BUY_PRICES.GASOIL, total: 20000 * BUY_PRICES.GASOIL },
  { id: 'dni-2', delivery_note_id: 'dn-1', tank_id: 'tank-1', liters: 10000, price_per_liter: BUY_PRICES.ESSENCE, total: 10000 * BUY_PRICES.ESSENCE },
  { id: 'dni-3', delivery_note_id: 'dn-2', tank_id: 'tank-3', liters: 8000, price_per_liter: BUY_PRICES.GPL, total: 8000 * BUY_PRICES.GPL },
];

const fuel_invoices = [
  { id: 'fi-1', invoice_number: 'FC-2026-1187', invoice_date: D(11), creation_date: D(11), reception_date: D(10), tva_active: false, tva_rate: 0, subtotal: delivery_notes[0].total, tva_amount: 0, total: delivery_notes[0].total, amount_paid: 300000, rest: delivery_notes[0].total - 300000, status: 'Partiel', appointment_date: D(-5), appointment_amount: 200000, appointment_notes: null, invoice_image_url: null, notes: null, created_at: T(11) },
];
const fuel_invoice_bls = [{ id: 'fib-1', invoice_id: 'fi-1', delivery_note_id: 'dn-1' }];

// ─── Brigades (relevés d'index cohérents) ──────────────────────────────────────
type BrigadeSpec = { n: number; shift: 'Matin' | 'Soir'; chef: string; pompistes: string[]; sold: Record<string, number> };

const BRIGADE_SPECS: BrigadeSpec[] = [
  { n: 6, shift: 'Matin', chef: 'chef-1', pompistes: ['pmp-1', 'pmp-2'], sold: { 'noz-1': 820, 'noz-2': 1150, 'noz-3': 940, 'noz-4': 310 } },
  { n: 5, shift: 'Soir', chef: 'chef-2', pompistes: ['pmp-3'], sold: { 'noz-1': 610, 'noz-2': 980, 'noz-3': 720, 'noz-4': 260 } },
  { n: 4, shift: 'Matin', chef: 'chef-1', pompistes: ['pmp-1', 'pmp-2'], sold: { 'noz-1': 905, 'noz-2': 1240, 'noz-3': 1010, 'noz-4': 345 } },
  { n: 3, shift: 'Soir', chef: 'chef-2', pompistes: ['pmp-3'], sold: { 'noz-1': 560, 'noz-2': 870, 'noz-3': 690, 'noz-4': 230 } },
  { n: 2, shift: 'Matin', chef: 'chef-1', pompistes: ['pmp-1', 'pmp-2'], sold: { 'noz-1': 880, 'noz-2': 1310, 'noz-3': 1080, 'noz-4': 360 } },
  { n: 1, shift: 'Matin', chef: 'chef-1', pompistes: ['pmp-1', 'pmp-2'], sold: { 'noz-1': 930, 'noz-2': 1190, 'noz-3': 990, 'noz-4': 330 } },
];

function buildBrigades() {
  const idx: Record<string, number> = Object.fromEntries(NOZZLES.map(z => [z.id, z.start]));
  const brigades: any[] = [];
  const accountings: any[] = [];
  const justifs: any[] = [];
  const fuelSales: any[] = [];
  const assignments: any[] = [];

  BRIGADE_SPECS.forEach((s, i) => {
    const id = `brg-${i + 1}`;
    const startH = s.shift === 'Matin' ? 6 : 14;
    const start: Record<string, number> = {};
    const end: Record<string, number> = {};
    let totalDue = 0;
    const nozzleSummary: any[] = [];
    for (const z of NOZZLES) {
      start[z.id] = idx[z.id];
      idx[z.id] = round2(idx[z.id] + s.sold[z.id]);
      end[z.id] = idx[z.id];
      const amount = round2(s.sold[z.id] * PRICES[z.fuel]);
      totalDue += amount;
      nozzleSummary.push({ nozzleId: z.id, pumpId: z.pump_id, tankId: z.tank_id, fuelType: z.fuel, startIndex: start[z.id], endIndex: end[z.id], liters: s.sold[z.id], pricePerLiter: PRICES[z.fuel], amount });
    }
    totalDue = round2(totalDue);

    // Justificatifs : bons clients (crédit) + TPE.
    const bonLiters = 200 + i * 15;
    const bonAmount = round2(bonLiters * PRICES.GASOIL);
    justifs.push({ id: `jst-${i + 1}`, accounting_id: `acc-${i + 1}`, client_id: i % 2 ? 'cli-3' : 'cli-1', amount: bonAmount, client_type: 'CREDIT', payment_mode: 'BON', notes: null, justification_type: 'CLIENT', bank_account_id: null, client_name: i % 2 ? 'Ahmed Touati' : 'Transport Hamdi SARL', fuel_type: 'GASOIL', liters: bonLiters, price_per_liter: PRICES.GASOIL, track_id: 'trk-2', pompiste_id: s.pompistes[s.pompistes.length - 1], expense_category: null });
    const cash = round2(totalDue - bonAmount - (i === 2 ? 450 : 0));

    const pompistePumpAssignments = s.pompistes.length > 1
      ? [{ pompisteId: s.pompistes[0], pumpIds: ['pump-1'] }, { pompisteId: s.pompistes[1], pumpIds: ['pump-2'] }]
      : [{ pompisteId: s.pompistes[0], pumpIds: ['pump-1', 'pump-2'] }];

    // Récapitulatif par pompiste (litres, théorique, encaissé, décalage).
    const pompisteData: Record<string, any> = {};
    pompistePumpAssignments.forEach(a => {
      const zs = NOZZLES.filter(z => a.pumpIds.includes(z.pump_id));
      const litersSold = round2(zs.reduce((x, z) => x + s.sold[z.id], 0));
      const theoretical = round2(zs.reduce((x, z) => x + s.sold[z.id] * PRICES[z.fuel], 0));
      const bons = a.pompisteId === s.pompistes[s.pompistes.length - 1] ? bonAmount : 0;
      const decalage = i === 2 && a.pompisteId === s.pompistes[0] ? -450 : 0;
      const cashPart = round2(theoretical - bons + decalage);
      pompisteData[a.pompisteId] = {
        litersSold, theoretical, collected: { cash: cashPart, bons, cheques: 0 },
        totalCollected: round2(cashPart + bons), decalage, pricePerLiter: round2(theoretical / (litersSold || 1)),
      };
    });

    brigades.push({
      id, date: D(s.n), shift: s.shift, chef_id: s.chef, status: 'Clôturée',
      start_timestamp: T(s.n, startH), end_timestamp: T(s.n, startH + 8),
      start_time: `${pad(startH)}:00`, end_time: `${pad(startH + 8)}:00`,
      start_datetime: T(s.n, startH), end_datetime: T(s.n, startH + 8),
      is_active: false, notes: i === 2 ? 'Petit manquant caisse' : null, printed_at: null,
      start_indices: { 'pump-1': start['noz-1'], 'pump-2': start['noz-3'] },
      end_indices: { 'pump-1': end['noz-1'], 'pump-2': end['noz-3'] },
      start_tank_levels: {}, end_tank_levels: {}, pompiste_data: pompisteData,
      pompiste_assignments: s.pompistes.map((p, k) => ({ pompisteId: p, trackId: k === 0 ? 'trk-1' : 'trk-2', present: true })),
      start_nozzle_indices: start, end_nozzle_indices: end, active_nozzle_ids: NOZZLES.map(z => z.id),
      can_reactivate: false, pompiste_pump_assignments: pompistePumpAssignments,
      versements: Object.entries(pompisteData).map(([pid, d], k) => ({ id: `vrs-${i + 1}-${k + 1}`, pompisteId: pid, amount: d.collected.cash, at: T(s.n, startH + 8), notes: 'Versement fin de brigade' })),
      armoire_sales: [], armoire_product_purchases: [], armoire_stock_snapshot: [], magasin_product_moves: [],
      created_at: T(s.n, startH),
    });
    s.pompistes.forEach(p => assignments.push({ brigade_id: id, pompiste_id: p }));

    accountings.push({
      id: `acc-${i + 1}`, brigade_id: id, total_due: totalDue, cash_received: cash, rest: round2(totalDue - bonAmount - cash),
      tank_summary: [], nozzle_summary: nozzleSummary, decalage_summary: {}, cuve_verifications: {}, nozzle_verifications: {},
      rest_assigned_worker_type: i === 2 ? 'pompiste' : null, rest_assigned_worker_id: i === 2 ? s.pompistes[0] : null,
      rest_assigned_amount: i === 2 ? 450 : 0, status: 'completed', created_by: DEMO_ADMIN.id, pompiste_summary: pompisteData, created_at: T(s.n, startH + 8),
    });

    // Ventes carburant détaillées (une par pistolet).
    NOZZLES.forEach((z, k) => {
      const pump = z.pump_id;
      const pompiste = pompistePumpAssignments.find(a => a.pumpIds.includes(pump))?.pompisteId || s.pompistes[0];
      fuelSales.push({ id: `fs-${i + 1}-${k + 1}`, date: D(s.n), pump_id: pump, liters: s.sold[z.id], price_per_liter: PRICES[z.fuel], total: round2(s.sold[z.id] * PRICES[z.fuel]), payment_mode: 'ESPECES', client_id: null, bon_number: null, bon_photo_url: null, pompiste_id: pompiste, brigade_id: id, created_at: T(s.n, startH + 8) });
    });
  });

  const pumpNozzles = NOZZLES.map(z => ({ id: z.id, pump_id: z.pump_id, name: z.name, tank_id: z.tank_id, last_index: idx[z.id], start_index: z.start, status: 'Actif', created_at: T(60, 8) }));
  return { brigades, accountings, justifs, fuelSales, assignments, pumpNozzles, lastIdx: idx };
}

// ─── Finance ───────────────────────────────────────────────────────────────────
const bank_accounts = [
  { id: 'bank-1', name: 'BNA — Compte courant', account_number: '001 00456 0300012345 67', initial_balance: 1500000, balance: 1500000, notes: 'Compte principal', created_at: T(200) },
  { id: 'bank-2', name: 'CPA — Compte TPE', account_number: '004 00123 0400098765 43', initial_balance: 250000, balance: 250000, notes: 'Encaissements cartes', created_at: T(200) },
];

const treasury_transactions = [
  { id: 'trx-1', date: D(20), kind: 'DEPOSIT', amount: 200000, description: 'Fonds de caisse initial', account_from: null, account_to: 'CAISSE', part: 'systeme', ref_type: null, ref_id: null, cheque_number: null, bordereau_number: null, created_by: DEMO_ADMIN.name, created_at: T(20, 8) },
  { id: 'trx-2', date: D(12), kind: 'PURCHASE', amount: 300000, description: 'Acompte BL carburant BL-C-77120', account_from: 'bank-1', account_to: null, part: 'carburant', ref_type: 'delivery_note', ref_id: 'dn-1', cheque_number: null, bordereau_number: 'VIR-55102', created_by: DEMO_ADMIN.name, created_at: T(12, 15) },
  { id: 'trx-3', date: D(7), kind: 'TRANSFER', amount: 150000, description: 'Versement banque', account_from: 'CAISSE_CARBURANT', account_to: 'bank-1', part: 'carburant', ref_type: null, ref_id: null, cheque_number: null, bordereau_number: 'BRD-1022', created_by: DEMO_ADMIN.name, created_at: T(7, 16) },
  { id: 'trx-4', date: D(5), kind: 'TPE', amount: 18500, description: 'Encaissements TPE', account_from: null, account_to: 'bank-2', part: 'carburant', ref_type: null, ref_id: null, cheque_number: null, bordereau_number: null, created_by: DEMO_ADMIN.name, created_at: T(5, 18) },
  { id: 'trx-5', date: D(2), kind: 'TRANSFER', amount: 40000, description: 'Remise caisse cafétéria', account_from: 'CAISSE_CAFETERIA', account_to: 'CAISSE', part: 'cafeteria', ref_type: null, ref_id: null, cheque_number: null, bordereau_number: null, created_by: DEMO_ADMIN.name, created_at: T(2, 19) },
];

const expenses = [
  { id: 'exp-1', date: D(18), category: 'Électricité', amount: 42500, description: 'Facture Sonelgaz trimestre', payment_mode: 'ESPECES', cheque_number: null, bordereau_number: null, account_id: null, part: 'carburant', paid_by: DEMO_ADMIN.name, recipient: 'Sonelgaz', status: 'Payé', receipt_url: null, created_by: DEMO_ADMIN.name, brigade_id: null, brigade_justification_id: null, pompiste_id: null, created_at: T(18) },
  { id: 'exp-2', date: D(15), category: 'Entretien', amount: 8500, description: 'Réparation pompe 2', payment_mode: 'ESPECES', cheque_number: null, bordereau_number: null, account_id: null, part: 'carburant', paid_by: 'Samir Khelifi', recipient: 'Atelier Bouras', status: 'Payé', receipt_url: null, created_by: DEMO_ADMIN.name, brigade_id: null, brigade_justification_id: null, pompiste_id: null, created_at: T(15) },
  { id: 'exp-3', date: D(9), category: 'Eau', amount: 3200, description: 'Facture eau', payment_mode: 'ESPECES', cheque_number: null, bordereau_number: null, account_id: null, part: 'carburant', paid_by: DEMO_ADMIN.name, recipient: 'ADE', status: 'Payé', receipt_url: null, created_by: DEMO_ADMIN.name, brigade_id: null, brigade_justification_id: null, pompiste_id: null, created_at: T(9) },
  { id: 'exp-4', date: D(8), category: 'Loyer', amount: 60000, description: 'Loyer local commercial', payment_mode: 'CHEQUE', cheque_number: '7712345', bordereau_number: null, account_id: 'bank-1', part: 'systeme', paid_by: DEMO_ADMIN.name, recipient: 'Propriétaire', status: 'Payé', receipt_url: null, created_by: DEMO_ADMIN.name, brigade_id: null, brigade_justification_id: null, pompiste_id: null, created_at: T(8) },
  { id: 'exp-5', date: D(3), category: 'Divers', amount: 1500, description: 'Fournitures de bureau', payment_mode: 'ESPECES', cheque_number: null, bordereau_number: null, account_id: null, part: 'cafeteria', paid_by: DEMO_ADMIN.name, recipient: 'Papeterie', status: 'Payé', receipt_url: null, created_by: DEMO_ADMIN.name, brigade_id: null, brigade_justification_id: null, pompiste_id: null, created_at: T(3) },
  { id: 'exp-6', date: D(1), category: 'Divers', amount: 2400, description: 'Produits d\'entretien', payment_mode: 'ESPECES', cheque_number: null, bordereau_number: null, account_id: null, part: 'lavage', paid_by: DEMO_ADMIN.name, recipient: 'Droguerie', status: 'Payé', receipt_url: null, created_by: DEMO_ADMIN.name, brigade_id: null, brigade_justification_id: null, pompiste_id: null, created_at: T(1) },
];

// ─── Armoires ──────────────────────────────────────────────────────────────────
const armoires = [
  { id: 'arm-1', name: 'Armoire Piste 1', track_id: 'trk-1', pump_ids: ['pump-1'], notes: 'Lubrifiants et bouteilles de gaz', created_at: T(40), updated_at: T(40) },
  { id: 'arm-2', name: 'Armoire Piste 2', track_id: 'trk-2', pump_ids: ['pump-2'], notes: null, created_at: T(40), updated_at: T(40) },
];

// ─── Parties Cafétéria / Magasin (store partagé) ───────────────────────────────
const bizProduct = (id: string, name: string, cat: [string, string], buy: number, sell: number, qty: number, min: number, extra: Record<string, any> = {}) => ({
  id, name, categoryId: cat[0], categoryName: cat[1], principalQty: qty + 10, currentQty: qty, minQty: min,
  purchasePrice: buy, salePrice: sell, unit: 'unité', barcode: `620${id.replace(/\D/g, '').padStart(10, '0')}`,
  createdAt: T(80), ...extra,
});

function bizModule(key: 'cafeteria' | 'lavage' | 'magasin2' | 'carwash', spec: {
  categories: [string, string][]; products: any[]; clients: any[]; suppliers: any[]; workers: any[]; sales: any[]; purchases: any[]; expenses: any[];
  tables?: any[];
}) {
  return {
    categories: spec.categories.map(([id, name]) => ({ id, name })),
    marques: [{ id: `${key}-demo-mrq-a`, name: 'Maison' }],
    roles: [{ id: `${key}-demo-role-1`, name: 'Caissier' }, { id: `${key}-demo-role-2`, name: 'Serveur' }],
    products: spec.products,
    purchases: spec.purchases, sales: spec.sales, clients: spec.clients, suppliers: spec.suppliers,
    workers: spec.workers, expenses: spec.expenses,
    caisse: [{ id: `${key}-demo-csh-1`, type: 'deposit', amount: 10000, date: T(10, 8), description: 'Fond de caisse' }],
    productions: [], fiches: [], comptoir: [], destructions: [], reparations: [],
    sessions: [], payRequests: [], inventaires: [], posPinned: [], messageTemplates: [], rappels: [],
    tables: spec.tables || [], tableOrders: [],
  };
}

const bizSale = (key: string, i: number, n: number, items: { p: any; q: number }[], client?: { id: string; name: string }, paidRatio = 1) => {
  const lines = items.map(it => ({ productId: it.p.id, productName: it.p.name, qty: it.q, unitPrice: it.p.salePrice, unitCost: it.p.purchasePrice, total: it.p.salePrice * it.q }));
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const paid = round2(subtotal * paidRatio);
  return {
    id: `${key}-demo-sale-${i}`, ref: `V-${String(1000 + i)}`, clientId: client?.id, clientName: client?.name || 'Client de passage',
    items: lines, subtotal, reduction: 0, total: subtotal, paid, rest: round2(subtotal - paid), date: T(n, 9 + (i % 8)),
    status: paid >= subtotal ? 'payée' : 'crédit', createdBy: DEMO_ADMIN.name,
    payments: paid > 0 ? [{ id: `${key}-demo-pay-${i}`, date: T(n, 9 + (i % 8)), amount: paid, mode: 'Espèces' }] : [],
  };
};

const bizWorker = (id: string, name: string, roleName: string, salary: number, extra: Record<string, any> = {}) => ({
  id, name, roleName, paid: true, salaryType: 'mois', salaryAmount: salary, hasAccount: false, startDate: D(120),
  permissions: {}, acomptes: [], absences: [], payments: [], createdAt: T(120), ...extra,
});

function buildBizState() {
  // Cafétéria
  const cafCats: [string, string][] = [['caf-demo-cat-1', 'Boissons chaudes'], ['caf-demo-cat-2', 'Boissons fraîches'], ['caf-demo-cat-3', 'Viennoiseries']];
  const cafProducts = [
    bizProduct('caf-demo-p1', 'Café express', cafCats[0], 25, 60, 300, 50),
    bizProduct('caf-demo-p2', 'Café crème', cafCats[0], 35, 80, 200, 40),
    bizProduct('caf-demo-p3', 'Thé à la menthe', cafCats[0], 15, 50, 150, 30),
    bizProduct('caf-demo-p4', 'Jus d\'orange 25 cl', cafCats[1], 70, 120, 48, 12),
    bizProduct('caf-demo-p5', 'Soda 33 cl', cafCats[1], 60, 100, 6, 12),
    bizProduct('caf-demo-p6', 'Croissant', cafCats[2], 30, 60, 40, 10),
    bizProduct('caf-demo-p7', 'Pain au chocolat', cafCats[2], 35, 70, 35, 10),
  ];
  const cafClients = [
    { id: 'caf-demo-cli-1', name: 'Bureau Transport Hamdi', phone: '036 84 12 12', createdAt: T(50) },
    { id: 'caf-demo-cli-2', name: 'Sofiane L.', phone: '0662 55 44 33', createdAt: T(20) },
  ];
  const cafSuppliers = [
    { id: 'caf-demo-sup-1', name: 'Torréfaction du Hodna', phone: '035 22 11 00', createdAt: T(70) },
    { id: 'caf-demo-sup-2', name: 'Boulangerie El Amel', phone: '0561 12 21 12', createdAt: T(70) },
  ];
  const cafSales = [
    bizSale('caf', 1, 0, [{ p: cafProducts[0], q: 3 }, { p: cafProducts[5], q: 2 }]),
    bizSale('caf', 2, 0, [{ p: cafProducts[1], q: 2 }, { p: cafProducts[6], q: 1 }]),
    bizSale('caf', 3, 1, [{ p: cafProducts[3], q: 4 }], cafClients[0], 0),
    bizSale('caf', 4, 2, [{ p: cafProducts[2], q: 5 }, { p: cafProducts[4], q: 2 }]),
    bizSale('caf', 5, 3, [{ p: cafProducts[0], q: 6 }, { p: cafProducts[5], q: 4 }], cafClients[1]),
    bizSale('caf', 6, 5, [{ p: cafProducts[1], q: 3 }]),
  ];
  const cafPurchases = [
    { id: 'caf-demo-pur-1', ref: 'A-501', supplierId: 'caf-demo-sup-1', supplierName: cafSuppliers[0].name, items: [{ productId: 'caf-demo-p1', productName: 'Café express', qty: 200, unitPrice: 25, total: 5000 }], total: 5000, paid: 5000, rest: 0, date: T(9), createdAt: T(9), createdBy: DEMO_ADMIN.name },
    { id: 'caf-demo-pur-2', ref: 'A-502', supplierId: 'caf-demo-sup-2', supplierName: cafSuppliers[1].name, items: [{ productId: 'caf-demo-p6', productName: 'Croissant', qty: 50, unitPrice: 30, total: 1500 }, { productId: 'caf-demo-p7', productName: 'Pain au chocolat', qty: 40, unitPrice: 35, total: 1400 }], total: 2900, paid: 1500, rest: 1400, date: T(2), createdAt: T(2), createdBy: DEMO_ADMIN.name },
  ];
  const cafWorkers = [
    bizWorker('caf-demo-wrk-1', 'Nadia Belkacem', 'Caissier', 32000, { hasAccount: true, authUserId: CAF_WORKER_AUTH_ID, username: 'cafeteria', email: 'cafeteria@demo.dz', permissions: { pos: true, sales: true, products: true } }),
    bizWorker('caf-demo-wrk-2', 'Walid Hamani', 'Serveur', 1200, { salaryType: 'jour', workDays: [0, 1, 2, 3, 4, 6] }),
  ];
  const cafExpenses = [
    { id: 'caf-demo-exp-1', name: 'Gaz', amount: 1800, date: T(6), category: 'Énergie' },
    { id: 'caf-demo-exp-2', name: 'Gobelets jetables', amount: 2500, date: T(4), category: 'Fournitures' },
  ];
  const cafTables = [1, 2, 3, 4, 5, 6].map(n => ({ id: `caf-demo-tbl-${n}`, name: `Table ${n}`, seats: n <= 4 ? 4 : 2, createdAt: T(30) }));

  // Magasin 1 (lavage / réparation)
  const lavCats: [string, string][] = [['lav-demo-cat-1', 'Huiles'], ['lav-demo-cat-2', 'Filtres'], ['lav-demo-cat-3', 'Gaz & consignés']];
  const lavProducts = [
    bizProduct('lav-demo-p1', 'Huile 15W40 — bidon 5 L', lavCats[0], 2400, 3200, 30, 6),
    bizProduct('lav-demo-p2', 'Huile 5W30 — bidon 4 L', lavCats[0], 3000, 4000, 14, 5),
    bizProduct('lav-demo-p3', 'Filtre à huile universel', lavCats[1], 450, 800, 25, 8),
    bizProduct('lav-demo-p4', 'Filtre à air', lavCats[1], 700, 1200, 4, 6),
    bizProduct('lav-demo-p5', 'Bouteille de gaz butane 13 kg', lavCats[2], 200, 250, 40, 10, { consigneActive: true, emptyQty: 12, fillPrice: 200, emptyPrice: 3500 }),
  ];
  const lavClients = [
    { id: 'lav-demo-cli-1', name: 'Garage Amrani', phone: '0663 77 66 55', createdAt: T(40), cars: [{ id: 'lav-demo-car-1', immatriculation: '12345-116-19', marque: 'Renault', name: 'Clio 4', year: '2016' }] },
    { id: 'lav-demo-cli-2', name: 'Mohamed S.', phone: '0664 88 99 00', createdAt: T(15) },
  ];
  const lavSuppliers = [{ id: 'lav-demo-sup-1', name: 'Lubrifiants du Centre', phone: '036 71 71 71', createdAt: T(70) }];
  const lavSales = [
    bizSale('lav', 1, 0, [{ p: lavProducts[0], q: 1 }, { p: lavProducts[2], q: 1 }], lavClients[1]),
    bizSale('lav', 2, 1, [{ p: lavProducts[4], q: 3 }]),
    bizSale('lav', 3, 3, [{ p: lavProducts[1], q: 1 }, { p: lavProducts[3], q: 1 }], lavClients[0], 0.5),
    bizSale('lav', 4, 6, [{ p: lavProducts[0], q: 2 }]),
  ];
  const lavPurchases = [
    { id: 'lav-demo-pur-1', ref: 'A-301', supplierId: 'lav-demo-sup-1', supplierName: lavSuppliers[0].name, items: [{ productId: 'lav-demo-p1', productName: lavProducts[0].name, qty: 20, unitPrice: 2400, total: 48000 }], total: 48000, paid: 48000, rest: 0, date: T(11), createdAt: T(11), createdBy: DEMO_ADMIN.name },
  ];
  const lavWorkers = [
    bizWorker('lav-demo-wrk-1', 'Adel Kaci', 'Laveur', 0, { salaryType: 'pourcentage', percentage: 30, workerKind: 'lavage' }),
    bizWorker('lav-demo-wrk-2', 'Toufik Rahmani', 'Mécanicien réparation', 40000, { workerKind: 'reparation' }),
  ];

  // Magasin 2
  const m2Cats: [string, string][] = [['m2-demo-cat-1', 'Alimentation'], ['m2-demo-cat-2', 'Hygiène']];
  const m2Products = [
    bizProduct('m2-demo-p1', 'Biscuits chocolat', m2Cats[0], 45, 70, 80, 20),
    bizProduct('m2-demo-p2', 'Chips 45 g', m2Cats[0], 35, 60, 60, 20),
    bizProduct('m2-demo-p3', 'Mouchoirs (paquet)', m2Cats[1], 25, 50, 100, 25),
    bizProduct('m2-demo-p4', 'Gel hydroalcoolique', m2Cats[1], 150, 250, 8, 10),
  ];
  const m2Sales = [
    bizSale('m2', 1, 0, [{ p: m2Products[0], q: 3 }, { p: m2Products[1], q: 2 }]),
    bizSale('m2', 2, 2, [{ p: m2Products[2], q: 4 }]),
    bizSale('m2', 3, 4, [{ p: m2Products[3], q: 1 }, { p: m2Products[0], q: 1 }]),
  ];

  // Lavage & Réparation (partie de service)
  const cwCats: [string, string][] = [['cw-demo-cat-1', 'Huiles moteur'], ['cw-demo-cat-2', 'Filtres'], ['cw-demo-cat-3', 'Produits lavage']];
  const cwProducts = [
    bizProduct('cw-demo-p1', 'Huile 10W40 — 5 L', cwCats[0], 2600, 3400, 20, 5),
    bizProduct('cw-demo-p2', 'Huile 5W30 — 5 L', cwCats[0], 3300, 4300, 12, 4),
    bizProduct('cw-demo-p3', 'Filtre à huile', cwCats[1], 450, 800, 30, 8),
    bizProduct('cw-demo-p4', 'Filtre à air', cwCats[1], 700, 1200, 3, 5),
    bizProduct('cw-demo-p5', 'Shampoing carrosserie 5 L', cwCats[2], 900, 1500, 10, 3, { isRawMaterial: true }),
    bizProduct('cw-demo-p6', 'Désodorisant', cwCats[2], 120, 250, 50, 10),
  ];
  const cwCars = [
    { id: 'cw-demo-car-1', name: 'Clio 4', marque: 'Renault', color: 'Blanc', year: '2017', immatriculation: '12345-117-19' },
    { id: 'cw-demo-car-2', name: 'Symbol', marque: 'Renault', color: 'Gris', year: '2015', immatriculation: '67890-115-19' },
    { id: 'cw-demo-car-3', name: 'Hilux', marque: 'Toyota', color: 'Noir', year: '2020', immatriculation: '24680-120-19' },
  ];
  const cwClients = [
    { id: 'cw-demo-cli-1', name: 'Garage Amrani', phone: '0663 77 66 55', createdAt: T(40), cars: [cwCars[0]] },
    { id: 'cw-demo-cli-2', name: 'Transport Hamdi SARL', phone: '036 84 12 12', createdAt: T(35), cars: [cwCars[2]] },
    { id: 'cw-demo-cli-3', name: 'Mohamed S.', phone: '0664 88 99 00', createdAt: T(15), cars: [cwCars[1]] },
  ];
  const cwWorkers = [
    bizWorker('cw-demo-wrk-1', 'Adel Kaci', 'Laveur', 0, { salaryType: 'pourcentage', percentage: 30, workerKind: 'lavage' }),
    bizWorker('cw-demo-wrk-2', 'Toufik Rahmani', 'Mécanicien réparation', 40000, { workerKind: 'reparation' }),
    bizWorker('cw-demo-wrk-3', 'Imad Bensalem', 'Polyvalent', 1500, { salaryType: 'jour', workDays: [0, 1, 2, 3, 4, 6], workerKind: 'both' }),
  ];
  const rep = (i: number, n: number, kind: 'reparation' | 'lavage' | 'mixte', cli: any, car: any, prest: { kind: 'reparation' | 'lavage'; label: string; amount: number; w: string[] }[], used: { p: any; q: number }[], status: 'pending' | 'finalized', paidRatio = 1) => {
    const prestations = prest.map((x, k) => ({ id: `cw-demo-prs-${i}-${k}`, kind: x.kind, label: x.label, amount: x.amount, workerIds: x.w }));
    const usedProducts = used.map(u => ({ productId: u.p.id, productName: u.p.name, qty: u.q, unitPrice: u.p.salePrice, unitCost: u.p.purchasePrice, total: u.p.salePrice * u.q }));
    const serviceTotal = prestations.reduce((a, x) => a + x.amount, 0);
    const total = serviceTotal + usedProducts.reduce((a, x) => a + x.total, 0);
    const paid = status === 'finalized' ? round2(total * paidRatio) : 0;
    return {
      id: `cw-demo-rep-${i}`, ref: `INT-${String(200 + i)}`, kind, clientId: cli?.id, clientName: cli?.name || 'Client de passage', car,
      serviceTotal, prestations, usedProducts, problem: kind === 'lavage' ? undefined : 'Réparation périodique',
      subtotal: total, total, paid, rest: round2(total - paid), status, date: T(n, 9 + i % 6),
      finalizedAt: status === 'finalized' ? T(n, 11 + i % 6) : undefined, outDate: status === 'finalized' ? T(n, 11 + i % 6) : undefined,
      workers: [...new Set(prest.flatMap(x => x.w))], createdBy: DEMO_ADMIN.name,
      payments: paid > 0 ? [{ id: `cw-demo-rpay-${i}`, date: T(n, 11 + i % 6), amount: paid, mode: 'Espèces' }] : [],
    };
  };
  const cwReparations = [
    rep(1, 0, 'lavage', null, { name: 'Golf 7', marque: 'Volkswagen', immatriculation: '11223-116-19' }, [{ kind: 'lavage', label: 'Lavage complet', amount: 800, w: ['cw-demo-wrk-1'] }], [], 'pending'),
    rep(2, 0, 'reparation', cwClients[0], cwCars[0], [{ kind: 'reparation', label: 'Réparation + filtre', amount: 1000, w: ['cw-demo-wrk-2'] }], [{ p: cwProducts[0], q: 1 }, { p: cwProducts[2], q: 1 }], 'pending'),
    rep(3, 1, 'mixte', cwClients[1], cwCars[2], [{ kind: 'reparation', label: 'Réparation', amount: 1200, w: ['cw-demo-wrk-2'] }, { kind: 'lavage', label: 'Lavage extérieur', amount: 600, w: ['cw-demo-wrk-1'] }], [{ p: cwProducts[1], q: 1 }, { p: cwProducts[2], q: 1 }], 'finalized', 0.5),
    rep(4, 2, 'lavage', cwClients[2], cwCars[1], [{ kind: 'lavage', label: 'Lavage intérieur + extérieur', amount: 1000, w: ['cw-demo-wrk-3'] }], [{ p: cwProducts[5], q: 1 }], 'finalized'),
    rep(5, 4, 'reparation', cwClients[0], cwCars[0], [{ kind: 'reparation', label: 'Changement filtre à air', amount: 500, w: ['cw-demo-wrk-3'] }], [{ p: cwProducts[3], q: 1 }], 'finalized'),
    rep(6, 6, 'lavage', null, { name: 'Picanto', marque: 'Kia', immatriculation: '55443-118-19' }, [{ kind: 'lavage', label: 'Lavage express', amount: 400, w: ['cw-demo-wrk-1'] }], [], 'finalized'),
  ];
  const cwPayRequests = [
    { id: 'cw-demo-req-1', ref: 'DE-001', kind: 'lavage', clientName: 'Client de passage', car: { name: 'Polo', marque: 'Volkswagen', immatriculation: '99887-119-19' }, amount: 700, description: 'Lavage extérieur', workerId: 'cw-demo-wrk-1', workerName: 'Adel Kaci', status: 'pending', createdAt: T(0, 10), createdBy: 'Adel Kaci' },
    { id: 'cw-demo-req-2', ref: 'DE-002', kind: 'reparation', clientId: 'cw-demo-cli-3', clientName: 'Mohamed S.', car: cwCars[1], amount: 1500, description: 'Réparation sans fourniture', workerId: 'cw-demo-wrk-2', workerName: 'Toufik Rahmani', status: 'pending', createdAt: T(0, 11), createdBy: 'Toufik Rahmani' },
    { id: 'cw-demo-req-3', ref: 'DE-003', kind: 'lavage', clientName: 'Client de passage', car: { name: 'Accent', marque: 'Hyundai', immatriculation: '33221-112-19' }, amount: 500, workerId: 'cw-demo-wrk-1', workerName: 'Adel Kaci', status: 'collected', createdAt: T(1, 15), collectedAt: T(1, 16), collectedBy: DEMO_ADMIN.name },
  ];
  const cwSales = [
    bizSale('cw', 1, 0, [{ p: cwProducts[5], q: 2 }]),
    bizSale('cw', 2, 3, [{ p: cwProducts[0], q: 1 }], cwClients[1]),
  ];
  const cwModule: any = bizModule('carwash' as any, { categories: cwCats, products: cwProducts, clients: cwClients, suppliers: [{ id: 'cw-demo-sup-1', name: 'Lubrifiants du Centre', phone: '036 71 71 71', createdAt: T(70) }], workers: cwWorkers, sales: cwSales, purchases: [], expenses: [{ id: 'cw-demo-exp-1', name: 'Produits de lavage', amount: 4200, date: T(5), category: 'Fournitures' }] });
  cwModule.reparations = cwReparations;
  cwModule.payRequests = cwPayRequests;
  cwModule.messageTemplates = [
    { id: 'cw-demo-tpl-1', name: 'Rappel réparation', body: 'Bonjour {client}, la prochaine réparation de votre {voiture} approche. Station Altech.', createdAt: T(30) },
  ];

  const empty = bizModule('magasin2', { categories: [], products: [], clients: [], suppliers: [], workers: [], sales: [], purchases: [], expenses: [] });
  empty.caisse = [];
  empty.marques = [];
  empty.roles = [];

  const state = {
    restaurant: empty,
    cafeteria: bizModule('cafeteria', { categories: cafCats, products: cafProducts, clients: cafClients, suppliers: cafSuppliers, workers: cafWorkers, sales: cafSales, purchases: cafPurchases, expenses: cafExpenses, tables: cafTables }),
    lavage: bizModule('lavage', { categories: lavCats, products: lavProducts, clients: lavClients, suppliers: lavSuppliers, workers: lavWorkers, sales: lavSales, purchases: lavPurchases, expenses: [{ id: 'lav-demo-exp-1', name: 'Shampoing carrosserie', amount: 3600, date: T(5), category: 'Fournitures' }] }),
    carwash: cwModule,
    magasin2: bizModule('magasin2', { categories: m2Cats, products: m2Products, clients: [], suppliers: [], workers: [], sales: m2Sales, purchases: [], expenses: [] }),
  };

  const bizProducts = [
    ...cafProducts.map(p => ({ id: p.id, module_key: 'cafeteria', data: p, created_at: T(80) })),
    ...lavProducts.map(p => ({ id: p.id, module_key: 'lavage', data: p, created_at: T(80) })),
    ...m2Products.map(p => ({ id: p.id, module_key: 'magasin2', data: p, created_at: T(80) })),
    ...cwProducts.map(p => ({ id: p.id, module_key: 'carwash', data: p, created_at: T(80) })),
  ];

  const armoireStock = [
    { id: 'ast-1', armoire_id: 'arm-1', product_id: 'lav-demo-p1', module_key: 'lavage', quantity: 6, empty_quantity: 0, created_at: T(20) },
    { id: 'ast-2', armoire_id: 'arm-1', product_id: 'lav-demo-p5', module_key: 'lavage', quantity: 10, empty_quantity: 3, created_at: T(20) },
    { id: 'ast-3', armoire_id: 'arm-2', product_id: 'lav-demo-p3', module_key: 'lavage', quantity: 5, empty_quantity: 0, created_at: T(20) },
  ];
  const stockTransfers = [
    { id: 'stf-1', armoire_id: 'arm-1', module_key: 'lavage', date: D(20), source: 'transferts', notes: 'Approvisionnement armoire piste 1', created_by: DEMO_ADMIN.name, total_qty: 16, created_at: T(20) },
  ];
  const stockTransferItems = [
    { id: 'sti-1', transfer_id: 'stf-1', product_id: 'lav-demo-p1', product_name: lavProducts[0].name, barcode: lavProducts[0].barcode, quantity: 6, consigne_state: null },
    { id: 'sti-2', transfer_id: 'stf-1', product_id: 'lav-demo-p5', product_name: lavProducts[4].name, barcode: lavProducts[4].barcode, quantity: 10, consigne_state: 'PLEIN' },
  ];

  const sessions = [
    { id: 'caf-demo-ses-1', module_key: 'cafeteria', ref: 'S-0001', worker_id: 'caf-demo-wrk-1', worker_name: 'Nadia Belkacem', opening_cash: 5000, opened_at: T(1, 7), closed_at: T(1, 15), closing_cash: 11200, status: 'closed', notes: null, theoretical: 11240, credit: 0, decalage: -40, auth_user_id: CAF_WORKER_AUTH_ID, opened_by_id: 'caf-demo-wrk-1', opened_by_name: 'Nadia Belkacem', closed_by_id: 'caf-demo-wrk-1', closed_by_name: 'Nadia Belkacem', created_at: T(1, 7), updated_at: T(1, 15) },
  ];

  const moduleWorkers = [
    { id: 'caf-demo-wrk-1', module_key: 'cafeteria', name: 'Nadia Belkacem', role_name: 'Caissier', phone: null, email: 'cafeteria@demo.dz', username: 'cafeteria', auth_user_id: CAF_WORKER_AUTH_ID, has_account: true, permissions: { pos: true, sales: true, products: true }, created_at: T(120), updated_at: T(120) },
  ];

  return { state, bizProducts, armoireStock, stockTransfers, stockTransferItems, sessions, moduleWorkers };
}

// ─── Assemblage ────────────────────────────────────────────────────────────────

/** Construit une copie neuve de toutes les tables de démonstration. */
export function buildDemoTables(): Record<string, any[]> {
  const b = buildBrigades();
  const biz = buildBizState();

  const fuelRevenue = (n: number) => b.accountings
    .filter((_a, i) => BRIGADE_SPECS[i].n === n)
    .reduce((s, a) => s + a.total_due, 0);

  return {
    station_settings: [{
      id: 'settings-1', name: 'Station Altech Démo', logo_url: null, address: 'RN 5, Sétif', phone: '036 00 00 00', email: 'contact@altech-demo.dz',
      fiscal_id: '000119000000000', rc: '19/00-0000000B19',
      fuel_prices: PRICES, fuel_buy_prices: BUY_PRICES, conversion_tables: {},
      product_categories: ['Lubrifiants', 'Accessoires', 'Lavage', 'Magasin'],
      expense_categories: ['Salaires', 'Entretien', 'Électricité', 'Eau', 'Loyer', 'Impôts', 'Divers'],
      product_units: ['unité', 'L', 'kg', 'carton', 'paquet'],
      decalage_positif_actif: true, decalage_negatif_actif: true, decalage_positif_seuil: 500, decalage_negatif_seuil: 500,
      magasin1_name: 'Magasin', magasin2_name: 'Supérette', magasin2_enabled: true, created_at: T(365),
    }],
    admin_profiles: [{ id: DEMO_ADMIN.id, name: DEMO_ADMIN.name, username: DEMO_ADMIN.username, email: DEMO_ADMIN.email, phone: '0550 00 00 00', role: 'admin', avatar_url: null, created_at: T(365) }],
    tracks, tanks,
    pumps: pumps.map(p => ({ ...p, last_index: p.id === 'pump-1' ? b.lastIdx['noz-1'] : b.lastIdx['noz-3'] })),
    pump_nozzles: b.pumpNozzles,
    drivers,
    pompistes, brigade_chefs, chef_pompiste_assignments, gerants, magasin_workers,
    worker_acomptes, worker_absences, worker_payment_records,
    pompiste_decalage_history: [
      { id: 'dec-1', pompiste_id: 'pmp-1', brigade_id: 'brg-3', date: D(4), amount: 450, type: 'RETENUE', created_at: T(4) },
    ],
    brigades: b.brigades,
    brigade_pompiste_assignments: b.assignments,
    brigade_accounting: b.accountings,
    brigade_accounting_justifications: b.justifs,
    brigade_decalage_alerts: [
      { id: 'alr-1', brigade_id: 'brg-3', brigade_date: D(4), start_datetime: T(4, 6), end_datetime: T(4, 14), chef_id: 'chef-1', chef_name: 'Mourad Haddad', alert_type: 'POMPISTE', tank_id: null, tank_name: null, pompiste_id: 'pmp-1', pompiste_name: 'Karim Benali', decalage_liters: 0, decalage_amount: -450, workers_info: [], is_dismissed: false, created_at: T(4, 14) },
    ],
    tpe_transactions: [
      { id: 'tpe-1', brigade_id: 'brg-5', accounting_id: 'acc-5', date: D(2), mode: 'TPE', client_name: 'Client carte', client_id: null, fuel_type: 'ESSENCE', liters: 40, price_per_liter: PRICES.ESSENCE, amount: round2(40 * PRICES.ESSENCE), track_id: 'trk-1', track_name: 'Piste 1', pompiste_id: 'pmp-1', pompiste_name: 'Karim Benali', notes: null, created_at: T(2, 13) },
    ],
    fuel_sales: b.fuelSales,
    clients, client_transactions, client_appointments,
    suppliers, supplier_appointments, supplier_debt_payments,
    product_brands, products,
    shop_sales: SHOP_SALES.map(s => s.sale),
    shop_sale_items: SHOP_SALES.flatMap(s => s.items),
    purchases, purchase_items, purchase_payments,
    delivery_notes, delivery_note_items, delivery_note_photos: [], delivery_note_payments: [],
    fuel_invoices, fuel_invoice_bls, fuel_receipts: [], fuel_receipt_invoices: [],
    bank_accounts, treasury_transactions, expenses,
    inventories: [
      { id: 'inv-1', name: 'Inventaire mensuel cuves', description: 'Contrôle des jauges', date: D(10), user_name: DEMO_ADMIN.name, type: 'FUEL', status: 'Validé', fuel_gaps: [{ tankId: 'tank-1', theoretical: 19100, actual: 19050, gap: -50 }, { tankId: 'tank-2', theoretical: 27000, actual: 27020, gap: 20 }], pump_index_gaps: [], product_gaps: [], adjustment_reason: 'Évaporation', adjusted_at: T(10), created_at: T(10) },
    ],
    daily_reports: [1, 2, 3].map(n => ({
      id: `drp-${n}`, date: D(n), fuel_revenue: round2(fuelRevenue(n)), shop_revenue: SHOP_SALES.filter(s => s.sale.date.slice(0, 10) === D(n)).reduce((x, s) => x + s.sale.total, 0),
      total_expenses: expenses.filter(e => e.date === D(n)).reduce((x, e) => x + e.amount, 0), cash_to_deposit: round2(fuelRevenue(n) * 0.8),
      tank_variations: [], brigade_ids: b.brigades.filter(br => br.date === D(n)).map(br => br.id), created_at: T(n, 22),
    })),
    permission_templates: [
      { id: 'tpl-1', name: 'Pompiste standard', role: 'pompiste', permissions: { dashboard: true, my_brigade: true, my_payments: true }, created_at: T(100) },
      { id: 'tpl-2', name: 'Gérant complet', role: 'gerant', permissions: gerants[0].permissions, created_at: T(100) },
    ],
    activity_log: [
      { id: 'log-1', timestamp: T(0, 8), user_id: DEMO_ADMIN.id, action: 'Connexion', details: 'Connexion au compte démo' },
      { id: 'log-2', timestamp: T(1, 14), user_id: 'chef-1', action: 'Clôture brigade', details: 'Brigade du matin clôturée' },
    ],
    module_workers: biz.moduleWorkers,
    biz_store: [{ id: 'biz-v1', state: biz.state, rev: 1, updated_at: T(0, 7) }],
    biz_store_meta: [{ id: 'biz-v1', rev: 1 }],
    biz_products: biz.bizProducts,
    biz_sessions: biz.sessions,
    client_feedbacks: [
      { id: 'fb-1', part: 'fuel', full_name: 'Lamine B.', phone: '0665 11 22 33', email: null, message: 'Service rapide et personnel aimable. Merci !', status: 'unread', read_at: null, read_by: null, created_at: T(1, 17) },
      { id: 'fb-2', part: 'cafeteria', full_name: null, phone: null, email: null, message: 'Le café est excellent, mais il manque parfois des croissants le matin.', status: 'unread', read_at: null, read_by: null, created_at: T(2, 9) },
      { id: 'fb-3', part: 'lavage', full_name: 'Imene K.', phone: null, email: 'imene@example.com', message: 'Lavage soigné, voiture impeccable.', status: 'read', read_at: T(3, 12), read_by: DEMO_ADMIN.name, created_at: T(4, 16) },
    ],
    armoires,
    armoire_stock: biz.armoireStock,
    stock_transfers: biz.stockTransfers,
    stock_transfer_items: biz.stockTransferItems,
    armoire_sales: [],
    armoire_purchases: [],
  };
}
