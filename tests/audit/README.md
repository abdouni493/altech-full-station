# Environnement de test — audit des calculs

Vérifie qu'aucun **décalage** n'existe entre les écrans : un même chiffre (caisse,
banque, dette, stock, chiffre d'affaires…) doit être identique partout, et chaque
document doit s'additionner.

Pré-requis : l'application tourne (`npm run dev`, http://localhost:3000).

| Commande | Ce qu'elle fait |
|---|---|
| `npm run audit` | Instantané de l'application (données démo) puis **≈ 190 contrôles** de cohérence : brigades, Rapports Carburant, Rapports Généraux, Caisse Générale, banques, clients, fournisseurs, achats, factures, stock, fonds de roulement. |
| `npm run audit:scenario` | Joue un **scénario d'opérations réelles à travers les écrans** (vente avec TVA, achat avec TVA + taxe, dépenses Carburant / Finance, dépôts, brigade avec TPE détaillés + TAG + crédit client + dépense, négociation bancaire, règlement client, facture modifiée puis supprimée, vente Cafétéria), vérifie que **chaque caisse, banque, dette, stock et rapport a bougé exactement du montant attendu**, que les **chiffres affichés à l'écran** sont les bons, et que **tout est identique après rechargement**. |

Le script sort en échec (code 1) au moindre écart > 0,01 DA et liste chaque décalage.
