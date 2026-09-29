-- ═══════════════════════════════════════════════════════════════════════════════
--  REMISE EN PLACE DES COMPTEURS DE PISTOLETS  —  26 août 2026 (2e passage)
-- ═══════════════════════════════════════════════════════════════════════════════
--
--  CE QUI S'EST PASSÉ
--  ------------------
--  Rouvrir une brigade ANCIENNE recopiait ses index de fin dans
--  `pump_nozzles.last_index` — le compteur qui sert d'index de DÉPART à la
--  brigade suivante. Les vingt pistolets ont donc RECULÉ sur les index de ce
--  jour-là, et toute brigade saisie ensuite repartait d'un compteur du passé.
--
--  Le premier passage (`2026-08-26_restore_nozzle_last_index.sql`) reposait les
--  index de la brigade de référence d'alors. Ce script fait le même travail avec
--  les index de fin de la DERNIÈRE brigade en date :
--
--      POMPE 1          Benahmed cheker   11 513.96 L   477 477,72 DA
--      POMPE 2          Benkhouta hamza   13 396.98 L   543 100,78 DA
--      POMPE 3 + 4 L.   Benoua farid      10 603.15 L   405 600,85 DA
--
--  CE QUE CE SCRIPT TOUCHE
--  -----------------------
--  UNIQUEMENT `public.pump_nozzles.last_index`, pour les 20 pistolets listés.
--  Rien d'autre : ni `pumps.last_index`, ni `pump_nozzles.start_index`, ni les
--  cuves, ni les brigades, ni la comptabilité. Seuls les index de FIN sont
--  reposés — aucun index de début n'est touché.
--
--  COMMENT L'EXÉCUTER
--  ------------------
--  Supabase → SQL Editor. §0 et §1 ne font que LIRE : ils montrent l'écart et
--  ce que la règle de l'application calcule de son côté. §2 corrige, en une
--  transaction tout-ou-rien. §3 vérifie.
--
--  Le bouton « CORRIGER LES INDEX » de l'écran Brigades fait exactement le même
--  travail depuis l'application ; ce script est là pour le faire sans elle.
-- ═══════════════════════════════════════════════════════════════════════════════


-- ─── §0 · CE QUE DIT LA DERNIÈRE BRIGADE (lecture seule) ──────────────────────
--  La même règle que `lib/nozzleIndexes.ts` : pour chaque pistolet, l'index de
--  FIN relevé par la dernière brigade qui l'a relevé. À comparer avec les
--  valeurs posées en §2 — les deux doivent coïncider.

select
  p.name                                    as pompe,
  n.name                                    as pistolet,
  n.last_index                              as index_actuel,
  d.index_fin                               as index_derniere_brigade,
  round(d.index_fin - n.last_index, 2)      as ecart,
  d.brigade_date,
  d.brigade_id
from public.pump_nozzles n
join public.pumps p on p.id = n.pump_id
left join lateral (
  select
    (b.end_nozzle_indices ->> n.id)::numeric as index_fin,
    b.date                                   as brigade_date,
    b.id                                     as brigade_id
  from public.brigades b
  where jsonb_exists(b.end_nozzle_indices, n.id)
    and (b.end_nozzle_indices ->> n.id) ~ '^-?[0-9]+(\.[0-9]+)?$'
  order by b.created_at desc nulls last, b.end_datetime desc nulls last
  limit 1
) d on true
where coalesce(n.status, 'Actif') = 'Actif'
order by p.name, n.name;


-- ─── §1 · CONTRÔLE AVANT ──────────────────────────────────────────────────────
--  Ce que porte chaque pistolet aujourd'hui, face à la valeur attendue.
--  `ecart` négatif = le compteur a reculé. Vérifier que les 20 lignes sortent
--  et qu'aucune n'a de `nozzle_id` vide (sinon un nom de pompe ou de pistolet
--  ne correspond pas — corriger la liste avant de lancer §2).

