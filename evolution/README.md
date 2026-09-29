# Passerelle WhatsApp — procédure, diagnostic, déménagement

Envoyer des messages WhatsApp **depuis le numéro de la station**, sans passer par
la WhatsApp Business API (pas de modèle à faire approuver, pas de facturation par
message) et **sans louer de serveur**.

---

## 0. La contrepartie, dite franchement

**Le poste qui héberge la passerelle doit rester allumé.**

Une session WhatsApp Web (moteur Baileys) doit maintenir une connexion **ouverte
en permanence** vers les serveurs WhatsApp. L'hébergement de l'application est
serverless : chaque requête réveille une fonction qui s'éteint aussitôt. Les deux
modèles sont incompatibles — d'où une machine à soi.

```
Hébergeur (application)  ──HTTPS──►  passerelle Evolution  ──►  WhatsApp des clients
Hébergeur (webhook)      ◄──HTTPS──  passerelle Evolution  ◄──  statuts, réponses
```

Poste éteint, en veille ou sans Internet ⇒ **aucun message ne part**. Les envois
sont alors **mis en attente** par l'application et repartent seuls au retour
(voir « File d'attente » plus bas) — mais rien ne part tant que le poste dort, et
personne n'est prévenu automatiquement.

`keep-alive.ps1` supprime les causes **évitables** (veille, Docker non relancé
après une coupure). Il ne peut rien contre un poste débranché.

Coût du montage : **0 DA/mois**, en dehors du poste qui reste allumé.

---

## 1. Ce que contient ce dossier

| Fichier | Rôle |
| --- | --- |
| `docker-compose.funnel.yml` | La pile : Evolution + Postgres + sidecar Tailscale |
| `tailscale/funnel.json` | Configuration Serve/Funnel — **sans aucun commentaire** |
| `tailscale/README.md` | Ce que le JSON ne peut pas porter, et les deux pièges de diagnostic |
| `keep-alive.ps1` | Rend le poste apte au service continu (rapport, puis `-Apply`) |
| `check-gateway.ps1` | Diagnostic de bout en bout, en sept contrôles |
| `.env.example` | Les secrets à renseigner. Le vrai `.env` n'est **jamais** dans Git |

---

## 2. Installation, pas à pas

### Étape 1 — Compte Tailscale (gratuit, plan Personal)

Relever le **nom du tailnet** dans **DNS** : `tailXXXXXX.ts.net`.
L'adresse publique se déduit alors :
`https://` + `<TAILSCALE_HOSTNAME>` + `.` + `<nom du tailnet>`.

> `TAILSCALE_HOSTNAME` ne se récupère nulle part : **c'est un nom que l'on
> choisit**. Il forme la première moitié de l'adresse.

### Étape 2 — MagicDNS + certificats HTTPS

Console → **DNS** → MagicDNS actif, puis **Enable HTTPS**.
Sans HTTPS, le Funnel ne peut pas servir et l'hébergeur refuse de parler à la
passerelle.

### Étape 3 — Autoriser le Funnel dans les ACL

Console → **Access controls**, ajouter `nodeAttrs` **à l'intérieur** de la
politique existante :

```jsonc
"nodeAttrs": [
  { "target": ["autogroup:member"], "attr": ["funnel"] },
],
```

⚠️ Le fichier ne peut contenir **qu'un seul** objet de haut niveau. Coller ce
bloc *au-dessus* de la politique existante produit
`invalid character '{' after top-level value`. Les tailnets récents utilisent
`grants`, les anciens `acls` : **ne pas mettre les deux**.

### Étape 4 — Clé d'authentification

**Settings → Keys → Generate auth key**, cochée **Reusable**, surtout **pas
Ephemeral** : un nœud éphémère est supprimé dès qu'il se déconnecte et revient
sous un nom différent — **l'adresse publique change**.

### Étape 5 — Renseigner `evolution/.env`

Copier `.env.example` en `.env` et remplir les cinq valeurs.

> Si le volume Postgres existe déjà, **laisser `POSTGRES_PASSWORD` inchangé** :
> il n'est appliqué qu'à l'initialisation, et une nouvelle valeur serait rejetée
> par la base — la passerelle ne démarrerait plus.

### Étape 6 — Démarrer

```powershell
docker compose -f evolution/docker-compose.funnel.yml up -d
docker compose -f evolution/docker-compose.funnel.yml logs -f tailscale
```

Le nom obtenu doit être **exactement** `<TAILSCALE_HOSTNAME>.<tailnet>.ts.net`.
**Un suffixe `-1` signifie qu'un nœud porte déjà ce nom** : le supprimer dans
**Machines**, puis `down` et `up -d`.

### Étape 7 — Vérifier que le Funnel est réellement accordé

```powershell
docker exec rclmc-wa-tailscale tailscale status --json | Select-String "funnel"
```

Doit contenir **`funnel`** *et* `funnel-ports?ports=443,8443,10000`.
`tailscale funnel status` **ne fait pas foi** — voir `tailscale/README.md`.

### Étape 8 — Rendre le poste apte au service continu

Dans un PowerShell **administrateur** :

```powershell
powershell -ExecutionPolicy Bypass -File evolution\keep-alive.ps1        # rapport
powershell -ExecutionPolicy Bypass -File evolution\keep-alive.ps1 -Apply # correction
```

### Étape 9 — Variables chez l'hébergeur, puis **redéployer**

| Variable | Valeur |
| --- | --- |
| `EVOLUTION_BASE_URL` | l'adresse publique, **sans slash final** |
| `EVOLUTION_API_KEY` | identique à `EVOLUTION_API_KEY` de `evolution/.env` |
| `EVOLUTION_INSTANCE` | nom de l'instance, ex. `rclmc` |
| `EVOLUTION_WEBHOOK_TOKEN` | secret **différent** de la clé API |
| `SUPABASE_URL` | l'URL du projet Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | la clé de service (journal + file d'attente) |

