# Station — gestion de station-service

Application de gestion de station-service : **Carburant** (brigades, cuves,
pompes, achats carburant), **Restaurant**, **Cafétéria**, **Magasin** et
**Finance** (caisse générale, comptes bancaires, rapports généraux).

Back-end : **Supabase** (Auth, Postgres + RLS, Storage, Realtime).

## 1. Base de données (une seule fois)

1. Supabase → **SQL Editor** → New query.
2. Collez tout le fichier [`supabase/full_schema.sql`](supabase/full_schema.sql) → **Run**.
3. Supabase → **Authentication → Sign In / Providers → Email** :
   - désactivez **Confirm email** ;
   - désactivez **Allow new users to sign up** (tous les comptes sont créés par
     l'application).

Le script crée toutes les tables et relations, les fonctions (RPC) appelées par
l'application, les règles RLS par permission, les 9 buckets d'images et la
publication temps réel. Il peut être relancé sans risque.

## 2. Configuration

`.env` (voir `.env.example`) :

```
VITE_SUPABASE_URL=https://<projet>.supabase.co
VITE_SUPABASE_ANON_KEY=<clé anon>
```

## 3. Lancer

```bash
npm install
npm run dev        # → http://localhost:3000
npm run build && npm start
```

## 4. Comptes

- **Premier lancement** : la page de connexion affiche
  « Créer un compte administrateur ». Le bouton disparaît dès que
  l'administrateur est créé.
- **Employés** : l'administrateur leur crée un accès (nom d'utilisateur + mot de
  passe) depuis Pompistes / Gérants / Employés Magasin, ou depuis
  « Employés » d'une partie (Restaurant / Cafétéria / Magasin). Le compte est
  créé directement dans Supabase Auth et peut se connecter tout de suite avec
  son nom d'utilisateur ou son email.
- **Permissions** : chaque employé ne voit que les interfaces et boutons cochés
  par l'administrateur ; la base refuse en plus les suppressions et la gestion
  des comptes sans la permission correspondante.
