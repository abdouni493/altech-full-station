/**
 * Scénario d'opérations RÉELLES, saisies à travers les écrans (Playwright).
 * Chaque étape note ce qu'elle doit faire bouger ; `deltas.ts` vérifie ensuite,
 * sur les instantanés avant / après, que chaque caisse, banque, dette et stock
 * a bougé EXACTEMENT de ce montant.
 *
 *   node tests/audit/scenario.cjs [url]   (écrit before.json, after.json, expected.json)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { login, dump } = require('./snapshot.cjs');

const URL = process.argv[2] || 'http://localhost:3000';
const DIR = __dirname;
const r2 = v => Math.round(v * 100) / 100;

async function go(p, route) { await p.goto(URL + route); await p.waitForTimeout(1800); }
const modal = p => p.locator('.modal-shell').last();
const step = async (name, fn) => {
  process.stdout.write(`• ${name} … `);
  await fn();
  console.log('ok');
};

async function run(p, expected) {
  const st = await p.evaluate(() => globalThis.__ALTECH_APP_STATE__);
  const prices = st.settings.fuelPrices;
  const buy = st.settings.fuelBuyPrices;
  const tank1 = st.tanks.find(t => t.id === 'tank-1') || st.tanks[0];
  const tank2 = st.tanks.find(t => t.id === 'tank-2') || st.tanks[1];
  const bank = st.bankAccounts[0];
  const client = st.clients.find(c => c.name === 'Taxi Ben Ali') || st.clients[0];

  // ── S1. Vente carburant : 10 L, TVA 19 %, payé 500 en espèces ─────────────
  const ht = r2(10 * prices[tank1.type]);
  const tva = Math.round(ht * 19) / 100;
  const ttc = r2(ht + tva);
  await step(`Vente carburant ${ttc} DA (payé 500, espèces)`, async () => {
    await go(p, '/ventes-carburant');
    await p.getByRole('button', { name: /Nouvelle vente/i }).first().click();
    const m = modal(p);
    await m.getByPlaceholder('Nom, téléphone, CIN, NIF…').fill(client.name);
    await m.locator('button:has(span.block)', { hasText: client.name }).first().click();
    await m.locator('.grid.max-h-56 button', { hasText: tank1.name }).first().click();
    await m.locator('tbody input[type=number]').first().fill('10');
    await m.locator('p:text-is("TVA")').locator('xpath=ancestor::div[contains(@class,"justify-between")][1]/button').click();
    await m.getByText(/^Oui$/).click();
    await m.locator('input[placeholder="0"]').last().fill('500');
    await m.getByRole('button', { name: /Enregistrer —/ }).click();
    await p.waitForTimeout(1200);
  });
  expected.carburantCash += 500;
  expected.clientDebt[client.id] = (expected.clientDebt[client.id] || 0) + r2(ttc - 500);
  expected.tank[tank1.id] = (expected.tank[tank1.id] || 0) - 10;
  expected.invoices += ttc;

  // ── S2. Achat carburant : 1 000 L, payé 10 000 en espèces ────────────────
  const purchaseHT = r2(1000 * buy[tank2.type]);
  const purchaseTotal = r2(purchaseHT * 1.19 + 500);
  await step(`Achat carburant ${purchaseTotal} DA (HT ${purchaseHT} + TVA 19 % + taxe 500, payé 10 000)`, async () => {
    await go(p, '/fuel-purchases');
    await p.getByRole('button', { name: /Nouvel achat/i }).first().click();
    const m = modal(p);
    await m.getByPlaceholder('FA-2026-001').fill('AUDIT-001');
    await m.locator('select').first().selectOption({ label: 'Distributeur Carburant Est' });
    await m.getByRole('button', { name: /Ajouter une cuve/ }).first().click();
    await p.waitForTimeout(300);
    const sel = m.locator('select').nth(1);
    await sel.selectOption(tank2.id);
    const qty = m.locator('input[type=number]').first();
    await qty.fill('1000');
    await m.locator('p:text-is("TVA")').locator('xpath=ancestor::div[contains(@class,"justify-between")][1]/button').click();
    await m.getByRole('button', { name: /Nouvelle taxe/ }).click();
    await m.getByPlaceholder('Ex : Taxe carburant').fill('Droit de timbre audit');
    await m.locator('select').filter({ hasText: 'Pourcentage (%)' }).last().selectOption('amount');
    await m.locator('input[placeholder="0"]').last().fill('500');
    await m.getByRole('button', { name: /Enregistrer & activer/ }).click();
    await p.waitForTimeout(300);
    await m.getByRole('button', { name: /^Espèces$/ }).first().click();
    await p.waitForTimeout(300);
    const amounts = m.locator('input[type=number]');
    const count = await amounts.count();
    // Le règlement : la dernière saisie numérique de la ligne de paiement.
    for (let i = 0; i < count; i++) {
      const v = await amounts.nth(i).inputValue();
      if (Math.abs(Number(v) - purchaseTotal) < 0.01) { await amounts.nth(i).fill('10000'); break; }
    }
    await m.getByRole('button', { name: /Enregistrer l'achat/ }).click();
    await p.waitForTimeout(1200);
  });
  expected.carburantCash -= 10000;
  expected.supplierDebt += r2(purchaseTotal - 10000);
  expected.tank[tank2.id] = (expected.tank[tank2.id] || 0) + 1000;
  expected.purchases += purchaseTotal;

  // ── S3. Dépense Carburant 1 234,56 en espèces ─────────────────────────────
  await step('Dépense Carburant 1 234,56 DA', async () => {
    await go(p, '/expenses');
    await p.getByRole('button', { name: /NOUVELLE DÉPENSE/ }).first().click();
    const m = modal(p);
    await m.locator('select').first().selectOption({ index: 2 });
    await m.getByPlaceholder('Ex: Réparation tuyau cuve...').fill('Audit dépense carburant');
    await m.getByPlaceholder('0.00').fill('1234.56');
    await m.getByRole('button', { name: /Carburant/ }).first().click();
    await m.getByRole('button', { name: /ENREGISTRER LA DÉPENSE/ }).click();
    await p.waitForTimeout(1500);
  });
  expected.carburantCash -= 1234.56;
  expected.expenses += 1234.56;

  // ── S4. Dépense Finance 700 en espèces ────────────────────────────────────
  await step('Dépense Finance 700 DA', async () => {
    await go(p, '/expenses');
    await p.getByRole('button', { name: /NOUVELLE DÉPENSE/ }).first().click();
    const m = modal(p);
    await m.locator('select').first().selectOption({ index: 2 });
    await m.getByPlaceholder('Ex: Réparation tuyau cuve...').fill('Audit dépense finance');
    await m.getByPlaceholder('0.00').fill('700');
    await m.getByRole('button', { name: /Finance/ }).first().click();
    await m.getByRole('button', { name: /ENREGISTRER LA DÉPENSE/ }).click();
    await p.waitForTimeout(1500);
  });
  expected.financeCash -= 700;
  expected.expenses += 700;

  // ── S5. Dépôt 5 000 dans la caisse Carburant (Caisse Générale) ───────────
  await step('Dépôt 5 000 DA — Carburant', async () => {
    await go(p, '/caisse-generale');
    await p.getByRole('button', { name: /DÉPÔT \/ RETRAIT|Dépôt \/ Retrait/ }).first().click();
    const m = modal(p);
    await m.getByRole('button', { name: /Dépôt \(entrée\)/ }).click();
    await m.locator('input[type=number]').first().fill('5000');
    await m.locator('select').first().selectOption({ label: 'Carburant' });
    await m.getByPlaceholder("Motif de l'opération").fill('Audit dépôt');
    await m.getByRole('button', { name: /^Valider$/ }).click();
    await p.waitForTimeout(1200);
  });
  expected.carburantCash += 5000;

  // ── S6. Brigade : TPE 1 500 en opérations détaillées, puis négociation ────
  await step('Brigade : + TPE 1 500 DA (2 opérations)', async () => {
    await go(p, '/brigades');
    const row = p.locator('tbody tr').first();
    await row.locator('button').nth(2).click();
    await p.waitForTimeout(1500);
    for (let i = 0; i < 5; i++) {
      const nb = p.getByRole('button', { name: /Suivant/i });
      if (await nb.count()) { await nb.first().click(); await p.waitForTimeout(500); }
    }
    await p.getByRole('button', { name: new RegExp(`\\+ TPE ${bank.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first().click();
    await p.getByRole('button', { name: /Opérations détaillées/ }).first().click();
    await p.getByTestId('op-card').first().fill('4000111122223333');
    await p.getByTestId('op-number').first().fill('OP-A1');
    // Quantité → montant calculé au prix du carburant ; puis montant forcé.
    await p.getByTestId('op-amount').first().fill('1000');
    await p.getByRole('button', { name: /Ajouter une opération/ }).first().click();
    await p.getByTestId('op-card').nth(1).fill('4000555566667777');
    await p.getByTestId('op-amount').nth(1).fill('500');
    // TAG en montant global (300), crédit client (250) et dépense de brigade (200).
    await p.getByRole('button', { name: /^\+ TAG$/ }).first().click();
    await p.getByPlaceholder('Montant total').first().fill('300');
    await p.getByPlaceholder('Description').first().fill('Bon société audit');
    await p.getByRole('button', { name: /\+ Crédit Client/ }).first().click();
    await p.getByPlaceholder('Rechercher client (nom / téléphone)').first().fill(client.name.split(' ')[0]);
    await p.locator('button', { hasText: client.name }).filter({ hasText: 'Dette' }).first().click();
    await p.getByPlaceholder('Montant total').first().fill('250');
    await p.getByRole('button', { name: /\+ Dépense/ }).first().click();
    await p.getByPlaceholder("Ex: Achat d'eau, réparation, pourboire…").fill('Audit café équipe');
    await p.getByRole('button', { name: /Ajouter la dépense/ }).locator('xpath=ancestor::div[1]/preceding-sibling::*//input[@type="number"]').first().fill('200').catch(async () => {
      await p.locator('input[type=number][placeholder="0"]').last().fill('200');
    });
    await p.getByRole('button', { name: /Ajouter la dépense/ }).click();
    await p.getByRole('button', { name: /Mettre à jour & clôturer|Enregistrer & clôturer|Clôturer/ }).first().click();
    await p.waitForTimeout(2500);
  });
  expected.bank[bank.id] = (expected.bank[bank.id] || 0) + 1500 + 300;
  expected.tpe += 1500 + 300;
  expected.clientDebt[client.id] = (expected.clientDebt[client.id] || 0) + 250;
  expected.expenses += 200;

  await step('Négociation des 2 opérations TPE (1 500 DA → caisse Carburant)', async () => {
    await go(p, '/bank-accounts');
    await p.locator('button[title="Négociation TPE / TAG"]').first().click();
    await p.waitForTimeout(600);
    const m = modal(p);
    await m.getByPlaceholder('Carte, n° opération, description…').fill('4000');
    await m.getByText(/Tout sélectionner/).click();
    await m.getByRole('button', { name: /^Négocier/ }).click();
    await p.waitForTimeout(1500);
  });
  expected.bank[bank.id] -= 1500;
  expected.carburantCash += 1500;

  // ── S7. Le client règle le reste de sa facture en espèces ─────────────────
  const rest = r2(ttc - 500);
  await step(`Règlement client ${rest} DA en espèces`, async () => {
    await go(p, '/clients');
    const card = p.locator('tr', { hasText: client.name.toUpperCase() }).first();
    await card.getByRole('button', { name: /PAYER/i }).click();
    await p.waitForTimeout(700);
    const m = modal(p);
    const amt = m.locator('input[type=number]').first();
    await amt.fill(String(rest));
    await m.getByRole('button', { name: /Valider|Enregistrer|Confirmer/i }).last().click();
    await p.waitForTimeout(1500);
  });
  expected.carburantCash += rest;
  expected.clientDebt[client.id] -= rest;

  // ── S8–S10. Facture payée par virement, modifiée, puis supprimée ─────────
  //   Tout doit revenir EXACTEMENT au point de départ (stock, banque, client).
  await step('Facture 5 L payée par virement', async () => {
    await go(p, '/ventes-carburant');
    await p.getByRole('button', { name: /Nouvelle vente/i }).first().click();
    const m = modal(p);
    await m.getByPlaceholder('Nom, téléphone, CIN, NIF…').fill(client.name);
    await m.locator('button:has(span.block)', { hasText: client.name }).first().click();
    await m.locator('.grid.max-h-56 button', { hasText: tank1.name }).first().click();
    await m.locator('tbody input[type=number]').first().fill('5');
    await m.getByRole('button', { name: /^Virement$/ }).click();
    await m.getByRole('button', { name: /Enregistrer —/ }).click();
    await p.waitForTimeout(1200);
  });
  await step('Modification de la facture : 5 L → 8 L', async () => {
    await p.locator('tbody tr').first().locator('button[title="Modifier"]').click();
    await p.waitForTimeout(600);
    const m = modal(p);
    await m.locator('tbody input[type=number]').first().fill('8');
    await m.getByRole('button', { name: /Enregistrer —/ }).click();
    await p.waitForTimeout(1200);
  });
  await step('Suppression de la facture (stock et banque rendus)', async () => {
    await p.locator('tbody tr').first().locator('button[title="Supprimer"]').click();
    await p.waitForTimeout(400);
    await p.locator('.modal-shell').last().getByRole('button', { name: /^Supprimer$/ }).click();
    await p.waitForTimeout(1200);
  });

  // ── S11. Dépôt 2 000 dans la caisse Cafétéria ─────────────────────────────
  await step('Dépôt 2 000 DA — Cafétéria', async () => {
    await go(p, '/caisse-generale');
    await p.getByRole('button', { name: /DÉPÔT \/ RETRAIT|Dépôt \/ Retrait/ }).first().click();
    const m = modal(p);
    await m.getByRole('button', { name: /Dépôt \(entrée\)/ }).click();
    await m.locator('input[type=number]').first().fill('2000');
    await m.locator('select').first().selectOption({ label: 'Cafétéria' });
    await m.getByPlaceholder("Motif de l'opération").fill('Audit dépôt cafétéria');
    await m.getByRole('button', { name: /^Valider$/ }).click();
    await p.waitForTimeout(1200);
  });
  expected.partCash = { cafeteria: 2000 };

  // ── S12. Cafétéria : vente au point de vente (2 × Café express, payé) ──────
  const caf = (await p.evaluate(() => globalThis.__ALTECH_BIZ_STATE__)).cafeteria;
  const coffee = (caf.products || []).find(x => x.name === 'Café express');
  if (coffee) {
    await step(`Cafétéria : vente 2 × ${coffee.name} (${2 * coffee.salePrice} DA)`, async () => {
      await go(p, '/cafeteria/pos');
      await p.getByRole('button', { name: /Ouvrir ma session/i }).first().click();
      const m = modal(p);
      await m.getByPlaceholder("Nom d'utilisateur de l'employé").fill('Audit');
      await m.getByRole('button', { name: /^Ouvrir la session$/ }).click();
      await p.waitForTimeout(800);
      const card = p.locator('main').getByText(coffee.name, { exact: true }).first();
      await card.click(); await p.waitForTimeout(200); await card.click();
      await p.waitForTimeout(300);
      await p.getByRole('button', { name: /Valider la vente/i }).click();
      await p.waitForTimeout(1500);
      const close = p.getByRole('button', { name: /^Non$|Ne pas imprimer|Fermer|Plus tard/i });
      if (await close.count()) await close.first().click().catch(() => {});
    });
    expected.partCash.cafeteria += 2 * coffee.salePrice;
    expected.moduleSales = { cafeteria: 2 * coffee.salePrice };
    expected.moduleStock = { cafeteria: { [coffee.id]: -2 } };
  }
  return expected;
}

