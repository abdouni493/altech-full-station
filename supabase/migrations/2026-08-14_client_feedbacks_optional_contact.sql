-- =====================================================================================
--  altech station — Migration « RETOURS CLIENTS : NOM ET TÉLÉPHONE FACULTATIFS »
--
--  HOW TO RUN
--    Supabase → SQL Editor → New query → coller CE fichier entier → Run.
--    Le script est IDEMPOTENT : il peut être relancé sans risque.
--    À passer APRÈS supabase/migrations/2026-08-14_client_feedbacks.sql.
--
--  POURQUOI
--    La première version exigeait le nom ET le téléphone pour déposer un avis.
--    Sur le terrain, ça bloque net le client pressé ou celui qui ne veut pas se
--    nommer — et un reproche anonyme reste un reproche utile. Les deux champs
--    deviennent donc FACULTATIFS : seul le message (et la partie visée) est
--    obligatoire. Le client qui veut être rappelé laisse ses coordonnées, les
--    autres parlent librement.
--
--  CE QUE FAIT CE SCRIPT
--    1.  full_name et phone deviennent nullables.
--    2.  Les contraintes de longueur sont rejouées en version « null accepté » :
--        elles ne servent plus qu'à empêcher un champ démesuré, plus à exiger
--        une saisie. Le minimum de plausibilité (2 caractères pour un nom,
--        4 chiffres pour un numéro) est vérifié côté page publique, où l'on peut
--        afficher un message clair plutôt qu'une violation de contrainte.
--    3.  Le déclencheur d'insertion transforme un champ vide (« », «   ») en
--        NULL : sans ça, la page enverrait des chaînes vides que l'écran interne
--        afficherait comme un nom manquant mais présent.
--
--  CE QUE ÇA NE CHANGE PAS
--    Les avis déjà déposés gardent leur nom et leur téléphone. Les règles RLS,
--    le statut « non lu » forcé à l'insertion et la publication temps réel
--    restent exactement ce qu'ils étaient.
-- =====================================================================================

-- =====================================================================================
--  1. LES DEUX COLONNES DEVIENNENT FACULTATIVES
--
--     Les contraintes d'origine sont anonymes (déclarées en ligne dans le CREATE
--     TABLE), donc leur nom est celui qu'a choisi PostgreSQL. On les retrouve par
--     leur définition plutôt que de parier sur ce nom — et ce balayage reprend
--     aussi les contraintes nommées ci-dessous, ce qui rend le script rejouable.
-- =====================================================================================

do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class     rel on rel.oid = con.conrelid
      join pg_namespace ns  on ns.oid  = rel.relnamespace
     where ns.nspname = 'public'
       and rel.relname = 'client_feedbacks'
       and con.contype = 'c'
       and (pg_get_constraintdef(con.oid) ilike '%full_name%'
         or pg_get_constraintdef(con.oid) ilike '%phone%')
  loop
    execute format('alter table public.client_feedbacks drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.client_feedbacks alter column full_name drop not null;
alter table public.client_feedbacks alter column phone     drop not null;

alter table public.client_feedbacks
  add constraint client_feedbacks_full_name_len
  check (full_name is null or length(btrim(full_name)) between 1 and 120);

alter table public.client_feedbacks
  add constraint client_feedbacks_phone_len
  check (phone is null or length(btrim(phone)) between 1 and 40);

comment on column public.client_feedbacks.full_name is
  'Facultatif : NULL quand le client dépose son avis sans se nommer.';
comment on column public.client_feedbacks.phone is
  'Facultatif : NULL quand le client ne souhaite pas être rappelé.';

-- =====================================================================================
--  2. UN CHAMP VIDE VAUT « NON RENSEIGNÉ »
--
--     Même rôle qu'avant — normaliser ce qu'envoie un visiteur sans compte — mais
--     le nom et le téléphone rejoignent l'e-mail : vidés de leurs espaces, puis
--     ramenés à NULL s'il ne reste rien.
-- =====================================================================================

create or replace function public.client_feedbacks_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.status     := 'unread';
  new.read_at    := null;
  new.read_by    := null;
  new.created_at := now();
  new.full_name  := nullif(btrim(coalesce(new.full_name, '')), '');
  new.phone      := nullif(btrim(coalesce(new.phone,     '')), '');
  new.email      := nullif(btrim(coalesce(new.email,     '')), '');
  new.message    := btrim(new.message);
  return new;
end;
$$;

drop trigger if exists client_feedbacks_before_insert_trg on public.client_feedbacks;
create trigger client_feedbacks_before_insert_trg
  before insert on public.client_feedbacks
  for each row execute function public.client_feedbacks_before_insert();

-- Rattrapage des lignes déjà en base qui porteraient une chaîne vide.
update public.client_feedbacks
   set full_name = nullif(btrim(coalesce(full_name, '')), ''),
       phone     = nullif(btrim(coalesce(phone,     '')), '')
 where btrim(coalesce(full_name, '')) = '' or btrim(coalesce(phone, '')) = '';

-- =====================================================================================
--  VÉRIFICATIONS (facultatif — à exécuter à la main)
-- =====================================================================================
--   -- Les deux colonnes doivent répondre is_nullable = YES :
--   select column_name, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'client_feedbacks'
--      and column_name in ('full_name', 'phone');
--
--   -- Un avis anonyme doit passer :
--   insert into public.client_feedbacks (part, message) values ('fuel', 'Test anonyme');
--   select id, full_name, phone, message from public.client_feedbacks order by created_at desc limit 5;
--   -- puis supprimer la ligne de test.
--
--  Terminé.
-- =====================================================================================
