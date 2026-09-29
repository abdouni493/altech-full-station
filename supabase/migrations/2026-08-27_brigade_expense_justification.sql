-- ============================================================
-- StationPro — Justification « Dépense » de brigade
-- ------------------------------------------------------------
-- La comptabilité de brigade peut désormais justifier le reste
-- par une DÉPENSE (nom + montant, description facultative) au
-- lieu d'un bon client. Une dépense n'a ni client ni compte
-- bancaire : elle est stockée dans la table existante des
-- justifications, avec :
--   justification_type = 'EXPENSE'
--   client_name        = le nom de la dépense
--   notes              = la description (facultative)
--   amount             = le montant
--
-- Aucune nouvelle colonne n'est nécessaire : ce script est
-- DÉFENSIF et IDEMPOTENT. Il s'assure simplement que le schéma
-- accepte ces lignes (colonnes présentes, client_id nullable,
-- pas de contrainte CHECK bloquant la valeur 'EXPENSE').
-- Sans risque à réexécuter. À lancer une fois dans
-- Supabase → Database → SQL Editor.
-- ============================================================

-- 1) client_id doit pouvoir être NULL (une dépense n'a pas de client).
ALTER TABLE public.brigade_accounting_justifications
  ALTER COLUMN client_id DROP NOT NULL;

-- 2) Colonnes utilisées par la dépense — créées si absentes.
ALTER TABLE public.brigade_accounting_justifications
  ADD COLUMN IF NOT EXISTS justification_type text NOT NULL DEFAULT 'CLIENT',
  ADD COLUMN IF NOT EXISTS client_name        text,
  ADD COLUMN IF NOT EXISTS notes              text;

-- 3) Si une contrainte CHECK limitait justification_type aux seules
--    valeurs CLIENT/TAG/TPE, on la remplace pour autoriser EXPENSE.
--    (Aucune contrainte de ce type n'existe par défaut ; ce bloc ne
--    fait quelque chose que si vous en aviez ajouté une à la main.)
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'brigade_accounting_justifications'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%justification_type%'
      AND pg_get_constraintdef(con.oid) NOT ILIKE '%EXPENSE%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.brigade_accounting_justifications DROP CONSTRAINT %I',
      c.conname);
  END LOOP;
END $$;