/** Lit à l'écran le montant affiché à côté d'un libellé (carte, KPI…). */
async function screenValue(p, label) {
  return p.evaluate((label) => {
    const norm = t => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const parse = t => {
      const m = (t || '').replace(/[\u00a0\u202f\s]/g, '').match(/-?[\d.]+(,\d+)?(?=DA|DZD|$)/);
      return m ? Number(m[0].replace(/\./g, '').replace(',', '.')) : NaN;
    };
    const els = [...document.querySelectorAll('span,p,h3,h4,div')].filter(e => norm(e.textContent) === norm(label));
    for (const el of els) {
      let node = el;
      for (let up = 0; up < 4 && node; up++, node = node.parentElement) {
        const cands = [...node.querySelectorAll('p')].filter(x => x !== el && /\d/.test(x.textContent || '') && /DA\s*$/.test((x.textContent || '').trim()));
        if (cands.length) return parse(cands[0].textContent);
      }
    }
    return NaN;
  }, label);
}

async function readScreens(p) {
  const out = {};
  await go(p, '/caisse-generale');
  out.cgTresorerie = await screenValue(p, 'Trésorerie totale');
  out.cgSolde = await screenValue(p, 'Solde caisse générale');
  await go(p, '/general-reports');
  out.grTresorerie = await screenValue(p, 'Trésorerie');
  await go(p, '/reports');
  await p.getByText('Cette année').click();
  await p.getByRole('button', { name: /Générer le rapport/ }).click();
  await p.waitForTimeout(800);
  out.rcVentes = await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('Ventes carburant'));
    const t = b?.querySelector('p.text-xl')?.textContent || '';
    return Number(t.replace(/[\u00a0\u202f\s]/g, '').replace('DA', '').replace(/\./g, '').replace(',', '.'));
  });
  return out;
}
module.exports.readScreens = readScreens;

