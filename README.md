# Station — gestion de station-service

Application de gestion de station-service : **Carburant** (brigades, cuves,
pompes, achats carburant), **Restaurant**, **Cafétéria**, **Magasin** et
**Finance** (caisse générale, comptes bancaires, rapports généraux).

**Mode démo — aucune base de données.** L'application ne se connecte plus à
Supabase : toutes les interfaces lisent et écrivent dans une base locale en
mémoire (`src/lib/mockSupabase.ts`), pré-remplie avec un jeu de données
constant pour les tests (`src/lib/demoData.ts`). Les modifications sont gardées
dans le navigateur (localStorage).

## 1. Connexion démo

Sur la page de connexion, cliquez **« Connexion admin démo »** — ou saisissez :

| Compte          | Identifiant | Mot de passe |
|-----------------|-------------|--------------|
| Administrateur  | `admin`     | `demo1234`   |
| Pompiste        | `pompiste`  | `demo1234`   |
| Chef de brigade | `chef`      | `demo1234`   |
| Gérant          | `gerant`    | `demo1234`   |
| Cafétéria       | `cafeteria` | `demo1234`   |

Le lien **« Réinitialiser les données démo »** remet le jeu de données d'origine.

## 2. Lancer

```bash
npm install
npm run dev        # → http://localhost:3000
npm run build && npm start
```

## 3. Comptes

- **Employés** : l'administrateur leur crée un accès (nom d'utilisateur + mot de
  passe) depuis Pompistes / Gérants / Employés Magasin, ou depuis
  « Employés » d'une partie. Le compte est créé dans la base locale de démo et
  peut se connecter tout de suite.
- **Permissions** : chaque employé ne voit que les interfaces et boutons cochés
  par l'administrateur.
- Le schéma SQL d'origine reste disponible dans `supabase/` pour référence.
