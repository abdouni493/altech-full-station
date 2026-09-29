-- ═══════════════════════════════════════════════════════════════════════════════
--  REMISE EN PLACE DES COMPTEURS DE PISTOLETS  —  26 août 2026
-- ═══════════════════════════════════════════════════════════════════════════════
--
--  CE QUI S'EST PASSÉ
--  ------------------
--  Rouvrir une brigade ANCIENNE pour corriger un versement recopiait ses index
--  de fin dans `pump_nozzles.last_index` — le compteur qui sert d'index de
--  DÉPART à la brigade suivante. Les vingt pistolets ont donc RECULÉ sur les
--  index de ce jour-là, et toute brigade saisie ensuite repartait d'un compteur
--  du passé.
--
--  La cause est corrigée dans l'application (`src/lib/nozzleIndexes.ts` : seule
--  la DERNIÈRE brigade à avoir relevé un pistolet déplace son compteur). Ce
--  script répare l'existant.
--
--  CE QUE CE SCRIPT TOUCHE
--  -----------------------
--  UNIQUEMENT `public.pump_nozzles.last_index`, pour les 20 pistolets listés.
--  Rien d'autre : ni `pumps.last_index`, ni `pump_nozzles.start_index`, ni les
--  cuves, ni les brigades, ni la comptabilité.
--
--  LES VALEURS
--  -----------
--  Les index de FIN relevés par la dernière brigade (POMPE 1 / 2 / 3 / 4 LOURD).
--
--  COMMENT L'EXÉCUTER
--  ------------------
--  Supabase → SQL Editor. Lancer §1 pour VOIR l'écart, puis §2 pour corriger,
--  puis §3 pour vérifier. §2 est une transaction : elle échoue en bloc si un
--  pistolet ne se retrouve pas, plutôt que d'en corriger la moitié.
-- ═══════════════════════════════════════════════════════════════════════════════


-- ─── §1 · CONTRÔLE AVANT ──────────────────────────────────────────────────────
--  Ce que porte chaque pistolet aujourd'hui, face à la valeur attendue.
--  `ecart` négatif = le compteur a reculé. Vérifier que les 20 lignes sortent
--  et qu'aucune n'a de `nozzle_id` vide.

with cible(pompe, pistolet, index_fin) as (
  values
    ('POMPE 1',       'A1', 2972319.02::numeric),
    ('POMPE 1',       'A3', 2323809.81::numeric),
    ('POMPE 1',       'A4', 3956835.56::numeric),
    ('POMPE 1',       'B1', 5911837.66::numeric),
    ('POMPE 1',       'B3', 2959822.93::numeric),
    ('POMPE 1',       'B4', 4736800.36::numeric),
    ('POMPE 2',       'A1', 3865430.77::numeric),
    ('POMPE 2',       'A3', 2035445.74::numeric),
    ('POMPE 2',       'A4', 5031755.81::numeric),
    ('POMPE 2',       'B1', 6674352.79::numeric),
    ('POMPE 2',       'B3', 3149090.31::numeric),
    ('POMPE 2',       'B4', 5695362.81::numeric),
    ('POMPE 3',       'A1', 2782649.86::numeric),
    ('POMPE 3',       'A3', 1723703.41::numeric),
    ('POMPE 3',       'A4', 5409919.17::numeric),
    ('POMPE 3',       'B1', 4560099.03::numeric),
    ('POMPE 3',       'B3', 2733627.41::numeric),
    ('POMPE 3',       'B4', 5658742.34::numeric),
    ('POMPE 4 LOURD', 'A1', 4390050.25::numeric),
    ('POMPE 4 LOURD', 'B1', 5401211.18::numeric)
)
select
  c.pompe,
  c.pistolet,
  n.id                       as nozzle_id,
  n.last_index               as index_actuel,
  c.index_fin                as index_attendu,
  c.index_fin - n.last_index as ecart
from cible c
left join public.pumps p
       on upper(btrim(coalesce(p.name, ''))) = c.pompe
       or upper(btrim(coalesce(p.number, ''))) = c.pompe
left join public.pump_nozzles n
       on n.pump_id = p.id
      and upper(btrim(coalesce(n.name, ''))) = c.pistolet
order by c.pompe, c.pistolet;


-- ─── §2 · CORRECTION ──────────────────────────────────────────────────────────
--  Tout ou rien. Un pistolet introuvable ou un nom de pompe en double arrête la
--  transaction : on ne laisse pas la station à moitié corrigée.

begin;

create temporary table _idx_cible(pompe text, pistolet text, index_fin numeric) on commit drop;

