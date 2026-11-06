/**
 * ─── Vérification du dossier client ────────────────────────────────────────────
 *
 * Le dossier est le seul écran que les TROIS activités partagent — Carburant,
 * Cafétéria, Lavage & Réparation. Une rubrique qui cesse de rendre, ou un total
 * qui ne se retrouve plus dans le journal, casse donc les trois d'un coup, et
 * rien ne le dirait avant qu'un gérant n'ouvre la fiche d'un client.
 *
 * Ce que ces cas protègent :
 *
 *   • les six rubriques rendent réellement leur contenu — l'écran d'avant
 *     n'avait qu'un onglet « Historique » qui affichait une liste vide ;
 *   • le journal porte le SOLDE après chaque opération : sans lui, une suite de
 *     montants ne se vérifie pas ;
 *   • ce qui cloche est DIT — plafond dépassé, écart entre le compteur de la
 *     fiche et les pièces — au lieu d'être laissé à deviner ;
 *   • les chiffres du pied de page sont ceux du relevé, au dinar près ;
 *   • une partie sans compte d'avance n'affiche pas de rubrique d'avance vide.
 *
 * Le rendu se fait hors navigateur : `createPortal` est rendu transparent et un
 * `document` minimal est posé, sinon le dossier — qui refuse de s'afficher hors
 * navigateur — ne rendrait rien du tout et tous les cas passeraient à vide.
 *
 *   npx tsx src/components/clients/ClientDossier.test.tsx
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { createRequire } from 'module';

// ── Le décor minimal d'un navigateur ─────────────────────────────────────────
// À faire AVANT d'importer le dossier : il lit `document` au premier rendu et
// son contenu part dans un portail que le rendu serveur ne sait pas suivre.
const require_ = createRequire(import.meta.url);
require_('react-dom').createPortal = (children: any) => children;
(globalThis as any).document = { body: {} };

const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const ClientDossier = (await import('./ClientDossier')).default;
const { fuelClientStatement, bizClientStatement } = await import('../../lib/clientStatement');

let passed = 0, failed = 0;
const check = (label: string, ok: boolean) => {
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
};
const section = (t: string) => console.log(`\n${t}`);

/**
 * Le rendu échappe les apostrophes et sépare les milliers par une espace
 * insécable : on remet les deux à plat pour chercher du texte lisible.
 */
