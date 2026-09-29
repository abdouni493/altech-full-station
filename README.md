# Altech Full Station — version démo

Application de gestion de station-service (carburant, restaurant, cafétéria,
lavage & vidange, finance) en **version de démonstration** : elle ne se connecte
à **aucune base de données**. Tous les écrans tournent sur un jeu de données
constant, généré en mémoire au chargement de la page.

## 🚀 Lancer

```bash
npm install
npm run dev        # → http://localhost:3000
# ou, sans serveur :
npx vite build && npx vite preview
```

## 🔑 Accès rapide

La page de connexion propose un bouton par profil — un clic suffit :

| Profil | Email | Mot de passe |
|---|---|---|
| Administrateur | `admin@demo.dz` | `demo123` |
| Gérant | `gerant@demo.dz` | `demo123` |
| Chef de brigade | `chef@demo.dz` | `demo123` |
| Pompiste | `pompiste@demo.dz` | `demo123` |
| Employé magasin | `magasin@demo.dz` | `demo123` |
| Restaurant | `restaurant@demo.dz` | `demo123` |
| Cafétéria | `cafeteria@demo.dz` | `demo123` |
| Lavage & Vidange | `lavage@demo.dz` | `demo123` |

## 🧪 Données de démonstration

- `src/lib/demo/seed.ts` — le jeu de données : ~45 jours de brigades (index des
  pistolets, bons clients, TPE/TAG, décalages), achats carburant et
  réapprovisionnement des cuves, clients, fournisseurs, dépenses, trésorerie,
  paie, et l'activité complète des parties **Restaurant**, **Cafétéria** et
  **Lavage & Vidange** (produits, fiches techniques, productions, comptoir,
  ventes, sessions de caisse, interventions, inventaires…). Les dates suivent le
  jour courant : le mois en cours est toujours rempli.
- `src/lib/demo/mockBackend.ts` — remplace le client Supabase : requêtes,
  authentification, fonctions RPC, stockage de fichiers et temps réel sont
  servis en mémoire.

Chaque bouton fonctionne (créer, modifier, supprimer, encaisser…). Les
modifications vivent en mémoire et les données constantes reviennent au
rechargement de la page.

## 🍽️ Partie Restaurant

Le Restaurant dispose des mêmes interfaces que la Cafétéria (stock, inventaire,
achats, production, comptoir, point de vente, ventes, clients, fournisseurs,
employés, dépenses, caisse, rapports, retours clients), et il est intégré à la
**Caisse Générale** (caisse dédiée, virements, créances), aux **Rapports
Généraux** (rapport détaillé, vue globale, analyses, stock, inventaires, zakât,
personnel) et à tous les calculs consolidés.
