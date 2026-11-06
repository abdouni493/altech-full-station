/**
 * Environnement de test — prise d'un instantané de l'application RÉELLE.
 *
 *   node tests/audit/snapshot.cjs [url] [out.json]
 *
 * Ouvre l'application (mode démo), se connecte en administrateur, attend la fin
 * de l'hydratation puis écrit l'état complet (store principal + parties
 * commerciales) dans un fichier JSON lu par `audit.ts`.
 * Variable SCENARIO=1 : joue d'abord le scénario d'opérations (scenario.cjs).
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'snapshot.json');

async function login(p) {
  await p.goto(URL + '/');
  await p.waitForTimeout(1200);
  await p.getByText(/Connexion admin démo/i).first().click();
  await p.waitForFunction(() => {
    const s = globalThis.__ALTECH_APP_STATE__;
    return s && !s.isLoading && (s.brigadeAccountings || []).length > 0 && (s.purchases || []).length > 0;
  }, null, { timeout: 30000 });
  await p.waitForTimeout(1500);
}

async function dump(p, file) {
  const data = await p.evaluate(() => ({
    app: globalThis.__ALTECH_APP_STATE__,
    biz: globalThis.__ALTECH_BIZ_STATE__,
    takenAt: new Date().toISOString(),
  }));
  fs.writeFileSync(file, JSON.stringify(data));
  return data;
}

module.exports = { login, dump, URL };

if (require.main === module) {
  (async () => {
    const b = await chromium.launch();
    const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    await login(p);
    if (process.env.SCENARIO) await require('./scenario.cjs').run(p);
    const d = await dump(p, OUT);
    console.log(`Instantané écrit : ${OUT} (${(d.app.brigades || []).length} brigades)`);
    if (errors.length) { console.log('Erreurs de page :\n' + errors.join('\n')); process.exitCode = 1; }
    await b.close();
  })();
}
