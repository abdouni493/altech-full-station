/**
 * ─── LES IMPORTS DU DOSSIER `api/` DOIVENT PORTER LEUR EXTENSION ───────────────
 *
 * Ce projet est en `"type": "module"` (voir `package.json`). Le résolveur ESM de
 * Node — celui qui charge la fonction chez l'hébergeur — n'invente PAS
 * l'extension d'un import relatif : `import … from './env'` échoue en
 * `ERR_MODULE_NOT_FOUND`, là où `./env.js` fonctionne.
 *
 * Le défaut est invisible partout où l'on travaille :
 *
 *   • `tsx`, qui sert le poste de développement, résout l'extension tout seul ;
 *   • `vite`, qui construit l'application, aussi ;
 *   • `tsc --noEmit` ne dit rien : en `moduleResolution: "bundler"`, les deux
 *     écritures sont valides ;
 *   • et un `esbuild --bundle` local inline tout, donc rien ne casse non plus.
 *
 * Il ne se voit QU'EN PRODUCTION, où il coûte cher : la fonction s'écroule au
 * chargement, l'hébergeur rend une page d'erreur en texte brut, et l'écran de
 * réglages — qui attendait du JSON — annonce que la route n'est pas déployée.
 * On cherche alors le défaut dans les variables d'environnement et dans le
 * déploiement, c'est-à-dire partout sauf là où il est.
 *
 * Ce cas relit donc les imports plutôt que le comportement : c'est la seule
 * façon de rattraper une faute qu'aucun outil de développement ne signale.
 *
 *   npx tsx api/_lib/imports.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

let passed = 0, failed = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); }
};

/** Tous les fichiers TypeScript atteignables depuis un dossier. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full);
  }
  return out;
}

/** Les imports RELATIFS d'un fichier — les seuls que Node doit résoudre lui-même. */
function relativeImports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  // `import … from '…'`, `export … from '…'` et `import('…')`.
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.[^'"]*)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

console.log('\nLes imports relatifs du serveur portent leur extension');
{
  // `server.ts` fait partie du même graphe : il importe le routeur, qui importe
  // tout le reste. Une extension manquante chez lui casserait le poste de
  // développement dès qu'il cesserait de passer par `tsx`.
  const files = [...walk('api'), 'server.ts'];
  check('des fichiers à vérifier ont bien été trouvés', files.length >= 5, `${files.length} fichier(s)`);

  const faults: string[] = [];
  for (const file of files) {
    for (const spec of relativeImports(file)) {
      // Un dossier (`./x/`) ou un fichier déjà suffixé passent ; tout le reste
      // est une extension oubliée.
      if (!/\.(js|mjs|cjs|json|node)$/.test(spec)) {
        faults.push(`${file.replace(/\\/g, '/')} → '${spec}'`);
      }
    }
  }
  check('aucun import relatif sans extension', faults.length === 0,
    faults.length ? `Node ESM ne les résoudra pas :\n      ${faults.join('\n      ')}` : undefined);
}

console.log('\nCe que les imports doivent désigner existe vraiment');
{
  // Une extension `.js` qui ne correspond à aucun `.ts` sur le disque est une
  // faute de frappe : elle passerait ce contrôle et casserait au déploiement.
  const files = [...walk('api'), 'server.ts'];
  const missing: string[] = [];
  for (const file of files) {
    const dir = file.includes('/') || file.includes('\\')
      ? file.replace(/[/\\][^/\\]+$/, '')
      : '.';
    for (const spec of relativeImports(file)) {
      if (!/\.js$/.test(spec)) continue;
      const asTs = join(dir, spec.replace(/\.js$/, '.ts'));
      const asJs = join(dir, spec);
      let ok = false;
      try { statSync(asTs); ok = true; } catch { /* essayons le .js */ }
      if (!ok) { try { statSync(asJs); ok = true; } catch { /* absent */ } }
      if (!ok) missing.push(`${file.replace(/\\/g, '/')} → '${spec}'`);
    }
  }
  check('chaque import pointe un fichier présent', missing.length === 0,
    missing.length ? missing.join('\n      ') : undefined);
}

console.log(`\n${passed} vérification(s) passée(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