module.exports = { run };
module.exports.run = run;

if (require.main === module) {
  (async () => {
    const b = await chromium.launch();
    const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    await login(p);
    await dump(p, path.join(DIR, 'before.json'));
    const expected = { carburantCash: 0, financeCash: 0, bank: {}, clientDebt: {}, tank: {}, supplierDebt: 0, expenses: 0, invoices: 0, purchases: 0, tpe: 0 };
    try { await run(p, expected); }
    catch (e) { console.log('\nÉCHEC du scénario :', e.message.split('\n')[0]); await p.screenshot({ path: path.join(DIR, 'scenario-error.png') }); process.exitCode = 1; }
    await p.waitForTimeout(1500);
    await dump(p, path.join(DIR, 'after.json'));
    // Rechargement complet : tout ce qui est affiché doit avoir été ENREGISTRÉ.
    await p.reload();
    await p.waitForFunction(() => {
      const s = globalThis.__ALTECH_APP_STATE__;
      return s && !s.isLoading && (s.brigadeAccountings || []).length > 0 && (s.purchases || []).length > 0;
    }, null, { timeout: 30000 });
    await p.waitForTimeout(2500);
    await dump(p, path.join(DIR, 'reloaded.json'));
    try { fs.writeFileSync(path.join(DIR, 'screens.json'), JSON.stringify(await readScreens(p), null, 2)); }
    catch (e) { console.log('Lecture des écrans impossible :', e.message.split('\n')[0]); process.exitCode = 1; }
    fs.writeFileSync(path.join(DIR, 'expected.json'), JSON.stringify(expected, null, 2));
    if (errors.length) { console.log('Erreurs de page :\n' + errors.join('\n')); process.exitCode = 1; }
    await b.close();
  })();
}