with cible(pompe, pistolet, index_fin) as (
  values
    ('POMPE 1',       'A1', 2985239.60::numeric),
    ('POMPE 1',       'A3', 2326342.79::numeric),
    ('POMPE 1',       'A4', 3965437.38::numeric),
    ('POMPE 1',       'B1', 5932192.05::numeric),
    ('POMPE 1',       'B3', 2962983.77::numeric),
    ('POMPE 1',       'B4', 4748303.20::numeric),
    ('POMPE 2',       'A1', 3880037.37::numeric),
    ('POMPE 2',       'A3', 2036178.59::numeric),
    ('POMPE 2',       'A4', 5042625.00::numeric),
    ('POMPE 2',       'B1', 6693011.43::numeric),
    ('POMPE 2',       'B3', 3152826.46::numeric),
    ('POMPE 2',       'B4', 5709010.06::numeric),
    ('POMPE 3',       'A1', 2790073.42::numeric),
    ('POMPE 3',       'A3', 1726254.36::numeric),
    ('POMPE 3',       'A4', 5421550.39::numeric),
    ('POMPE 3',       'B1', 4571564.13::numeric),
    ('POMPE 3',       'B3', 2736960.86::numeric),
    ('POMPE 3',       'B4', 5670660.14::numeric),
    ('POMPE 4 LOURD', 'A1', 4393030.35::numeric),
    ('POMPE 4 LOURD', 'B1', 5405664.53::numeric)
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
  ('POMPE 1',       'A1', 2985239.60),
  ('POMPE 1',       'A3', 2326342.79),
  ('POMPE 1',       'A4', 3965437.38),
  ('POMPE 1',       'B1', 5932192.05),
  ('POMPE 1',       'B3', 2962983.77),
  ('POMPE 1',       'B4', 4748303.20),
  ('POMPE 2',       'A1', 3880037.37),
  ('POMPE 2',       'A3', 2036178.59),
  ('POMPE 2',       'A4', 5042625.00),
  ('POMPE 2',       'B1', 6693011.43),
  ('POMPE 2',       'B3', 3152826.46),
  ('POMPE 2',       'B4', 5709010.06),
  ('POMPE 3',       'A1', 2790073.42),
  ('POMPE 3',       'A3', 1726254.36),
  ('POMPE 3',       'A4', 5421550.39),
  ('POMPE 3',       'B1', 4571564.13),
  ('POMPE 3',       'B3', 2736960.86),
  ('POMPE 3',       'B4', 5670660.14),
  ('POMPE 4 LOURD', 'A1', 4393030.35),
  ('POMPE 4 LOURD', 'B1', 5405664.53);

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
    ('POMPE 1',       'A1', 2985239.60::numeric),
    ('POMPE 1',       'A3', 2326342.79::numeric),
    ('POMPE 1',       'A4', 3965437.38::numeric),
    ('POMPE 1',       'B1', 5932192.05::numeric),
    ('POMPE 1',       'B3', 2962983.77::numeric),
    ('POMPE 1',       'B4', 4748303.20::numeric),
    ('POMPE 2',       'A1', 3880037.37::numeric),
    ('POMPE 2',       'A3', 2036178.59::numeric),
    ('POMPE 2',       'A4', 5042625.00::numeric),
    ('POMPE 2',       'B1', 6693011.43::numeric),
    ('POMPE 2',       'B3', 3152826.46::numeric),
    ('POMPE 2',       'B4', 5709010.06::numeric),
    ('POMPE 3',       'A1', 2790073.42::numeric),
    ('POMPE 3',       'A3', 1726254.36::numeric),
    ('POMPE 3',       'A4', 5421550.39::numeric),
    ('POMPE 3',       'B1', 4571564.13::numeric),
    ('POMPE 3',       'B3', 2736960.86::numeric),
    ('POMPE 3',       'B4', 5670660.14::numeric),
    ('POMPE 4 LOURD', 'A1', 4393030.35::numeric),
    ('POMPE 4 LOURD', 'B1', 5405664.53::numeric)
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