insert into _idx_cible values
  ('POMPE 1',       'A1', 2972319.02),
  ('POMPE 1',       'A3', 2323809.81),
  ('POMPE 1',       'A4', 3956835.56),
  ('POMPE 1',       'B1', 5911837.66),
  ('POMPE 1',       'B3', 2959822.93),
  ('POMPE 1',       'B4', 4736800.36),
  ('POMPE 2',       'A1', 3865430.77),
  ('POMPE 2',       'A3', 2035445.74),
  ('POMPE 2',       'A4', 5031755.81),
  ('POMPE 2',       'B1', 6674352.79),
  ('POMPE 2',       'B3', 3149090.31),
  ('POMPE 2',       'B4', 5695362.81),
  ('POMPE 3',       'A1', 2782649.86),
  ('POMPE 3',       'A3', 1723703.41),
  ('POMPE 3',       'A4', 5409919.17),
  ('POMPE 3',       'B1', 4560099.03),
  ('POMPE 3',       'B3', 2733627.41),
  ('POMPE 3',       'B4', 5658742.34),
  ('POMPE 4 LOURD', 'A1', 4390050.25),
  ('POMPE 4 LOURD', 'B1', 5401211.18);

create temporary table _idx_resolu on commit drop as
select c.pompe, c.pistolet, c.index_fin, n.id as nozzle_id, n.last_index as ancien
from _idx_cible c
join public.pumps p
  on upper(btrim(coalesce(p.name, ''))) = c.pompe
  or upper(btrim(coalesce(p.number, ''))) = c.pompe
join public.pump_nozzles n
  on n.pump_id = p.id
 and upper(btrim(coalesce(n.name, ''))) = c.pistolet;

do $$
declare
  v_manquants int;
  v_ambigus   int;
begin
  select count(*) into v_manquants
    from _idx_cible c
   where not exists (select 1 from _idx_resolu r
                      where r.pompe = c.pompe and r.pistolet = c.pistolet);
  if v_manquants > 0 then
    raise exception
      '% pistolet(s) introuvable(s) — verifier les noms de pompes/pistolets avec le paragraphe 1. Rien n a ete modifie.',
      v_manquants;
  end if;

  select count(*) into v_ambigus
    from (select pompe, pistolet from _idx_resolu group by 1, 2 having count(*) > 1) x;
  if v_ambigus > 0 then
    raise exception
      '% pistolet(s) correspondent a plusieurs lignes (nom de pompe en double). Rien n a ete modifie.',
      v_ambigus;
  end if;
end $$;

update public.pump_nozzles n
   set last_index = r.index_fin
  from _idx_resolu r
 where n.id = r.nozzle_id
   and n.last_index is distinct from r.index_fin;

commit;


-- ─── §3 · CONTRÔLE APRÈS ──────────────────────────────────────────────────────
--  Chaque ligne doit afficher `conforme = true`.

with cible(pompe, pistolet, index_fin) as (
  values
    ('POMPE 1',       'A1', 2972319.02::numeric),
    ('POMPE 1',       'A3', 2323809.81::numeric),
    ('POMPE 1',       'A4', 3956835.56::numeric),
    ('POMPE 1',       'B1', 5911837.66::numeric),
    ('POMPE 1',       'B3', 2959822.93::numeric),
    ('POMPE 1',       'B4', 4736800.36::numeric),
    ('POMPE 2',       'A1', 3865430.77::numeric),
    ('POMPE 2',       'A3', 2035445.74::numeric),
    ('POMPE 2',       'A4', 5031755.81::numeric),
    ('POMPE 2',       'B1', 6674352.79::numeric),
    ('POMPE 2',       'B3', 3149090.31::numeric),
    ('POMPE 2',       'B4', 5695362.81::numeric),
    ('POMPE 3',       'A1', 2782649.86::numeric),
    ('POMPE 3',       'A3', 1723703.41::numeric),
    ('POMPE 3',       'A4', 5409919.17::numeric),
    ('POMPE 3',       'B1', 4560099.03::numeric),
    ('POMPE 3',       'B3', 2733627.41::numeric),
    ('POMPE 3',       'B4', 5658742.34::numeric),
    ('POMPE 4 LOURD', 'A1', 4390050.25::numeric),
    ('POMPE 4 LOURD', 'B1', 5401211.18::numeric)
)
select
  c.pompe,
  c.pistolet,
  n.last_index,
  c.index_fin,
  (n.last_index = c.index_fin) as conforme
from cible c
join public.pumps p
  on upper(btrim(coalesce(p.name, ''))) = c.pompe
  or upper(btrim(coalesce(p.number, ''))) = c.pompe
join public.pump_nozzles n
  on n.pump_id = p.id
 and upper(btrim(coalesce(n.name, ''))) = c.pistolet
order by c.pompe, c.pistolet;