**Ne pas définir `EVOLUTION_WEBHOOK_URL`** : l'application dérive l'adresse de
son propre domaine. La définir par erreur avec une valeur locale est le piège le
plus fréquent — l'application l'écarte désormais et **nomme la variable** dans
l'écran de réglages, mais autant ne pas la laisser traîner.

Puis **redéployer** : les variables ne sont lues qu'au déploiement.

### Étape 10 — Connecter le téléphone

Sur le site **déployé** (jamais depuis `localhost`, sinon le webhook pointera sur
votre machine) :

**Réglages → WhatsApp → Initialiser l'instance → Connecter WhatsApp →** scanner
avec le téléphone de la station
(**WhatsApp → ⋮ → Appareils connectés → Connecter un appareil**).

### Étape 11 — Vérifier toute la chaîne

```powershell
powershell -ExecutionPolicy Bypass -File evolution\check-gateway.ps1 `
  -BaseUrl https://<nœud>.<tailnet>.ts.net `
  -ApiKey  <la clé> `
  -Instance <nom d'instance> `
  -AppUrl  https://<domaine de l'application>
```

Puis envoyer un vrai message et vérifier qu'il atteint **« Remis »** :
franchir « En attente » est la seule preuve que la boucle est complète.

### Étape 12 — Désactiver l'expiration de la clé

**Machines → `<nœud>` → ⋯ → Disable key expiry.**

Sans ce clic, le nœud se déconnecte au bout de quelques mois et **les envois
s'arrêtent sans aucun avertissement**. C'est l'oubli qui se paie le plus cher,
parce qu'il survient des mois plus tard.

---

## 3. La file d'attente

La passerelle sera injoignable un jour ou l'autre. Sans file, chaque message émis
pendant ce temps serait **purement perdu** — et un rappel automatique ne laisse
rien derrière lui : personne ne revient l'envoyer à la main.

Comportement : passerelle injoignable ⇒ le message est **mis en attente**, pas
rejeté ; il repart **tout seul** dès qu'elle revient.

Trois règles, et ce sont elles qui comptent :

1. **Une passerelle injoignable ne consomme JAMAIS de tentative.** Ce n'est pas
   la faute du message. Sans cette règle, un week-end hors ligne épuiserait le
   compteur de toute la file et ferait abandonner des messages valides.
2. Un échec **propre au destinataire** (numéro sans compte WhatsApp) incrémente
   les tentatives ; au bout de 3, le message est abandonné plutôt que réessayé
   sans fin.
3. Les messages de **plus de 7 jours** sont périmés : un rappel vieux d'une
   semaine peut être devenu **faux** — le client est peut-être déjà repassé.

Qui déclenche le rattrapage ? **L'application ouverte dans le navigateur**
(`src/components/WhatsAppOutboxRunner.tsx`). En serverless, rien ne tourne entre
deux requêtes. Ce n'est pas un pis-aller : le poste de la station a
l'application ouverte toute la journée, et c'est **le même poste** qui héberge la
passerelle.

---

## 4. Diagnostic

### Le piège n°1 — « ça marche depuis le poste »

Depuis la machine qui héberge la passerelle — et depuis **tout** membre du
tailnet — MagicDNS résout le nom vers l'IP **tailnet** (`100.x`). La requête ne
passe alors jamais par le Funnel : elle réussit même si le chemin public est
complètement cassé.

**Un `curl` réussi depuis le poste ne prouve rien.** Le seul test qui tranche est
une requête depuis un réseau tiers :

```powershell
# Depuis un partage de connexion du téléphone, coupé du Wi-Fi de la station :
curl.exe -s -o NUL -w "%{http_code}`n" https://<nœud>.<tailnet>.ts.net/
```

### Le piège n°2 — le webhook survit aux déménagements

Il est stocké **sur la passerelle**, pas dans l'application. Après un passage de
`localhost` à la production, il pointe encore vers la machine de développement.
Symptôme : les messages partent, les statuts restent sur « En attente »,
**aucune erreur nulle part**.

Correctif en un clic : **Réglages → WhatsApp → « Réenregistrer le webhook »**.
Ce bouton est disponible **session ouverte** : il n'y a jamais à délier le
téléphone pour corriger une URL.

### Le piège n°3 — le jeton diverge

L'écran affiche « prête », les messages partent, et chaque accusé est refusé en
**401** : le jeton régénéré chez l'hébergeur n'a jamais été réécrit sur la
passerelle. Le contrôle 6 de `check-gateway.ps1` le débusque en rejouant un appel
authentique. Même correctif : **« Réenregistrer le webhook »**.

### Le piège n°4 — `ECONNRESET` au premier appel

L'hébergeur gèle la fonction entre deux requêtes ; son pool de connexions garde
des sockets que la passerelle a fermées entre-temps. Le client (`api/_lib/evolution.ts`)
rejoue donc les appels **déclarés idempotents** — jamais `/message/sendText` : un
message posté deux fois chez un client est pire qu'un envoi manqué, que la file
rattrape de toute façon.

---

## 5. Déménager la passerelle

### Nouveau poste

1. **Supprimer d'abord l'ancien nœud** dans **Machines**. Tailscale n'attribue
   jamais deux fois le même nom : tant que l'ancien existe, le nouveau devient
   `<nom>-1` et **l'adresse publique change**. Oublier cette étape *ressemble* à
   une réussite : tout démarre, tout paraît sain, seule l'adresse a
   discrètement changé.
2. Transporter `evolution/.env` (il n'est **pas** dans Git).
3. `docker compose -f evolution/docker-compose.funnel.yml up -d`, puis
   `keep-alive.ps1 -Apply`.
4. Rescanner le QR code (les volumes ne suivent pas), puis
   **« Réenregistrer le webhook »**.

L'hébergeur n'a **rien** à savoir du déménagement si l'adresse est restée la même.

### Nouveau numéro de téléphone

**Réglages → WhatsApp → Déconnecter** (deux clics : le geste arrête tous les
envois), puis **Connecter WhatsApp** et scanner avec le nouveau téléphone.

---

## 6. Protéger le numéro

**Un numéro banni par WhatsApp l'est sans recours.**

- n'écrire qu'à des personnes qui attendent quelque chose de la station ;
- monter en charge progressivement (~50 messages/jour la première semaine) ;
- **ne jamais désactiver la temporisation** des envois groupés
  (`PACING`, dans `src/lib/whatsappCore.ts`) — elle vaut aussi pour le
  rattrapage de la file, qui est justement le moment où l'on ressemble le plus à
  un robot ;
- utiliser un numéro **dédié**, jamais le portable personnel du gérant.
