-- =====================================================================================
--  MIGRATION 2026-10-08 — Brigades : produits vendus / achetés DIRECTEMENT en magasin,
--                          pompes partagées, et gestion des tables (Restaurant / Cafétéria)
--
--  À exécuter UNE FOIS : Supabase → SQL Editor → New query → coller → Run.
--  IDEMPOTENT : le relancer ne casse rien.
--
--  1. brigades.magasin_product_moves (jsonb)
--       Ventes et achats de produits saisis dans la comptabilité d'une brigade avec,
--       pour source, un MAGASIN (et non une armoire). Le stock du magasin est
--       décrémenté (vente) / incrémenté (achat) ; bouteilles de gaz : vente = plein → vide,
--       remplissage = vide → plein, achat de vides = +total +vides.
--       Chaque ligne : { kind: 'VENTE'|'ACHAT', moduleKey, pompisteId, productId,
--                        productName, quantity, price, total, unitCost?, consigne?,
--                        consigneMode?, supplierName? }
--  2. brigade_accounting_justifications.module_key / consigne_mode (rappel)
--       Un justificatif ACHAT_PRODUIT rangé en magasin n'a pas d'armoire : c'est
--       module_key qui dit quel magasin a reçu la marchandise.
--  3. Pompes partagées entre plusieurs pompistes : AUCUNE colonne nouvelle —
--       brigades.pompiste_pump_assignments accepte déjà la même pompe pour plusieurs
--       pompistes (les litres sont répartis à parts égales).
--  4. Gestion des tables : les tables et les commandes de table vivent dans l'état des
--       parties (biz_store, collections `tables` et `tableOrders`), comme les ventes :
--       AUCUNE table SQL à créer.
-- =====================================================================================

begin;

alter table public.brigades
  add column if not exists magasin_product_moves jsonb not null default '[]'::jsonb;

comment on column public.brigades.magasin_product_moves is
  'Ventes / achats de produits faits directement sur le stock d''un magasin pendant la brigade (VENTE | ACHAT, bouteilles de gaz comprises).';

alter table public.brigade_accounting_justifications
  add column if not exists module_key    text,
  add column if not exists consigne_mode text;

grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

commit;

-- Recharge le cache de schéma de PostgREST (nouvelle colonne visible tout de suite).
notify pgrst, 'reload schema';
