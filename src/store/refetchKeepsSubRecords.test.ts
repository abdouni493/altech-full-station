/**
 * ─── Un rafraîchissement ne doit RIEN oublier du dossier ───────────────────────
 *
 * LE DÉFAUT, tel qu'il se voyait à l'écran : on encaissait un règlement, il
 * s'affichait — puis il disparaissait tout seul de l'historique du client, et la
 * caisse Carburant reperdait le montant dans la foulée.
 *
 * LA CAUSE : `mapClient` ne sait rendre que la LIGNE du client. Ses rendez-vous
 * et son historique de mouvements vivent dans deux autres tables, et repartent
 * donc VIDES. L'abonnement temps réel — et le rafraîchissement d'une minute qui
 * prend le relais quand le websocket est bloqué — rechargeaient les clients avec
 * ce mappeur seul : chaque client était remplacé par une fiche sans mémoire.
 * Pire, enregistrer un règlement met à jour `clients.debt`, donc déclenchait
 * lui-même l'événement qui l'effaçait de l'écran.
 *
 * Les mêmes dégâts frappaient les ventes magasin (leurs articles) et les
 * fournisseurs (leurs échéances et leurs règlements).
 *
 * CE QUE CE CAS PROTÈGE : que ces trois tranches passent par un chargeur qui
 * remonte les sous-tables, jamais par le mappeur nu. Une seule ligne remise en
 * `.map(mapClient)` ferait revenir toute la panne.
 *
 *   npx tsx src/store/refetchKeepsSubRecords.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0, failed = 0;
const check = (label: string, ok: boolean) => {
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const source = readFileSync(join(process.cwd(), 'src/store/AppContext.tsx'), 'utf8');

/** Le corps de la table des tranches rechargées en direct. */
const realtimeMap = (() => {
  const start = source.indexOf('const tableMap: Record<string, SliceFn> = {');
  const end = source.indexOf('const unsubs: (() => void)[] = [];', start);
  if (start < 0 || end < 0) throw new Error('tableMap introuvable dans AppContext');
  return source.slice(start, end);
})();

console.log('Les tranches rechargées en direct gardent leurs sous-tables');
{
  // Le mappeur nu rend bien des tableaux vides : c'est ce qui rend son usage
  // direct dangereux, et ce que ce cas vérifie d'abord.
  check("`mapClient` repart d'un historique vide (d'où la règle)",
    /function mapClient[\s\S]*?transactionHistory: \[\]/.test(source));
  check('`mapShopSale` repart d’articles vides', /function mapShopSale[\s\S]*?items: \[\]/.test(source));

  check('les clients passent par `loadClientsEnriched`', realtimeMap.includes('loadClientsEnriched()'));
  check('les fournisseurs par `loadSuppliersEnriched`', realtimeMap.includes('loadSuppliersEnriched()'));
  check('les ventes magasin par `loadShopSalesEnriched`', realtimeMap.includes('loadShopSalesEnriched()'));

  check('aucun client rechargé au mappeur nu', !/\.map\(mapClient\)/.test(realtimeMap));
  check('aucun fournisseur rechargé au mappeur nu', !/\.map\(mapSupplier\)/.test(realtimeMap));
  check('aucune vente magasin rechargée au mappeur nu', !/\.map\(mapShopSale\)/.test(realtimeMap));
}

console.log('');
console.log('Les chargeurs remontent bien les sous-tables');
{
  const body = (name: string) => {
    const start = source.indexOf(`async function ${name}(`);
    if (start < 0) return '';
    return source.slice(start, source.indexOf('\n}\n', start));
  };
  const clients = body('loadClientsEnriched');
  check('`loadClientsEnriched` lit `client_transactions`', clients.includes("'client_transactions'"));
  check('… et `client_appointments`', clients.includes("'client_appointments'"));
  check('… et remplit `transactionHistory`', clients.includes('m.transactionHistory ='));

  const shop = body('loadShopSalesEnriched');
  check('`loadShopSalesEnriched` lit `shop_sale_items`', shop.includes("'shop_sale_items'"));

  const suppliers = body('loadSuppliersEnriched');
  check('`loadSuppliersEnriched` lit `supplier_debt_payments`', suppliers.includes("'supplier_debt_payments'"));
}

console.log('');
console.log('Les tables du rafraîchissement de secours sont couvertes');
{
  // Le sondage d'une minute rejoue les MÊMES tranches : si `clients` y figure
  // sans chargeur enrichi, la panne revient sur tout poste au websocket bloqué.
  const polled = source.slice(source.indexOf('const POLLED_TABLES = ['), source.indexOf('const POLL_INTERVAL_MS'));
  for (const table of ['clients', 'shop_sales']) {
    if (!polled.includes(`'${table}'`)) continue;
    check(`\`${table}\` est sondé — et sa tranche est enrichie`,
      new RegExp(`${table}:\\s*async \\(\\) => \\({? ?\\w+:\\s*await load`).test(realtimeMap));
  }
}

console.log(`\n${passed} vérification(s) passée(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