const flat = (s: string) => s
  .replace(/&#x27;/g, "'")
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');

// ─── Un client Carburant : un bon à crédit, une facture magasin, un règlement ──
const client = {
  id: 'c1', name: 'Transport Belaid', phone: '0550', paymentMode: 'CREDIT',
  // La fiche annonce 9 000 là où les pièces disent 6 000 : l'écart doit être dit.
  debt: 9000, advanceBalance: 0, balance: 0, creditLimit: 5000, cin: 'X1', type: 'ENTREPRISE',
  transactionHistory: [{ id: 't1', date: '2026-02-20T10:00:00', type: 'PAYMENT', amount: 5000, mode: 'ESPECES' }],
};
const app = {
  clients: [client],
  brigades: [{ id: 'b1', date: '2026-01-10', startDatetime: '2026-01-10T06:00:00', shift: 'Matin' }],
  brigadeAccountings: [{
    id: 'a1', brigadeId: 'b1', justifications: [
      { id: 'j1', clientId: 'c1', amount: 10000, liters: 200, fuelType: 'GASOIL', pricePerLiter: 50, paymentMode: 'CREDIT' }],
  }],
  shopSales: [{
    id: 's1', date: '2026-02-01', clientId: 'c1', total: 3000, amountPaid: 2000, rest: 1000, paymentMode: 'CREDIT',
    items: [{ productName: 'Huile 10W40', quantity: 2, price: 1500 }],
  }],
  fuelSales: [],
};

const st = fuelClientStatement(app, client);
const render = (rubrique: string) => flat(renderToStaticMarkup(
  <ClientDossier
    open onClose={() => {}} statement={st} initialSection={rubrique}
    recordedDebt={9000} creditLimit={5000}
    identity={[{ title: 'Coordonnées', rows: [{ label: 'Téléphone', value: '0550' }, { label: 'E-mail' }] }]}
    advance={{ available: 0, recharged: 0, used: 0, gap: 0 }}
    onPayDebt={() => {}} onReport={() => {}} onPrintStatement={() => {}} /> as any));

section("Carburant — chaque rubrique rend son contenu");
{
  const resume = render('resume');
  check("la vue d'ensemble porte les trois soldes",
    /Total consommé/.test(resume) && /Total encaissé/.test(resume) && /Reste dû/.test(resume));
  check('la répartition par nature est là', /Répartition par nature/.test(resume));
  check("l'activité mois par mois aussi", /Activité mois par mois/.test(resume));

  const journal = render('journal');
  check('le journal liste TOUTES les opérations', /Journal des opérations \(3\)/.test(journal));
  check('il porte la colonne du solde progressif', />Solde</.test(journal));
  check('le bon carburant y figure', /Bon carburant/.test(journal));
  check('la vente magasin aussi', /Vente magasin/.test(journal));
  check('et le règlement', /Règlement/.test(journal));

  const achats = render('achats');
  check('les achats listent les documents seuls', /Achats et consommations \(2\)/.test(achats));
  check("le cumul par article est là", /Détail par article et prestation/.test(achats));
  check("l'article du magasin est nommé", /Huile 10W40/.test(achats));
  check('le carburant du bon aussi', /GASOIL/.test(achats));

  const regl = render('reglements');
  check('les règlements sont listés', /Règlements encaissés \(2\)/.test(regl));
  check('le reste dû est mis en tête', /Reste dû par le client/.test(regl));

  check("la rubrique avance rend ses mouvements",
    /Mouvements du compte d'avance/.test(render('avance')));

  const fiche = render('fiche');
  check('la fiche rend ses lignes', /Téléphone/.test(fiche));
  check("et dit qu'un champ est vide plutôt que de le cacher", /Non renseigné/.test(fiche));
}

section("Ce qui cloche est dit, pas laissé à deviner");
{
  const resume = render('resume');
  check('le plafond de crédit dépassé est signalé', /Plafond de crédit dépassé/.test(resume));
  check("l'écart entre le compteur de la fiche et les pièces aussi",
    /Encours enregistré différent des pièces/.test(resume));
}

section("Les chiffres affichés sont ceux du relevé");
{
  check('consommé = 10 000 (bon) + 3 000 (magasin)', st.totals.charged === 13000);
  check('encaissé = 5 000 (règlement) + 2 000 (réglés sur la facture)', st.totals.paid === 7000);
  check('reste dû = 10 000 + 1 000 − 5 000', st.closingDebt === 6000);
  check('et le pied du dossier annonce ce même reste dû',
    /Reste dû 6 000,00 DA/.test(render('journal')));
}

// ─── Une partie : mêmes rubriques, sans avance ────────────────────────────────
section("Cafétéria — le même dossier, sans compte d'avance");
{
  const state: any = {
    sales: [{
      id: 'sv', ref: 'V-1', clientId: 'c1', clientName: 'Café Belaid', date: '2026-03-02',
      items: [{ productId: 'p1', productName: 'Café', qty: 10, unitPrice: 50 }],
      subtotal: 500, reduction: 0, total: 500, paid: 300, rest: 200, status: 'crédit',
      payments: [{ id: 'p1', date: '2026-03-02', amount: 300, mode: 'Espèces' }],
    }],
    reparations: [],
  };
  const bst = bizClientStatement(state, { id: 'c1', name: 'Café Belaid', createdAt: '' } as any, 'Cafétéria');
  const html = flat(renderToStaticMarkup(
    <ClientDossier open onClose={() => {}} statement={bst} initialSection="journal" /> as any));

  check('la vente ET son règlement sont au journal', /Journal des opérations \(2\)/.test(html));
  check("aucune rubrique d'avance quand la partie n'en tient pas",
    !/Compte d'avance/.test(html));
  check('le reste dû de la partie', bst.closingDebt === 200);
}

// ─── Un compte ouvert SUR UNE AVANCE ──────────────────────────────────────────
//
// Le cas qui ne rendait rien. Une fiche créée « sur avance » écrivait bien le
// montant en base, mais le dossier n'en montrait aucune trace : pas de ligne au
// journal, pas de rubrique d'avance côté Cafétéria et Lavage, et un « reste dû »
// qui réclamait au client l'argent qu'il venait pourtant de verser.
section("Cafétéria — un compte ouvert sur une avance de 20 000");
{
  const prepaid: any = {
    id: 'k9', name: 'Prépayé Café', createdAt: '2026-08-01T08:00:00',
    openingDebt: 0, openingAdvance: 20000, openingDate: '2026-08-01',
  };
  const state: any = {
    clients: [prepaid],
    sales: [{
      id: 'sv9', ref: 'V-9', clientId: 'k9', clientName: 'Prépayé Café', date: '2026-08-10',
      items: [{ productId: 'p1', productName: 'Café', qty: 10, unitPrice: 500 }],
      subtotal: 5000, reduction: 0, total: 5000, paid: 0, rest: 5000, status: 'crédit', payments: [],
    }],
    reparations: [],
  };
  const bst = bizClientStatement(state, prepaid, 'Cafétéria');
  const draw = (rubrique: string) => flat(renderToStaticMarkup(
    <ClientDossier
      open onClose={() => {}} statement={bst} initialSection={rubrique}
      opening={{ debt: 0, advance: 20000, date: '2026-08-01', paid: 0 }}
      advance={{
        available: bst.advanceLeft,
        recharged: bst.totals.advanceRecharged,
        used: bst.totals.advanceUsed,
      }} /> as any));

  const journal = draw('journal');
  check("l'avance initiale FIGURE au journal", /Avance initiale/.test(journal));
  check('avec la vente, cela fait deux lignes', /Journal des opérations \(2\)/.test(journal));

  const resume = draw('resume');
  check('la reprise est montrée comme une avance', /Avance initiale/.test(resume));
  check('et elle est dite portée au crédit du compte', /portée au crédit du compte/.test(resume));
  check("le reste dû dit ce que l'avance a absorbé", /pris sur son avance/.test(resume));

  const avance = draw('avance');
  check("la rubrique d'avance existe enfin pour une partie", /Mouvements du compte d'avance/.test(avance));
  check('elle montre ce qui a été imputé', /imputés sur ce qu'il doit/.test(avance));

  check('le compte ne réclame plus rien', bst.netDebt === 0);
  check('et il reste 15 000 au client', bst.advanceLeft === 15000);
}

console.log(`\n${passed} vérification(s) passée(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
