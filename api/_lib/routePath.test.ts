/**
 * ─── LE CHEMIN DEMANDÉ, QUELLE QUE SOIT LA FORME DE LA REQUÊTE ────────────────
 *
 * L'adaptateur lisait `req.query.path` — le paramètre que l'hébergeur est censé
 * extraire du nom de fichier `[...path]`. En production il arrive VIDE : la
 * fonction est bien invoquée pour `/api/whatsapp/status`, mais le segment n'est
 * pas injecté. Toutes les routes tombaient donc sur la même réponse :
 *
 *     404  { "error": "Route inconnue : /api/whatsapp/" }
 *
 * Un défaut invisible en développement, où `server.ts` découpe l'URL lui-même et
 * n'a jamais eu besoin du paramètre.
 *
 * Ces cas figent la lecture du chemin sous les DEUX conventions — celle de
 * l'hébergeur et l'URL brute — pour qu'aucune des deux ne puisse à elle seule
 * faire disparaître toutes les routes.
 *
 * Il vit sous `_lib/` — et non à côté du fichier qu'il éprouve — parce que tout
 * ce que `api/` contient hors des dossiers en `_` est publié comme fonction :
 * un fichier de test y deviendrait une route accessible à tous.
 *
 *   npx tsx api/_lib/routePath.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { routePath } from '../whatsapp/[...path].js';

let passed = 0, failed = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}\n      attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`); }
};
const section = (t: string) => console.log(`\n${t}`);

section("L'URL suffit — c'est le cas observé en production");
{
  // Le paramètre est absent : c'est exactement ce qui cassait toutes les routes.
  check('une route simple', routePath({ url: '/api/whatsapp/status' }), 'status');
  check('une route à deux segments', routePath({ url: '/api/whatsapp/outbox/flush' }), 'outbox/flush');
  check('la chaîne de requête est écartée', routePath({ url: '/api/whatsapp/status?t=1' }), 'status');
  check('le webhook', routePath({ url: '/api/whatsapp/webhook' }), 'webhook');
}

section('Le paramètre de route reste honoré quand il est fourni');
{
  check('un tableau de segments', routePath({ url: '', query: { path: ['outbox', 'flush'] } }), 'outbox/flush');
  check('une chaîne unique', routePath({ url: '', query: { path: 'status' } }), 'status');
  // L'URL n'a plus que le nom du fichier : elle ne dit rien, le paramètre parle.
  check("une URL non résolue laisse la main au paramètre",
    routePath({ url: '/api/whatsapp/[...path]', query: { path: ['status'] } }), 'status');
}

section("Les deux d'accord, et les cas dégénérés");
{
  check("l'URL prime, les deux disent la même chose",
    routePath({ url: '/api/whatsapp/status', query: { path: ['status'] } }), 'status');
  check('une requête sans rien ne prétend pas connaître de route', routePath({}), '');
  check('une URL hors du préfixe ne rend rien', routePath({ url: '/api/autre/chose' }), '');
  check('la racine du préfixe est vide, et le dit', routePath({ url: '/api/whatsapp' }), '');
  check('la racine avec slash aussi', routePath({ url: '/api/whatsapp/' }), '');
}

console.log(`\n${passed} vérification(s) passée(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
