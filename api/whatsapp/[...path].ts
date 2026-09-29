/**
 * ─── ADAPTATEUR HÉBERGEUR ──────────────────────────────────────────────────────
 *
 * Une SEULE fonction serverless couvre `/api/whatsapp/*`. Ce fichier ne contient
 * aucune règle : il traduit la requête de l'hébergeur vers `handleWhatsApp`, qui
 * porte les routes — les mêmes que celles servies par `server.ts` en
 * développement. Voir `api/_lib/router.ts`.
 *
 * L'équivalent pour le poste de développement est dans `server.ts`.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { handleWhatsApp } from '../_lib/router.js';

/**
 * ─── QUEL CHEMIN A ÉTÉ DEMANDÉ ────────────────────────────────────────────────
 *
 * On lisait `req.query.path`, le paramètre que l'hébergeur est censé extraire du
 * nom de fichier `[...path]`. Il arrive VIDE en production : la fonction est
 * bien invoquée pour `/api/whatsapp/status`, mais le segment n'est pas injecté,
 * et toutes les routes tombaient donc sur « Route inconnue : /api/whatsapp/ ».
 *
 * L'URL, elle, est toujours là — c'est la requête elle-même. On la lit d'abord
 * et le paramètre ne sert plus que de repli : l'adaptateur cesse ainsi de
 * dépendre d'une convention de l'hébergeur pour savoir ce qu'on lui demande.
 */
export function routePath(req: { url?: string; query?: any }): string {
  const url = String(req?.url || '').split('?')[0];
  const m = url.match(/\/api\/whatsapp\/?(.*)$/);
  // Un segment non résolu (`[...path]`) veut dire que l'URL porte encore le nom
  // du fichier : elle ne dit alors rien, et c'est au paramètre de parler.
  const fromUrl = m && !m[1].includes('[') ? m[1] : '';
  if (fromUrl) return fromUrl;

  const raw = req?.query?.path;
  return Array.isArray(raw) ? raw.join('/') : String(raw || '');
}

export default async function handler(req: any, res: any) {
  const path = routePath(req);

  // Le corps arrive déjà analysé chez l'hébergeur ; on tolère la chaîne brute
  // pour ne pas dépendre de ce comportement.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const out = await handleWhatsApp({
    path,
    method: req.method || 'GET',
    body: body || {},
    headers: req.headers || {},
    host: String(req.headers?.['x-forwarded-host'] || req.headers?.host || ''),
    proto: String(req.headers?.['x-forwarded-proto'] || '') || undefined,
  });

  // Ces réponses ne se mettent jamais en cache : elles décrivent un état vivant.
  res.setHeader('Cache-Control', 'no-store');
  res.status(out.status).json(out.body);
}
