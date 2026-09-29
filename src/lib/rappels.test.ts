/**
 * ─── LES RAPPELS DE PASSAGE, ET LES NUMÉROS ────────────────────────────────────
 *
 * Ce que ces cas protègent — chacun correspond à une façon dont la
 * fonctionnalité se serait retournée contre la station :
 *
 *   • un client qui lave sa voiture toutes les semaines ne doit recevoir QU'UN
 *     rappel, celui de son dernier passage. Sans la règle du « dernier passage
 *     par véhicule et par nature », chaque visite en produirait un, et le client
 *     recevrait cinquante messages d'un coup — le chemin le plus court vers un
 *     numéro banni ;
 *   • le lavage et la vidange ont des délais INDÉPENDANTS. Une intervention
 *     mixte doit donc produire deux échéances distinctes ;
 *   • un délai à zéro coupe SA nature, sans toucher à l'autre ;
 *   • une alerte classée (lue) ou envoyée ne revient plus ;
 *   • une intervention non finalisée n'annonce aucun prochain passage ;
 *   • deux postes qui traitent la même alerte doivent produire la MÊME ligne :
 *     l'identifiant est déterministe, jamais tiré au hasard ;
 *   • un numéro écrit « 0550 12 34 56 » ici et « +213 550 123 456 » là désigne le
 *     même destinataire : sans normalisation, le même client reçoit deux fois le
 *     même rappel.
 *
 *   npx tsx src/lib/rappels.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { buildRappels, carKeyOf, rappelId, addDays, daysBetween } from './rappels';
import { normalizePhone, renderTemplate, missingTokens, displayPhone } from './whatsappCore';
import { BizContact, BizRappel, BizReparation } from './bizConfig';

let passed = 0, failed = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = typeof actual === 'number' && typeof expected === 'number'
    ? Math.abs(actual - expected) < 0.0001
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}\n      attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`); }
};
const section = (t: string) => console.log(`\n${t}`);

const TODAY = '2026-08-22';

const client: BizContact = {
  id: 'cl1', name: 'Belaid Karim', phone: '0550 12 34 56', createdAt: '2025-01-01',
  cars: [
    { id: 'v1', name: 'Clio', marque: 'Renault', immatriculation: '12345-116-31', kilometrage: 84000 },
    { id: 'v2', name: 'Hilux', marque: 'Toyota' },
  ],
};

const rep = (over: Partial<BizReparation>): BizReparation => ({
  id: 'r?', ref: 'LAV-0001', kind: 'lavage', clientId: 'cl1', clientName: 'Belaid Karim',
  car: { id: 'v1' }, serviceTotal: 800, usedProducts: [], total: 800, paid: 800, rest: 0,
  status: 'finalized', date: '2026-08-01T10:00:00', workers: [],
  prestations: [{ id: 'p1', kind: 'lavage', label: 'Lavage complet', amount: 800, workerIds: [] }],
  ...over,
});

const CFG = { lavageDays: 30, reparationDays: 180, enabled: true };

// ─── 1. Le cas de base ────────────────────────────────────────────────────────
section('1. Un lavage du 1er août, rappelé 30 jours plus tard');
{
  const alerts = buildRappels({
    reparations: [rep({ id: 'r1', date: '2026-08-01T10:00:00' })],
    clients: [client], handled: [], config: CFG, today: TODAY, lookaheadDays: 14,
  });
  check('une seule alerte', alerts.length, 1);
  check("l'échéance tombe le 31 août", alerts[0]?.dueDate, '2026-08-31');
  check('elle est encore à venir', alerts[0]?.due, false);
  check('dans 9 jours', alerts[0]?.daysLeft, 9);
  check('le kilométrage vient de la FICHE du client', alerts[0]?.kilometrage, 84000);
  check('le téléphone suit', alerts[0]?.clientPhone, '0550 12 34 56');
}

section("1 bis. La fenêtre d'anticipation — ce qui est encore trop loin attend");
{
  const one = [rep({ id: 'r1', date: '2026-08-01T10:00:00' })];   // échéance au 31 août
  const near = buildRappels({ reparations: one, clients: [client], handled: [], config: CFG, today: TODAY });
  check("à 9 jours, la fenêtre par défaut (7 j) l'écarte encore", near.length, 0);

  const due = buildRappels({
    reparations: one, clients: [client], handled: [], config: CFG, today: '2026-08-31',
  });
  check("le jour de l'échéance, elle apparaît", due.length, 1);
  check('et elle est due', due[0]?.due, true);
  check("« aujourd'hui »", due[0]?.daysLeft, 0);

  const strict = buildRappels({
    reparations: one, clients: [client], handled: [], config: CFG, today: '2026-08-30', lookaheadDays: 0,
  });
  check('lookahead 0 ⇒ uniquement les échues', strict.length, 0);
}

// ─── 2. La règle qui évite le harcèlement ─────────────────────────────────────
section('2. Cinquante-deux lavages du même véhicule ⇒ UN seul rappel');
{
  const many: BizReparation[] = [];
  for (let i = 0; i < 52; i++) {
    const d = new Date(Date.UTC(2025, 7, 20 + i * 7));
    many.push(rep({ id: `r${i}`, date: d.toISOString() }));
  }
  const alerts = buildRappels({
    reparations: many, clients: [client], handled: [], config: CFG, today: TODAY, lookaheadDays: 3650,
  });
  check('une alerte, pas cinquante-deux', alerts.length, 1);
  const last = many[many.length - 1];
  check("elle porte le DERNIER passage", alerts[0]?.reparationId, last.id);
}

// ─── 3. Deux véhicules, deux rappels ──────────────────────────────────────────
section('3. Deux véhicules du même client sont suivis séparément');
{
  const alerts = buildRappels({
    reparations: [
      rep({ id: 'r1', car: { id: 'v1' }, date: '2026-08-01T10:00:00' }),
      rep({ id: 'r2', car: { id: 'v2' }, date: '2026-07-10T10:00:00' }),
    ],
    clients: [client], handled: [], config: CFG, today: TODAY, lookaheadDays: 14,
  });
  check('deux alertes', alerts.length, 2);
  check('la plus en retard vient en tête', alerts[0]?.reparationId, 'r2');
  check('et elle est bien échue', alerts[0]?.due, true);
}

// ─── 4. Lavage et vidange, délais indépendants ─────────────────────────────
section('4. Une intervention mixte produit deux échéances distinctes');
{
  const alerts = buildRappels({
    reparations: [rep({
      id: 'r1', kind: 'mixte', ref: 'INT-0001', date: '2026-08-01T10:00:00',
      prestations: [
        { id: 'p1', kind: 'lavage', label: 'Lavage', amount: 800, workerIds: [] },
        { id: 'p2', kind: 'reparation', label: 'Vidange', amount: 4500, workerIds: [] },
      ],
    })],
    clients: [client], handled: [], config: CFG, today: TODAY, lookaheadDays: 3650,
  });
  check('deux alertes', alerts.length, 2);
  const lav = alerts.find(a => a.kind === 'lavage');
  const rpr = alerts.find(a => a.kind === 'reparation');
  check('le lavage revient à 30 jours', lav?.dueDate, '2026-08-31');
  check('la vidange à 180 jours', rpr?.dueDate, '2027-01-28');
}

// ─── 5. Un délai à zéro coupe SA nature seulement ─────────────────────────────
section('5. lavageDays = 0 ⇒ plus de rappel de lavage, la vidange reste');
{
  const alerts = buildRappels({
    reparations: [rep({
      id: 'r1', kind: 'mixte', date: '2026-01-01T10:00:00',
      prestations: [
        { id: 'p1', kind: 'lavage', label: 'Lavage', amount: 800, workerIds: [] },
        { id: 'p2', kind: 'reparation', label: 'Vidange', amount: 4500, workerIds: [] },
      ],
    })],
    clients: [client], handled: [],
    config: { lavageDays: 0, reparationDays: 180, enabled: true }, today: TODAY,
  });
  check('une seule alerte', alerts.length, 1);
  check('et c\'est la vidange', alerts[0]?.kind, 'reparation');
}

section('5 bis. Rappels désactivés ⇒ aucune alerte, les délais sont conservés');
{
  const alerts = buildRappels({
    reparations: [rep({ id: 'r1', date: '2026-01-01T10:00:00' })],
    clients: [client], handled: [], config: { ...CFG, enabled: false }, today: TODAY,
  });
  check('rien', alerts.length, 0);
}

// ─── 6. Ce qui a été traité ne revient plus ───────────────────────────────────
section('6. Une alerte classée — ou envoyée — quitte la liste');
{
  const r1 = rep({ id: 'r1', date: '2026-01-01T10:00:00' });
  const id = rappelId('r1', 'lavage', 'v1');
  const before = buildRappels({ reparations: [r1], clients: [client], handled: [], config: CFG, today: TODAY });
  check('elle est bien là au départ', before.length, 1);
  check("l'identifiant est déterministe", before[0]?.id, id);

  const read: BizRappel = { id, reparationId: 'r1', kind: 'lavage', carKey: 'v1', status: 'read', at: TODAY };
  const after = buildRappels({ reparations: [r1], clients: [client], handled: [read], config: CFG, today: TODAY });
  check('classée, elle disparaît', after.length, 0);

  const sent: BizRappel = { ...read, status: 'sent' };
  const afterSent = buildRappels({ reparations: [r1], clients: [client], handled: [sent], config: CFG, today: TODAY });
  check('envoyée, elle disparaît aussi', afterSent.length, 0);
}

section('6 bis. Un NOUVEAU passage recrée une alerte, à la nouvelle échéance');
{
  const id = rappelId('r1', 'lavage', 'v1');
  const handled: BizRappel[] = [{ id, reparationId: 'r1', kind: 'lavage', carKey: 'v1', status: 'sent', at: TODAY }];
  const alerts = buildRappels({
    reparations: [
      rep({ id: 'r1', date: '2026-01-01T10:00:00' }),
      rep({ id: 'r2', date: '2026-08-05T10:00:00' }),
    ],
    clients: [client], handled, config: CFG, today: TODAY, lookaheadDays: 3650,
  });
  check('une alerte, celle du nouveau passage', alerts.length, 1);
  check('portée par r2', alerts[0]?.reparationId, 'r2');
  check('échéance repoussée', alerts[0]?.dueDate, '2026-09-04');
}

// ─── 7. Ce qui n'annonce aucun passage ────────────────────────────────────────
section('7. Une intervention en attente, annulée, ou sans client');
{
  const none = buildRappels({
    reparations: [
      rep({ id: 'r1', status: 'pending', date: '2026-01-01T10:00:00' }),
      rep({ id: 'r2', status: 'canceled', date: '2026-01-01T10:00:00' }),
      rep({ id: 'r3', clientId: undefined, clientName: 'Client de passage', date: '2026-01-01T10:00:00' }),
    ],
    clients: [client], handled: [], config: CFG, today: TODAY,
  });
  check('aucune alerte', none.length, 0);
}

// ─── 8. La clé d'un véhicule ──────────────────────────────────────────────────
section('8. La clé d\'un véhicule, avec et sans fiche');
{
  check("l'identifiant du parc l'emporte", carKeyOf({ id: 'v1', immatriculation: 'X' }), 'v1');
  check('à défaut, la plaque', carKeyOf({ immatriculation: '12345-116-31' }), 'plate:12345-116-31');
  check('la plaque est insensible à la casse et aux espaces',
    carKeyOf({ immatriculation: ' 12345-116-31 ' }), 'plate:12345-116-31');
  check('à défaut, marque et modèle', carKeyOf({ marque: 'Renault', name: 'Clio' }), 'car:renault clio');
  check('un véhicule sans signe distinctif', carKeyOf({}), '');
}

// ─── 9. L'arithmétique des journées ───────────────────────────────────────────
section('9. Les dates, en journées locales — jamais en UTC');
{
  check('30 jours après le 1er août', addDays('2026-08-01', 30), '2026-08-31');
  check('un changement de mois', addDays('2026-01-31', 1), '2026-02-01');
  check('une année bissextile', addDays('2028-02-28', 1), '2028-02-29');
  check('écart entre deux dates', daysBetween('2026-08-22', '2026-08-31'), 9);
  check('écart négatif quand la date est passée', daysBetween('2026-08-22', '2026-08-01'), -21);
}

// ─── 10. Les numéros ──────────────────────────────────────────────────────────
section('10. Un numéro écrit de six façons désigne le même destinataire');
{
  const expected = '213550123456';
  check('forme nationale', normalizePhone('0550123456'), expected);
  check('avec des espaces', normalizePhone('0550 12 34 56'), expected);
  check('avec des tirets', normalizePhone('0550-12-34-56'), expected);
  check('forme internationale', normalizePhone('+213550123456'), expected);
  check('forme internationale à l\'ancienne', normalizePhone('00213550123456'), expected);
  check('sans le zéro initial', normalizePhone('550123456'), expected);

  check('un numéro vide est refusé', normalizePhone(''), null);
  check('un numéro trop court est refusé', normalizePhone('0550'), null);
  check('du texte est refusé', normalizePhone('à rappeler'), null);
  check('un fixe à 10 chiffres reste accepté', normalizePhone('045123456' + '7'), '213451234567');

  check('affichage lisible', displayPhone('213550123456'), '+213 550 12 34 56');
}

// ─── 11. Les modèles ──────────────────────────────────────────────────────────
section('11. Un modèle rempli — et ce qui arrive aux jetons inconnus');
{
  const body = 'Bonjour {client}, votre {vehicule} ({kilometrage} km) — {station}.';
  const out = renderTemplate(body, {
    client: 'Belaid', vehicule: 'Renault Clio', kilometrage: '84 000', station: 'RCLMC',
  });
  check('tous les jetons remplis', out, 'Bonjour Belaid, votre Renault Clio (84 000 km) — RCLMC.');

  const partial = renderTemplate('Bonjour {client}, votre {vehicule}.', { client: 'Belaid', vehicule: undefined });
  check('un jeton CONNU mais vide disparaît', partial, 'Bonjour Belaid, votre .');

  const unknown = renderTemplate('Bonjour {clientt}.', { client: 'Belaid' });
  check("un jeton MAL ORTHOGRAPHIÉ reste visible", unknown, 'Bonjour {clientt}.');
  check('et il est signalé avant l\'envoi', missingTokens(unknown), ['{clientt}']);
  check('un texte propre ne signale rien', missingTokens('Bonjour Belaid.'), []);
}

// ─── 12. Le délai PROPRE À CHAQUE VÉHICULE ────────────────────────────────────
section('12. Un délai posé sur un véhicule l\'emporte sur le réglage de la partie');
{
  // La Clio (v1) est réglée à 7 jours de lavage, propre à elle ; la Hilux (v2)
  // n'a rien et suit le défaut de la partie (30 jours).
  const clientPerCar: BizContact = {
    id: 'cl1', name: 'Belaid Karim', phone: '0550 12 34 56', createdAt: '2025-01-01',
    cars: [
      { id: 'v1', name: 'Clio', marque: 'Renault', rappelLavageDays: 7 },
      { id: 'v2', name: 'Hilux', marque: 'Toyota' },
    ],
  };
  const alerts = buildRappels({
    reparations: [
      rep({ id: 'r1', car: { id: 'v1' }, date: '2026-08-01T10:00:00' }),
      rep({ id: 'r2', car: { id: 'v2' }, date: '2026-08-01T10:00:00' }),
    ],
    clients: [clientPerCar], handled: [], config: CFG, today: TODAY, lookaheadDays: 60,
  });
  const clio = alerts.find(a => a.reparationId === 'r1');
  const hilux = alerts.find(a => a.reparationId === 'r2');
  check('la Clio revient à 7 jours (son délai propre)', clio?.dueDate, '2026-08-08');
  check('la Hilux garde le défaut de 30 jours', hilux?.dueDate, '2026-08-31');
}

section('12 bis. Un délai de 0 sur un véhicule le fait taire, lui seul');
{
  const clientMute: BizContact = {
    id: 'cl1', name: 'Belaid Karim', phone: '0550 12 34 56', createdAt: '2025-01-01',
    cars: [
      { id: 'v1', name: 'Clio', marque: 'Renault', rappelLavageDays: 0 },
      { id: 'v2', name: 'Hilux', marque: 'Toyota' },
    ],
  };
  const alerts = buildRappels({
    reparations: [
      rep({ id: 'r1', car: { id: 'v1' }, date: '2026-01-01T10:00:00' }),
      rep({ id: 'r2', car: { id: 'v2' }, date: '2026-08-01T10:00:00' }),
    ],
    clients: [clientMute], handled: [], config: CFG, today: TODAY, lookaheadDays: 60,
  });
  check('une seule alerte : la Clio muette est écartée', alerts.length, 1);
  check('et c\'est la Hilux', alerts[0]?.reparationId, 'r2');
}

section('12 ter. Le lavage et la vidange d\'un véhicule se règlent séparément');
{
  const clientMixte: BizContact = {
    id: 'cl1', name: 'Belaid Karim', phone: '0550 12 34 56', createdAt: '2025-01-01',
    cars: [{ id: 'v1', name: 'Clio', marque: 'Renault', rappelLavageDays: 15, rappelReparationDays: 90 }],
  };
  const alerts = buildRappels({
    reparations: [rep({
      id: 'r1', kind: 'mixte', car: { id: 'v1' }, date: '2026-08-01T10:00:00',
      prestations: [
        { id: 'p1', kind: 'lavage', label: 'Lavage', amount: 800, workerIds: [] },
        { id: 'p2', kind: 'reparation', label: 'Vidange', amount: 4500, workerIds: [] },
      ],
    })],
    clients: [clientMixte], handled: [], config: CFG, today: TODAY, lookaheadDays: 3650,
  });
  const lav = alerts.find(a => a.kind === 'lavage');
  const rpr = alerts.find(a => a.kind === 'reparation');
  check('le lavage propre au véhicule : 15 jours', lav?.dueDate, '2026-08-16');
  check('la vidange propre au véhicule : 90 jours', rpr?.dueDate, '2026-10-30');
}

// ─── Bilan ────────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? '✓' : '✗'} ${passed} cas passés, ${failed} en échec.`);
if (failed > 0) process.exit(1);
