# WhatsApp — dossier complet du montage de cette application

Ce fichier décrit **comment l'envoi WhatsApp a réellement été configuré dans cette application** :
l'architecture retenue et pourquoi, chaque fichier et son rôle, la suite exacte des gestes qui ont
été faits, les pannes traversées — et, en partie 9, **un prompt complet à donner à Claude Code pour
rejouer tout le montage sur un autre projet**.

Il est écrit à partir des sources du dépôt et de l'historique Git des sessions WhatsApp
(`040a18a` → `27338aa`, 22–23 août 2026). Rien n'y est supposé : chaque valeur citée est celle qui
est réellement dans le code ou dans les fichiers d'infrastructure.

> **Aucun secret ici.** Les valeurs réelles vivent dans `evolution/.env` (jamais commité) et dans
> les variables d'environnement de l'hébergeur.

## Ce fichier et les quatre autres

| Fichier | Ce qu'il est | Quand l'ouvrir |
| --- | --- | --- |
| **`WHATSAPP-DOSSIER-COMPLET.md`** (ici) | La référence unique : architecture, fichiers, étapes, pannes, prompt de reprise | Pour comprendre, réparer, ou refaire ailleurs |
| [GUIDE-APRES-MISE-A-JOUR.md](GUIDE-APRES-MISE-A-JOUR.md) — partie B | Le mode d'emploi opérationnel **de cette station**, avec son état daté | Pour exécuter la mise en service ici |
| [SESSION-WHATSAPP.md](SESSION-WHATSAPP.md) | Le compte rendu de la **première** installation (projet école) et ses cinq pièges | Pour comprendre d'où viennent les décisions |
| [WHATSAPP-NOUVEAU-PROJET.md](WHATSAPP-NOUVEAU-PROJET.md) | Ce qu'il faut décider avant d'installer un **second** projet | Avant d'ouvrir une deuxième station |
| [whatsapp_promp.md](whatsapp_promp.md) | Le prompt d'origine, écrit à l'école | Historique — **la partie 9 le remplace** : elle intègre quatre pannes découvertes ici et absentes de ce prompt |

---

## 1. Le résultat, en une image

```
   NAVIGATEUR                    HÉBERGEUR (serverless)              POSTE DE LA STATION
   ───────────                   ──────────────────────              ───────────────────
   Écran Messages   ──fetch──►   /api/whatsapp/send      ──HTTPS──►  passerelle Evolution
   Écran Réglages   ──fetch──►   /api/whatsapp/status                 (moteur Baileys)
   OutboxRunner     ──fetch──►   /api/whatsapp/outbox…                       │
                                                                             ▼
                                 /api/whatsapp/webhook  ◄──HTTPS──   accusés de remise
                                          │                          (sent/delivered/read)
                                          ▼
                                 Supabase : whatsapp_messages (journal)
                                            whatsapp_outbox   (file d'attente)
```

Trois propriétés expliquent tout le reste :

1. **Le navigateur ne parle jamais à la passerelle.** Il parle à `/api/whatsapp/*`, seul endroit
   détenant la clé. Aucune variable de la passerelle ne porte le préfixe `VITE_`.
2. **La passerelle vit sur un poste de la station**, publiée en HTTPS par Tailscale Funnel — pas de
   VPS, pas de nom de domaine, pas de WhatsApp Business API, **0 DA/mois**.
3. **L'hébergeur est serverless** : rien ne tourne entre deux requêtes. D'où la file d'attente, et
   le fait que ce soit le navigateur qui déclenche son vidage.

### État vérifié au 2026-08-23

| Contrôle | Résultat |
| --- | --- |
| Nœud Tailscale | `rclmc-wa.tail6ac334.ts.net` — sans suffixe `-1` |
| Attribut `funnel` | accordé par le plan de contrôle (pas seulement affiché) |
| Passerelle | Evolution API 2.3.7, `127.0.0.1:8082` en local |
| Joignable **depuis l'extérieur** | oui — établi par l'application hébergée, qui est hors du tailnet |
| Instance `rclmc` | créée |
| Webhook | **Jeton vérifié** |
| Journal + file d'attente | `storageConfigured: true` |
| Session WhatsApp | **fermée** — le scan du QR reste à faire |
| Expiration de la clé du nœud | **armée au 2027-02-19** — un clic à faire dans la console |

Les deux dernières lignes sont les **seuls** gestes qu'aucun script ne peut faire à votre place.

---

## 2. Pourquoi ce montage, et pas un autre

### La contrainte, d'abord

Une session WhatsApp Web (moteur **Baileys**) doit maintenir une connexion **ouverte en
permanence** vers les serveurs WhatsApp. L'hébergement de l'application est serverless : chaque
requête réveille une fonction qui s'éteint aussitôt. **Les deux modèles sont incompatibles** — aucun
réglage d'hébergeur n'y change rien. Quelque chose doit rester allumé.

### La décision

| | Tailscale Funnel | Cloudflare | Railway | VPS |
| --- | --- | --- | --- | --- |
| Coût | **0 DA** | 0 DA | 7–10 $/mois | ≈ 4 €/mois |
| Nom de domaine | **aucun** | obligatoire | aucun | obligatoire |
| Poste éteint | ne marche pas | ne marche pas | marche | marche |

**Tailscale Funnel** a été retenu : adresse HTTPS publique et stable
(`https://<nœud>.<tailnet>.ts.net`) avec le compte gratuit, **sans domaine**.

### La contrepartie, dite franchement

**Poste éteint, en veille ou sans Internet ⇒ aucun message ne part, et personne n'est prévenu.**
C'est le prix de la gratuité. Deux choses l'amortissent :

- la **file d'attente** : les messages émis pendant ce temps ne sont pas perdus, ils repartent seuls ;
- le poste choisi est celui qui **reste allumé toute la journée** — l'application y est ouverte en
  permanence, donc le rattrapage part exactement quand un envoi peut aboutir.

Si cela devient inacceptable (alertes le soir, le week-end), la bascule vers un hébergement payant
prend 20 minutes : changer `EVOLUTION_BASE_URL`, redéployer, rescanner le QR.

### Ce que ce montage évite

Pas de **WhatsApp Business API** : aucun modèle à faire approuver, aucune facturation par message,
et les messages partent du **vrai numéro de la station**. En échange, la protection du numéro est
entièrement à notre charge — d'où la temporisation décrite en 4.5.

---

## 3. Inventaire des fichiers

### Infrastructure — le poste qui héberge la passerelle

| Fichier | Rôle | Ce qui casse si on y touche |
| --- | --- | --- |
| [evolution/docker-compose.funnel.yml](evolution/docker-compose.funnel.yml) | La pile : Evolution + Postgres + sidecar Tailscale | `name: rclmc-wa` décide du **nom des volumes**, donc de la session WhatsApp. Le modifier sur une installation en service ⇒ QR à rescanner |
| [evolution/tailscale/funnel.json](evolution/tailscale/funnel.json) | Configuration Serve/Funnel | **Aucun commentaire** : Tailscale désérialise ce fichier |
| [evolution/.env.example](evolution/.env.example) | Les cinq secrets du poste, avec ce qui se réutilise et ce qui ne se réutilise pas | — |
| [evolution/start-gateway.ps1](evolution/start-gateway.ps1) | Démarre **et** vérifie les deux pannes qui ressemblent à une réussite | — |
| [evolution/check-gateway.ps1](evolution/check-gateway.ps1) | Diagnostic en 7 contrôles ; ne modifie rien | — |
| [evolution/keep-alive.ps1](evolution/keep-alive.ps1) | Met le poste en service continu (veille, démarrage de Docker) | — |
| [evolution/README.md](evolution/README.md) | Procédure, diagnostic, déménagement | — |

### Serveur — les routes

| Fichier | Rôle |
| --- | --- |
| [api/_lib/router.ts](api/_lib/router.ts) | **Les six routes, écrites une seule fois.** Ne connaît ni Express ni l'hébergeur |
| [api/whatsapp/](api/whatsapp/) `[...path].ts` | Adaptateur serverless — traduit, ne décide rien |
| [server.ts](server.ts) | Adaptateur Express du poste de développement — appelle le **même** répartiteur |
| [api/_lib/evolution.ts](api/_lib/evolution.ts) | Le client de la passerelle. **Seul fichier détenant la clé API** |
| [api/_lib/env.ts](api/_lib/env.ts) | Les réglages lus côté serveur, et la **dérivation** de l'adresse du webhook |
| [api/_lib/store.ts](api/_lib/store.ts) | Le journal et la file d'attente, écrits avec la clé de service |
| [api/_lib/imports.test.ts](api/_lib/imports.test.ts) | Relit le graphe d'imports : une extension oubliée casse la fonction **en production seulement** |
| [api/_lib/routePath.test.ts](api/_lib/routePath.test.ts) | Fige la lecture du chemin sous les deux conventions |

> Les tests vivent sous `_lib/` **et non à côté du fichier qu'ils éprouvent** : tout ce que `api/`
> contient hors des dossiers en `_` est publié comme fonction. Un fichier de test y deviendrait une
> route accessible à tous.

### Application — ce que l'utilisateur voit

| Fichier | Rôle |
| --- | --- |
| [src/lib/whatsappCore.ts](src/lib/whatsappCore.ts) | Le noyau **partagé** navigateur ↔ serveur : numéros, temporisation, modèles |
| [src/lib/whatsapp.ts](src/lib/whatsapp.ts) | Le côté navigateur : appelle `/api/whatsapp/*`, lit le journal via Supabase |
| [src/components/WhatsAppSettingsPanel.tsx](src/components/WhatsAppSettingsPanel.tsx) | Réglages → WhatsApp : instance, QR, webhook, file — sans terminal |
| [src/components/WhatsAppOutboxRunner.tsx](src/components/WhatsAppOutboxRunner.tsx) | Le rattrapage de la file, monté dans [Layout.tsx:101](src/components/Layout.tsx#L101) |
| [src/pages/modules/ModuleMessages.tsx](src/pages/modules/ModuleMessages.tsx) | L'écran « Messages clients » : alertes, envoi, modèles |
| [src/lib/rappels.ts](src/lib/rappels.ts) | Les alertes de rappel — **déduites**, jamais stockées |
| [src/lib/backup.ts:131-132](src/lib/backup.ts#L131-L132) | Les deux tables déclarées dans `BACKUP_TABLES` |
| [supabase/migrations/2026-08-22_whatsapp_messaging.sql](supabase/migrations/2026-08-22_whatsapp_messaging.sql) | Les deux tables, leurs index, RLS et temps réel |
| [vercel.json](vercel.json) | `maxDuration: 60` sur `api/whatsapp/*` — la temporisation a besoin de ce temps |

---

## 4. Comment ça marche, pièce par pièce

### 4.1 Les routes sont écrites UNE SEULE FOIS

C'est le point d'architecture à ne pas casser. L'application tourne à deux endroits — Express en
développement, fonction serverless chez l'hébergeur — et **les deux appellent le même répartiteur**,
[`handleWhatsApp`](api/_lib/router.ts). Les écrire deux fois garantirait qu'elles divergent, et une
divergence ici se paie en messages non partis ou en accusés refusés en 401 : deux pannes
parfaitement muettes.

| Route | Méthode | Ce qu'elle fait |
| --- | --- | --- |
| `/api/whatsapp/send` | POST | Envoi. Le seul chemin qui touche la clé |
| `/api/whatsapp/webhook` | POST | Accusés de remise venant de la passerelle |
| `/api/whatsapp/status` | GET | État de session, pour l'écran de réglages |
| `/api/whatsapp/session` | POST | `setup` \| `connect` \| `restart` \| `logout` |
| `/api/whatsapp/outbox` | GET | Comptage des messages en attente |
| `/api/whatsapp/outbox/flush` | POST | Vidage de la file |

Les adaptateurs ne font que traduire : ils lisent le chemin, la méthode, le corps, les en-têtes,
l'hôte et le protocole, et rendent un statut + un corps JSON.

### 4.2 Les variables d'environnement, et l'adresse du webhook

Quatre variables côté serveur, **jamais préfixées `VITE_`** : ce préfixe est ce qui ferait entrer la
clé dans le paquet JavaScript téléchargé par chaque visiteur.

| Variable | Rôle |
| --- | --- |
| `EVOLUTION_BASE_URL` | Adresse publique de la passerelle, **sans slash final** |
| `EVOLUTION_API_KEY` | Doit valoir exactement `AUTHENTICATION_API_KEY` de la passerelle |
| `EVOLUTION_INSTANCE` | Nom de l'instance (`rclmc` ici ; `station` par défaut dans le code) |
| `EVOLUTION_WEBHOOK_TOKEN` | Le `Bearer` que la passerelle présentera à chaque accusé |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Journal et file d'attente (le webhook n'a aucune session utilisateur, il ne peut pas écrire sous RLS) |

Deux subtilités valent d'être connues, chacune a coûté une mise en service :

- **`EVOLUTION_WEBHOOK_URL` ne doit PAS être définie.** L'adresse du webhook se **déduit** du
  domaine sur lequel l'application répond. Recopier un `.env` local en bloc vers l'hébergeur emporte
  `http://host.docker.internal:3000` — l'adresse du poste de développement vue depuis le conteneur —
  et la mise en service échouait sur une 400 muette. Désormais toute valeur locale ou non-HTTPS est
  **écartée en production et NOMMÉE** dans le diagnostic ([env.ts → `webhookUrl()`](api/_lib/env.ts)).
- **`TUNNEL_PUBLIC_URL` sert de repli à `EVOLUTION_BASE_URL`** sur le poste de développement.
  L'adresse s'écrit à deux endroits qui doivent rester identiques au caractère près (elle devient le
  `SERVER_URL` du conteneur, estampillé dans le champ `server_url` de chaque webhook, que
  l'application compare). Deux valeurs qui doivent rester égales finissent toujours par diverger, et
  la divergence se paie en 403 sur **tous** les accusés de remise.

### 4.3 Le client de la passerelle — l'idempotence est déclarée, jamais déduite

[`api/_lib/evolution.ts`](api/_lib/evolution.ts) est le seul fichier qui parle à la passerelle.

L'hébergeur étant serverless, la fonction est **gelée entre deux requêtes** et son pool de
connexions garde des sockets que la passerelle a fermées entre-temps : la première requête d'une
fonction réveillée tombe sur une socket morte (`ECONNRESET`), sans que rien ne soit cassé nulle part.
D'où une reprise — mais **on ne peut pas déduire du verbe HTTP si un appel est rejouable** :

| Appel | Rejouable ? | Pourquoi |
| --- | --- | --- |
| `/instance/create` | **oui** | POST parfaitement idempotent, et c'est justement le bouton sur lequel la réception tombe |
| `/webhook/set`, `/instance/connect`, `/restart`, `/logout` | oui | Aucun effet durable en double |
| `/message/sendText` | **non** | Un message posté deux fois chez un client est **pire** qu'un envoi manqué, que la file rattrape de toute façon |

Deux reprises (250 ms, 900 ms) sous un **budget de temps** — et non un seuil de délai fixe : la
demande de QR attend jusqu'à 30 s et ne doit pas être écartée de la reprise alors qu'elle en a le
temps.

Chaque échec devient une `GatewayError` qui porte la **cause système** jusqu'à l'écran
(`ECONNRESET`, `ENOTFOUND`, `ETIMEDOUT`, `HTTP_401`…), l'hôte visé et **ce qu'il faut faire** —
jamais la clé. C'est le changement le plus rentable de tout le montage : tant que chaque échec
réseau rendait la même phrase, rien n'était diagnosticable.

### 4.4 Deux tables, et elles ne se confondent pas

| Table | Ce qu'elle porte | Sans elle |
| --- | --- | --- |
| `whatsapp_messages` — **le journal** | Ce qui a été confié à la passerelle : destinataire, texte, avancement de la remise (`sent → delivered → read`) | On ne peut pas relire ce qu'a reçu un client six mois plus tard |
| `whatsapp_outbox` — **la file** | Ce qui n'a **pas pu** partir, avec son texte | Tout message émis passerelle éteinte est **purement perdu** |

Les deux partagent le **même identifiant** : un message rattrapé depuis la file se retrouve dans le
journal au même endroit, jamais en double.

Trois règles de reprise, et elles comptent toutes les trois :

1. **Une passerelle injoignable ne consomme JAMAIS de tentative.** Ce n'est pas la faute du message.
   Sans cette règle, un week-end hors ligne épuiserait le compteur de toute la file et ferait
   abandonner des messages parfaitement valides.
2. **Un refus propre au destinataire en consomme une** (numéro sans compte WhatsApp, refus de la
   passerelle) — trois au maximum, puis abandon plutôt qu'un réessai sans fin.
3. **Un message de plus de 7 jours est périmé.** Un rappel de passage vieux d'une semaine peut être
   devenu faux — le client est peut-être déjà repassé. Mieux vaut ne rien envoyer qu'envoyer une
   information périmée.

Un numéro invalide, lui, est refusé **tout de suite** et jamais mis en file : le découvrir trois
jours plus tard au fond d'un journal ne sert personne.

### 4.5 La temporisation — ce qui protège le numéro

WhatsApp bannit les comptes qui écrivent vite et à beaucoup de monde, et **un numéro banni l'est sans
recours** : le montage est auto-hébergé, personne ne viendra plaider le dossier.

Les constantes vivent dans [`whatsappCore.ts`](src/lib/whatsappCore.ts), **partagées** par le
navigateur et le serveur — les dupliquer les laisserait diverger :

| Réglage | Valeur | Motif |
| --- | --- | --- |
| Attente entre deux destinataires | **3 à 7 s**, tirée au hasard | Un intervalle régulier au millième près fait robot |
| Destinataires par appel | 40 | Au-delà, la file prend le relais |
| Messages par vidage | 15 | Le rattrapage traite des lots : c'est là qu'on ressemble le plus à un robot |
| Budget d'une requête | **45 s** (`vercel.json` : 60 s) | Au-delà, **le reste part en file** plutôt que d'accélérer |

Ce dernier point est une règle, pas une optimisation : **on n'accélère jamais pour faire tenir un lot
dans une requête.** Ce qui ne tient pas attend.

### 4.6 Qui déclenche le vidage, et pourquoi c'est le navigateur

En serverless, rien ne tourne entre deux requêtes : aucune tâche de fond ne peut reprendre les
messages en attente. C'est l'application **ouverte dans le navigateur** qui s'en charge
([`WhatsAppOutboxRunner`](src/components/WhatsAppOutboxRunner.tsx), monté dans `Layout`).

Ce n'est pas un pis-aller : le poste de la station a l'application ouverte toute la journée, et
**c'est le même poste qui héberge la passerelle**. Quand il est allumé — le seul moment où un envoi
peut aboutir — le rattrapage part.

Cinq règles l'empêchent de devenir nuisible : il **compte** des lignes au lieu d'appeler la
passerelle (90 s d'intervalle) ; il ne vide que s'il reste quelque chose ; un verrou empêche deux
vidages de se chevaucher ; il s'arrête définitivement sur 401/403 ; et son premier passage est
différé de 8 s, parce que le composant est remonté à chaque navigation. Il n'affiche rien tant que
la file est vide — un encart permanent finit par ne plus être lu.

### 4.7 L'écran de réglages — la pièce qui rend le montage utilisable

Sans lui, connecter le téléphone imposerait d'appeler l'API de la passerelle à la main, jeton
compris. [Le panneau](src/components/WhatsAppSettingsPanel.tsx) fait tout : instance, QR, webhook,
file d'attente. Il **n'affiche jamais** la clé, le jeton, ni l'URL complète — hôte seul et nom
d'instance masqué : il est ouvert devant du personnel administratif et visible dans l'onglet réseau.

Deux détails de dessin viennent de pannes réelles :

- **« Réenregistrer le webhook » est disponible session OUVERTE.** C'est exactement le cas qui en a
  besoin — webhook périmé, session saine — et c'est celui où le bouton avait été oublié. Le seul
  contournement était de délier le téléphone : casser une session valide pour corriger une URL.
- **« La passerelle est prête » exige un webhook réellement vérifié.** L'écran se contentait de
  constater que `EVOLUTION_WEBHOOK_TOKEN` existait côté serveur — ce qui ne dit rien de ce que la
  passerelle, elle, enverra. L'application **relit** donc le webhook enregistré et distingue
  *Non configuré*, *Adresse périmée*, *Jeton divergent* et *Jeton vérifié*.

### 4.8 Le garde-fou des déploiements de prévisualisation

Il n'y a qu'**une** passerelle, **une** instance et **un** emplacement de webhook — et le webhook est
stocké **sur la passerelle**, pas dans l'application. Les variables étant déclarées « Production and
Preview », chaque déploiement de branche parle à la même passerelle.

`setup` et `logout` sont donc **refusés en 409 depuis une prévisualisation** : le premier réécrirait
le webhook vers l'adresse de la prévisualisation (la production continuerait d'envoyer et ne
recevrait plus aucun accusé, sans la moindre erreur nulle part), le second délierait le téléphone de
la station. `connect` et `restart` restent autorisés : ils ne réécrivent rien de durable.

### 4.9 Ce que l'utilisateur en fait : rappels, modèles, journal

L'écran [Messages clients](src/pages/modules/ModuleMessages.tsx) (parties de service uniquement —
une cafétéria ne rappelle personne pour un lavage) fait trois choses :

1. **Alertes** — les clients dont le prochain passage est dû. Elles ne sont **pas stockées** : ce
   sont une lecture des interventions terminées à la lumière des délais réglés
   ([`rappels.ts`](src/lib/rappels.ts)). Ce qui est enregistré, c'est ce que l'utilisateur en a fait
   — « lue » ou « envoyée ». On ne rappelle que sur le **dernier** passage d'un véhicule pour une
   nature donnée : un client qui lave sa voiture chaque semaine ne reçoit pas cinquante-deux rappels.
2. **Envoyer** — chercher un client, choisir ses véhicules, composer le message, l'envoyer.
   L'application **écrit le premier jet** : devant un champ vide on écrit vite et mal, et un client
   qui reçoit « votre vidange est à refaire » d'un numéro inconnu bloque le numéro — un numéro bloqué
   par plusieurs personnes finit banni. Le texte est modifiable, et n'est jamais envoyé sans avoir
   été vu.
3. **Modèles** — les textes types de la station, avec des jetons `{client}`, `{vehicule}`,
   `{derniere_visite}`… Un jeton **inconnu** est laissé tel quel plutôt que remplacé par du vide :
   mieux vaut voir `{truc}` à la relecture que d'envoyer une phrase amputée.

Les modèles, les délais de rappel et les alertes traitées vivent dans le blob `biz_store` avec le
reste des parties commerciales — aucune table pour eux.

### 4.10 Sauvegarde

Les deux tables sont déclarées dans `BACKUP_TABLES`
([backup.ts:131-132](src/lib/backup.ts#L131-L132)) : sans cela elles ne seraient **jamais**
sauvegardées. La file y figure aussi, et volontairement — une restauration faite après une panne de
poste doit rendre les messages qui n'étaient pas encore partis.

---

## 5. Les étapes exactes de la configuration

Voici ce qui a été fait, dans l'ordre. C'est la même suite à rejouer pour un déménagement ou une
réinstallation.

### Étape 1 — La base de données

Supabase → SQL Editor → coller
[`2026-08-22_whatsapp_messaging.sql`](supabase/migrations/2026-08-22_whatsapp_messaging.sql) en
entier → **Run**. Le script est idempotent, il peut être relancé sans risque. Il crée les deux
tables, leurs index, la RLS et la publication temps réel.

### Étape 2 — Tailscale : presque rien à faire

Le tailnet existait déjà (projet école). **Un seul compte suffit pour tous les projets** : un tailnet
héberge autant de machines que nécessaire, et seule change la **première moitié** du nom.

```
benzaoui-wa.tail6ac334.ts.net     ← l'école
rclmc-wa.tail6ac334.ts.net        ← la station   (même compte, même tailnet)
```

| Étape de l'installation d'origine | À refaire ? |
| --- | --- |
| Créer le compte, activer MagicDNS, activer HTTPS | **Non** |
| Autoriser le Funnel dans les ACL | **Non** — l'attribut vise `autogroup:member`, tout nouveau nœud en hérite |
| Générer une clé d'authentification | **Oui, ici** — la console indiquait *« You don't have any valid auth keys »* |

La clé se génère **Reusable**, **jamais Ephemeral** : un nœud éphémère est supprimé dès qu'il se
déconnecte et revient sous un nom différent, ce qui **change l'adresse publique**.

> `evolution/.env` a été livré avec `TAILSCALE_AUTHKEY=` **vide, exprès**. Une clé morte échoue avec
> un message qui ne désigne pas la cause ; un champ vide est refusé nommément par
> `start-gateway.ps1`.

### Étape 3 — Les secrets du poste

```powershell
copy evolution\.env.example evolution\.env
notepad evolution\.env
```

| Variable | Valeur | Se réutilise d'un projet à l'autre ? |
| --- | --- | --- |
| `TAILSCALE_AUTHKEY` | la clé de l'étape 2 | **oui** — c'est le sens de « Reusable » |
| `TAILSCALE_HOSTNAME` | `rclmc-wa` — un nom **que l'on choisit** | **non** — le piège : Tailscale n'attribue jamais deux fois le même nom, le nœud devient `<nom>-1` et rien ne le signale |
| `TUNNEL_PUBLIC_URL` | `https://rclmc-wa.tail6ac334.ts.net`, **sans slash final** | non — elle découle du nom de nœud |
| `EVOLUTION_API_KEY` | 32 octets aléatoires | **non** — deux organisations ne partagent pas un secret |
| `POSTGRES_PASSWORD` | 32 autres octets aléatoires | non |

```powershell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
```

### Étape 4 — Différencier le montage (l'école tourne sur le même poste)

Deux réglages du compose diffèrent de ceux de l'école, et pour deux raisons de gravité très
différente :

| Réglage | Ici | Pourquoi |
| --- | --- | --- |
| `name: rclmc-wa` | vs `evolution` | **Le plus grave.** Il décide du nom des **volumes** : deux montages homonymes partageraient la même session WhatsApp et la même base |
| Port `127.0.0.1:8082` | vs `8081` | Le second conteneur refuserait de démarrer, avec une erreur de port qui ne dit rien de sa cause |

La cohabitation a été vérifiée : volumes `evolution_*` d'un côté, `rclmc-wa_*` de l'autre.

### Étape 5 — Démarrer

```powershell
powershell -ExecutionPolicy Bypass -File evolution\start-gateway.ps1
```

Le script refuse de toucher à Docker tant que `evolution/.env` est incomplet — **en nommant la ligne
manquante** — puis vérifie les deux pannes qui *ressemblent à une réussite* :

- **le nom de nœud suffixé** (`rclmc-wa-1`) : l'adresse publique n'est alors plus celle déclarée ;
- **le Funnel non accordé** par les ACL. Sans l'attribut, le conteneur démarre, obtient même son
  certificat TLS et affiche fièrement `# Funnel on: https://…` — cet affichage vient du fichier
  **local**. Le plan de contrôle, lui, refuse silencieusement de publier le DNS public.

La seule vérification qui fasse foi :

```powershell
docker exec rclmc-wa-tailscale tailscale status --json | Select-String "funnel"
```

Doit contenir **`funnel`** *et* `funnel-ports`.

### Étape 6 — Le poste en service continu

```powershell
powershell -ExecutionPolicy Bypass -File evolution\keep-alive.ps1          # rapport seul
powershell -ExecutionPolicy Bypass -File evolution\keep-alive.ps1 -Apply   # applique
```

Il corrige les deux causes n°1 de « ça marchait la journée, plus le soir » : la **mise en veille**
(elle suspend les conteneurs et fait tomber la session) et l'absence de **démarrage automatique de
Docker** (après une coupure de courant, `unless-stopped` ne s'applique qu'une fois le moteur lancé).

### Étape 7 — Les variables chez l'hébergeur, puis redéployer

| Variable | Valeur |
| --- | --- |
| `EVOLUTION_BASE_URL` | `https://rclmc-wa.tail6ac334.ts.net` — **sans slash final** |
| `EVOLUTION_API_KEY` | **la même** qu'à l'étape 3 |
| `EVOLUTION_INSTANCE` | `rclmc` |
| `EVOLUTION_WEBHOOK_TOKEN` | une chaîne aléatoire, **différente** de la clé API |
| `SUPABASE_URL` | l'URL du projet Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` |

**Ne pas définir `EVOLUTION_WEBHOOK_URL`** (voir 4.2). **`SUPABASE_SERVICE_ROLE_KEY` n'est pas
optionnelle** : sans elle les messages peuvent partir, mais rien n'est journalisé et un envoi tenté
passerelle éteinte serait **perdu** au lieu d'être mis en attente — l'écran de réglages le dit en
toutes lettres.

**Redéployer ensuite** : les variables ne sont lues qu'au déploiement.

### Étape 8 — Connecter le téléphone

**Sur le site déployé**, jamais depuis `localhost` — sinon le webhook pointerait vers le poste de
développement et aucun accusé ne reviendrait.

1. Réglages → **WhatsApp**
2. **« Initialiser l'instance »** — crée l'instance et y enregistre l'adresse du webhook
3. **« Connecter WhatsApp »** — un QR s'affiche
4. Téléphone de la station : **WhatsApp → ⋮ → Appareils connectés → Connecter un appareil**, scanner

Le badge passe au vert **tout seul** (sondage toutes les 3 s tant qu'un QR est affiché) : un QR
expire en moins d'une minute. La ligne « Webhook » doit afficher **« Jeton vérifié »** ; sinon,
**« Réenregistrer le webhook »** — un clic, session ouverte, sans délier le téléphone.

### Étape 9 — Vérifier toute la chaîne

```powershell
powershell -ExecutionPolicy Bypass -File evolution\check-gateway.ps1 `
  -BaseUrl  https://rclmc-wa.tail6ac334.ts.net `
  -ApiKey   <EVOLUTION_API_KEY> `
  -Instance rclmc `
  -AppUrl   https://<domaine-de-l-application>
```

Puis **envoyer un vrai message** et vérifier qu'il atteint **« Remis »** : franchir « En attente »
est la seule preuve que la boucle est fermée.

### Étape 10 — Désactiver l'expiration de la clé ⚠️

**Console Tailscale → Machines → `rclmc-wa` → ⋯ → Disable key expiry.** Un clic, définitif. Sans lui,
le nœud se déconnecte au bout de quelques mois et **les envois s'arrêtent sans aucun avertissement** —
c'est l'oubli qui se paie le plus cher, parce qu'il survient quand plus personne ne fait le lien.

---

## 6. Les pannes traversées, et ce qu'elles ont appris

Cette partie est la plus utile du fichier. Quatre de ces pannes sont **propres à ce projet** et
n'existent dans aucun des documents antérieurs.

### 6.1 La fonction s'écroulait au chargement — imports sans extension `.js` *(commit `635b222`)*

`/api/whatsapp/status` rendait une 500. Pas une erreur applicative : `FUNCTION_INVOCATION_FAILED`,
la page d'erreur de l'hébergeur en texte brut. **La fonction ne démarrait pas.**

Le projet est en `"type": "module"`. Le résolveur ESM de Node — celui qui charge la fonction chez
l'hébergeur — **n'invente pas** l'extension d'un import relatif :

```
import { handleWhatsApp } from '../_lib/router';
→ ERR_MODULE_NOT_FOUND: Cannot find module '/var/task/api/_lib/router'
```

Le défaut ne pouvait se voir **qu'en production** : `tsx` (poste de développement) résout
l'extension seul, `vite` aussi, `tsc --noEmit` accepte les deux écritures en
`moduleResolution: "bundler"`, et un `esbuild --bundle` local inline tout. **Quatre outils qui disent
que tout va bien, un cinquième qui refuse de charger le fichier.**

→ Tous les imports du dossier `api/` portent leur `.js`, et
[`imports.test.ts`](api/_lib/imports.test.ts) relit le graphe entier (`api/**` + `server.ts`).

**Au passage** : le diagnostic affiché envoyait au mauvais endroit. Une réponse non-JSON avait deux
causes — route **absente** (l'hébergeur rend la page HTML de l'application) et fonction **présente
qui plante** (page d'erreur, 5xx) — et l'écran annonçait la première dans les deux cas, envoyant
revérifier les variables d'environnement, c'est-à-dire précisément là où le défaut n'était pas.

### 6.2 Toutes les routes répondaient « Route inconnue » *(commit `5a5d43a`)*

```
404  { "error": "Route inconnue : /api/whatsapp/" }
```

L'adaptateur lisait `req.query.path`, le paramètre que l'hébergeur est censé extraire du nom de
fichier `[...path]`. **Il arrive vide en production** : la fonction est bien invoquée pour
`/api/whatsapp/status`, le segment n'est simplement jamais injecté. Le chemin valait donc `''` pour
`status`, pour `outbox`, pour `webhook` — pour tout.

Encore un défaut que le développement ne pouvait pas montrer : `server.ts` découpe `req.path`
lui-même et n'a jamais eu besoin de ce paramètre.

→ Les deux adaptateurs lisent maintenant la même chose — **l'URL de la requête, qui est toujours
là** — et le paramètre ne sert plus que de repli.
[`routePath.test.ts`](api/_lib/routePath.test.ts) fige les deux conventions.

### 6.3 La file d'attente existait, mais le poste ne la voyait pas *(commit `c25e7c5`)*

Deux valeurs étaient figées au **chargement** du module `store.ts`. En ESM, les imports sont évalués
**avant** le corps du fichier qui les importe : le `dotenv.config()` de `server.ts` tournait donc
après, et la persistance se déclarait indisponible alors que le `.env` était parfaitement renseigné.

Le symptôme n'était pas « ça ne marche pas », c'était pire : plus de journal, et surtout **plus de
file d'attente** — donc tout message émis passerelle éteinte perdu, silencieusement, alors que c'est
exactement ce que la file existe pour empêcher. Chez l'hébergeur le défaut ne se voyait pas (les
variables y sont posées avant le chargement de la fonction) : le genre de panne qui n'apparaît
qu'une fois installée sur le poste de la station.

→ Lecture **paresseuse**, comme le fait déjà `gatewayEnv()`.

### 6.4 Le contrôle des montages concurrents ne contrôlait rien *(commit `cdbd1b1`)*

Sous Windows, `docker.exe` réanalyse ses arguments et **avale les guillemets doubles** : le gabarit
`{{if eq .Type "volume"}}` arrivait amputé au moteur de gabarit. Chaque conteneur était donc ignoré,
et le contrôle annonçait « aucun montage concurrent » **sans avoir rien regardé**.

Il visait de toute façon la mauvaise chose. Le danger n'est pas qu'une autre passerelle tourne sur le
poste — l'école tourne sur ce poste, et la cohabitation est saine. Le danger, c'est qu'un autre
conteneur monte **nos volumes**, donc la même session WhatsApp. On compare désormais les volumes, pas
les noms. *Signaler un simple voisin était un faux signalement — et un faux signalement apprend à
ignorer le rapport.*

### 6.5 `tailscale funnel status` ment — le piège le plus coûteux *(hérité, `SESSION-WHATSAPP.md` §5.1)*

`# Funnel on: https://…` affiché, certificat TLS obtenu, aucune erreur nulle part — et l'adresse ne
résolvait nulle part. L'attribut `funnel` n'était pas accordé par les ACL : le fichier de
configuration **local** s'applique quoi qu'il arrive, mais le plan de contrôle refuse silencieusement
de publier l'enregistrement DNS public. Seul `tailscale status --json` fait foi.

### 6.6 Le webhook pointait encore vers la machine de développement *(hérité, §5.2)*

Le webhook est stocké **sur la passerelle**, pas dans l'application : il survit aux déménagements et
continue de pointer vers l'ancienne adresse. Les messages partaient, **aucun accusé ne revenait**,
les statuts restaient bloqués sur « En attente » — sans explication.

### 6.7 Le jeton n'était plus le même des deux côtés *(hérité, §10.3)*

Même famille, autre visage : l'adresse du webhook est juste, mais le **jeton** que la passerelle
envoie n'est plus celui que l'application attend. Chaque événement refusé en 401, tout a l'air
normal, et l'écran affichait « La passerelle est prête ». Correctif d'exploitation en un clic :
**Réenregistrer le webhook**.

### 6.8 « Ça marche depuis le poste » ne prouve rien *(hérité, §10.4)*

Sur la machine qui héberge la passerelle — et sur **tout** membre du tailnet — MagicDNS résout le nom
vers l'IP **tailnet** (`100.x`). La requête ne passe alors jamais par le Funnel : **elle réussit même
si le chemin public est complètement cassé.** Le seul test qui tranche est une requête depuis un
réseau tiers. Ici, la preuve est venue de l'application hébergée, qui est hors du tailnet.

### 6.9 Une troncature silencieuse, trouvée en chemin *(commit `635b222`)*

Les journaux du déploiement montraient deux 400 Supabase à chaque chargement : des tables triées sur
`created_at`, colonne qu'elles n'ont pas. Le repli qui rattrapait ces 400 était **pire que le
défaut** : il retombait sur `dbSelect`, qui ne pagine pas — donc exactement le plafond de 1000 lignes
que `dbSelectAll` existe pour contourner. Passé le millier de lignes, des bons disparaissaient de
l'écran Clients sans que rien ne le signale.

---

## 7. Diagnostic — dans quel ordre, et ce qui ne prouve rien

[`check-gateway.ps1`](evolution/check-gateway.ps1) fait sept contrôles, dans l'ordre où ils dépendent
les uns des autres. Chaque échec porte la manœuvre qui le corrige.

| # | Contrôle | Ce qu'un échec veut dire |
| --- | --- | --- |
| 1 | La passerelle répond | Poste éteint, Docker arrêté, ou Funnel non publié |
| 2 | La clé API est acceptée | `EVOLUTION_API_KEY` ≠ `AUTHENTICATION_API_KEY` |
| 3 | L'instance existe, session connectée | Instance à créer, ou QR à rescanner |
| 4 | Le webhook est déclaré vers le **bon** domaine | Piège 6.6 — « Réenregistrer le webhook » |
| 5 | L'endpoint webhook répond **401 sans jeton** | La route n'est pas déployée, ou n'est pas protégée |
| 6 | Le **jeton** que la passerelle envoie est celui attendu | Piège 6.7 — la panne la plus muette du montage |
| 7 | La clé du nœud Tailscale n'expire pas bientôt | Étape 10 non faite |

Le contrôle 6 rejoue un appel authentique vers l'application avec le jeton que la passerelle utilise
réellement, sur un **événement inconnu que la route ignore** : rien n'est écrit, seule
l'authentification est mise à l'épreuve — et l'opérateur n'a besoin de connaître aucun secret.

**Les tests du code**, à lancer avant tout déploiement :

```powershell
npx tsx api/_lib/imports.test.ts     # extensions ESM — panne visible en production seulement
npx tsx api/_lib/routePath.test.ts   # lecture du chemin sous les deux conventions
npx tsx src/lib/rappels.test.ts      # alertes, numéros, modèles
npm run lint                         # tsc --noEmit
```

---

## 8. L'exploitation au quotidien

| Statut affiché | Ce qu'il veut dire |
| --- | --- |
| **En attente** | La passerelle était injoignable — le message repartira **tout seul**. *Ce n'est pas un échec* |
| **Envoyé** | La passerelle l'a pris en charge |
| **Remis** | Arrivé sur le téléphone du client |
| **Lu** | Ouvert |
| **Échec** | Numéro invalide, ou sans compte WhatsApp |

| Symptôme | Cause | Geste |
| --- | --- | --- |
| Les statuts restent sur « En attente » alors que les messages arrivent | Webhook périmé ou jeton divergent | Réglages → WhatsApp → **Réenregistrer le webhook** |
| L'écran nomme une **variable ignorée** | `EVOLUTION_WEBHOOK_URL` recopiée d'un `.env` local | La retirer chez l'hébergeur, redéployer |
| « Passerelle injoignable » | Poste éteint / en veille / hors ligne | Rallumer ; les messages en attente repartent seuls |
| Session fermée sans raison | Le téléphone est resté trop longtemps hors ligne | Rescanner le QR (le téléphone doit se connecter à Internet de temps en temps) |

**Un numéro banni par WhatsApp l'est sans recours** : ni support, ni recours. C'est pourquoi rien
n'accélère jamais la temporisation, et pourquoi aucun envoi ne part sans que son texte ait été vu.

---

## 9. Appliquer ce montage à un autre projet

### 9.1 Les trois décisions à prendre AVANT

**Sur quel poste ?** Sur celui de l'organisation cliente, **jamais sur celui du développeur**. Chaque
organisation héberge sa propre passerelle, avec son propre nœud et son propre numéro : le poste du
développeur peut rester éteint en permanence. Ce choix tombe juste parce que le poste du client est
**déjà allumé** pendant les heures d'ouverture — c'est celui qui encaisse et saisit.

**Quel numéro ?** Un numéro **dédié**, différent de tout autre projet — une instance lie **un**
téléphone — et surtout pas le portable personnel du gérant.

**La contrepartie est-elle acceptable ?** Poste éteint = aucun message, sans alerte. Si non :
Railway, 7–10 $/mois, bascule en 20 minutes.

### 9.2 Ce qui se refait, et ce qui ne se refait pas

| | Même tailnet, autre poste | Même tailnet, même poste |
| --- | --- | --- |
| Compte Tailscale, MagicDNS, HTTPS, ACL | **non** | **non** |
| Clé d'authentification | réutilisable si valide | réutilisable si valide |
| Nom de nœud distinct (`TAILSCALE_HOSTNAME`) | **oui** | **oui** |
| `name:` Compose distinct | non | **oui — le plus grave** |
| Port local distinct | non | **oui** |
| Numéro WhatsApp distinct | **oui** | **oui** |
| Clé API + mot de passe Postgres distincts | **oui** | **oui** |
| `keep-alive.ps1` | **oui** | déjà fait |
| Désactiver l'expiration de la clé | **oui** | **oui** |

### 9.3 Le prompt

Remplir le bloc de contexte, puis donner **tout ce qui suit la ligne de séparation** à Claude Code.
Ce prompt remplace [`whatsapp_promp.md`](whatsapp_promp.md) : il intègre les quatre pannes de la
partie 6 (6.1 à 6.4) qui n'y figuraient pas, et qui ne se voient **qu'en production**.

```
Projet                  : <nom>
Framework               : <ex. React 19 + Vite, routes API en fonctions serverless>
Hébergeur               : <ex. Vercel>
Domaine public          : <ex. mon-app.vercel.app>
Base de données         : <ex. Supabase / Postgres>
OS du poste hôte        : <ex. Windows 11 + Docker Desktop>
Langue du code          : <ex. commentaires en français>
Qui reçoit les messages : <ex. les clients du lavage, depuis le numéro de la station>
Passerelle existante ?  : <non | oui — tailnet <tailXXXX.ts.net>, nœud <nom>, port local <8081>>
```

---

# PROMPT

Tu vas ajouter à ce projet l'envoi de messages **WhatsApp** depuis le numéro de téléphone de
l'organisation, **sans WhatsApp Business API** (pas de modèle à faire approuver, pas de frais par
message) et **sans louer de serveur**.

Avant d'écrire une ligne, lis les conventions du dépôt (nommage, langue des commentaires, style des
fichiers existants) et respecte-les. Explique tes décisions dans les en-têtes de fichier : ce
montage a des règles contre-intuitives, et un fichier qui ne dit pas pourquoi se fera « simplifier »
dans six mois.

## 1. La contrainte d'architecture — la comprendre avant de coder

Une session WhatsApp Web (moteur **Baileys**) maintient une connexion **ouverte en permanence**.
Un hébergeur serverless éteint la fonction entre deux requêtes. **Les deux modèles sont
incompatibles.** La passerelle doit donc vivre sur une machine qui reste allumée, et l'application la
pilote en HTTPS :

```
Application (serverless)  ──HTTPS──►  passerelle Evolution (poste allumé)  ──►  WhatsApp
Application (webhook)     ◄──HTTPS──  passerelle Evolution                 ◄──  statuts
```

**Ne propose pas la WhatsApp Business API « au cas où »** : elle impose des modèles à faire approuver
et une facturation par message — tout ce que ce montage évite.

## 2. Pile imposée

- **Evolution API**, image **épinglée** (`evoapicloud/evolution-api:v2.3.7`) — jamais `latest` : une
  montée de version silencieuse casse la session et impose un nouveau scan du QR ;
- **Postgres 16-alpine** pour la persistance de la passerelle ;
- **sidecar Tailscale** en mode userspace, qui publie la passerelle par **Funnel** sur
  `https://<nœud>.<tailnet>.ts.net` — pas de domaine, pas de VPS, 0 DA/mois.

## 3. Partie A — Infrastructure

### `<infra>/docker-compose.funnel.yml`

Trois services. Points non négociables :

- `name: <projet>-wa` **en tête du fichier**. Compose nomme sinon le projet d'après le dossier : deux
  dépôts ayant chacun un dossier `evolution/` partageraient **les mêmes volumes**, donc la même
  session WhatsApp et la même base. **Ne jamais modifier ce nom sur une installation en service** —
  les volumes existants deviendraient orphelins et le QR serait à rescanner.
- Port publié sur **`127.0.0.1` uniquement**, et **différent** de tout autre montage du poste
  (8081, 8082…). Le trafic public passe exclusivement par le Funnel.
- `SERVER_URL: ${TUNNEL_PUBLIC_URL}` — cette valeur est estampillée dans le champ `server_url` de
  chaque webhook et l'application la compare **au caractère près**. Un slash final en trop d'un seul
  côté ⇒ tous les accusés de remise en 403.
- `DEL_INSTANCE: "false"` — une instance déconnectée ne doit **pas** être supprimée, sinon une simple
  coupure imposerait de tout reconfigurer.
- `WEBHOOK_GLOBAL_ENABLED: "false"` — les webhooks sont déclarés **par instance**, depuis
  l'application, avec un jeton.
- `DATABASE_SAVE_DATA_NEW_MESSAGE` / `..._MESSAGE_UPDATE` à `"false"` : le journal vit dans la base
  du projet, inutile de dupliquer chaque message sur le disque du poste.
- Trois volumes nommés : la **session** (`/evolution/instances`), la base, et **l'état Tailscale**
  (`/var/lib/tailscale`). Sans ce dernier, le nœud se réenregistre à chaque démarrage et reçoit un
  nom suffixé : **l'adresse publique change**.
- Monter le **dossier** de configuration Tailscale (`./tailscale:/config:ro`), jamais le fichier
  seul : un bind-mount de fichier unique empêche le conteneur de voir les modifications.
- Healthcheck `pg_isready` + `depends_on: condition: service_healthy`, sinon Evolution démarre en
  erreur avant que la base accepte les connexions.
- `TS_USERSPACE: "true"` et `TS_EXTRA_ARGS: --accept-dns=false` — indispensables sous Docker Desktop.

### `<infra>/tailscale/funnel.json`

Proxy `/` vers le port interne de la passerelle, `AllowFunnel` sur `${TS_CERT_DOMAIN}:443`.
**Aucun commentaire dans ce fichier** : Tailscale le désérialise. Les explications vont dans un
`README.md` à côté.

### `<infra>/.env.example`

Cinq variables, avec **pour chacune si elle se réutilise d'un projet à l'autre** : seule
`TAILSCALE_AUTHKEY` se reprend (c'est le sens de « Reusable »). `TAILSCALE_HOSTNAME`,
`TUNNEL_PUBLIC_URL`, `EVOLUTION_API_KEY` et `POSTGRES_PASSWORD` doivent être neuves — et dis
**pourquoi**, parce que deux d'entre elles cassent en silence.

### `<infra>/start-gateway.ps1` (ou l'équivalent de l'OS du poste)

Il doit **refuser de toucher au moteur de conteneurs tant que le `.env` est incomplet, en nommant la
ligne manquante**, puis vérifier les deux pannes qui *ressemblent à une réussite* :

1. **le nom de nœud suffixé** (`<nom>-1`) — l'adresse publique n'est plus celle déclarée ;
2. **le Funnel non accordé** par les ACL (voir piège 6.5 ci-dessous).

⚠️ **Si tu inspectes les conteneurs avec un gabarit :** sous Windows, `docker.exe` réanalyse ses
arguments et **avale les guillemets doubles**. Un gabarit contenant `"volume"` arrive amputé et le
moteur de gabarit échoue — chaque conteneur est alors ignoré et **le contrôle annonce « rien à
signaler » sans avoir rien regardé**. N'utilise aucun guillemet interne dans un gabarit, et vérifie
que le contrôle voit réellement quelque chose avant de déclarer qu'il ne voit rien.

Et vise la bonne chose : le danger n'est pas qu'une autre passerelle tourne sur le poste — la
cohabitation est saine — mais qu'un autre conteneur monte **nos volumes**. Compare les **volumes**,
pas les noms. Un faux signalement apprend à ignorer le rapport.

### `<infra>/check-gateway.ps1`

Sept contrôles qui **ne modifient rien**, chacun portant la manœuvre qui le corrige : passerelle
joignable, clé API acceptée, session connectée, webhook déclaré vers le bon domaine, endpoint webhook
répondant **401 sans jeton**, **jeton réellement identique des deux côtés**, et expiration de la clé
du nœud. Le sixième rejoue un appel authentifié vers l'application sur un **événement inconnu que la
route ignore** : rien n'est écrit, seule l'authentification est éprouvée.

Le script doit **avertir du faux positif** : depuis le poste hôte et tout membre du tailnet, la
résolution passe par l'IP interne et réussit même si le chemin public est mort.

### `<infra>/keep-alive.ps1`

Rapport par défaut, `-Apply` pour agir : désactiver la mise en veille (elle suspend les conteneurs et
fait tomber la session) et garantir le démarrage automatique du moteur de conteneurs après une
coupure de courant. **Signaler sans les modifier** les réglages qui appartiennent à l'utilisateur
(ouverture de session automatique, heures d'activité des mises à jour).

## 4. Partie B — Intégration applicative

### 4.1 Les routes, écrites UNE SEULE FOIS

Si le projet a deux façons de servir les routes (serveur de développement + fonctions serverless),
**écris-les dans un module neutre** qui reçoit `{ path, method, body, headers, host, proto }` et rend
`{ status, body }`. Les deux adaptateurs ne font que traduire. Les dupliquer garantirait qu'elles
divergent, et une divergence se paie en accusés refusés en 401 — panne parfaitement muette.

Six routes :

```
POST /api/whatsapp/send           envoi
POST /api/whatsapp/webhook        accusés de remise
GET  /api/whatsapp/status         état de session, pour l'écran de réglages
POST /api/whatsapp/session        setup | connect | restart | logout
GET  /api/whatsapp/outbox         comptage des messages en attente
POST /api/whatsapp/outbox/flush   vidage de la file
```

⚠️ **Lis le chemin sur l'URL de la requête, pas sur un paramètre de routage.** Si tu utilises une
route attrape-tout (`[...path]`), le segment **arrive vide en production** chez certains hébergeurs :
la fonction est bien invoquée, mais le paramètre n'est jamais injecté, et **toutes** les routes
tombent sur « Route inconnue ». L'URL, elle, est toujours là. Garde le paramètre en repli, et écris
un test qui fige les deux conventions.

⚠️ **Si le projet est en `"type": "module"`, tout import relatif doit porter son extension `.js`.**
Le résolveur ESM de Node — celui qui charge la fonction chez l'hébergeur — ne l'invente pas :
`ERR_MODULE_NOT_FOUND`, la fonction ne démarre pas, l'hébergeur rend une page d'erreur en texte brut.
**Aucun outil de développement ne le signale** (`tsx`, `vite`, `tsc --noEmit` en
`moduleResolution: "bundler"`, un bundle `esbuild` local : les cinq disent que tout va bien). Écris un
test qui **relit le graphe d'imports** du dossier serveur.

⚠️ **Un fichier de test ne doit pas vivre dans un dossier publié comme route.** Chez la plupart des
hébergeurs, tout ce que `api/` contient hors des dossiers préfixés `_` devient une fonction
accessible à tous. Range-les sous `_lib/`.

### 4.2 Les variables, côté serveur uniquement

Aucune ne porte le préfixe public du bundler (`VITE_`, `NEXT_PUBLIC_`, `PUBLIC_`…) : ce préfixe
publierait la clé de la passerelle dans le navigateur de chaque visiteur — le numéro WhatsApp de
l'organisation offert à qui la lit.

⚠️ **Lis `process.env` À L'APPEL, jamais au chargement du module.** En ESM, les imports sont évalués
**avant** le corps du fichier qui les importe : un `dotenv.config()` fait dans le point d'entrée
tourne **après** que le module ait figé des valeurs vides. Chez l'hébergeur le défaut est invisible
(les variables y sont posées avant le chargement), il n'apparaît **que sur le poste** — et ce qu'il
casse, c'est la persistance, donc la file d'attente : tout message émis passerelle éteinte serait
perdu, silencieusement.

**L'adresse du webhook se DÉDUIT du domaine sur lequel l'application répond**, jamais d'une variable.
Deux motifs, vécus chacun deux fois :

- le webhook est stocké **sur la passerelle**, pas dans l'application : il survit aux déménagements
  et continue de pointer vers l'ancienne adresse — les messages partent, aucun accusé ne revient,
  et rien nulle part ne signale d'erreur ;
- recopier un `.env` local en bloc vers l'hébergeur emporte `http://host.docker.internal:3000`.

Donc : en production, **toute valeur locale ou non-HTTPS est écartée, et NOMMÉE dans le diagnostic**.
Une variable mal recopiée ne casse plus rien ; elle se voit.

Prévois aussi un repli : l'adresse de la passerelle s'écrit à deux endroits qui doivent rester
identiques au caractère près (le `SERVER_URL` du conteneur et la variable de l'application). Sur le
poste de développement, fais lire la seconde à défaut de la première : une seule valeur à tenir juste.

### 4.3 Le client de la passerelle — un seul fichier détient la clé

- Erreur dédiée portant la **cause système** (`ECONNRESET`, `ENOTFOUND`, `ETIMEDOUT`, `HTTP_401`…),
  l'hôte visé, un booléen « injoignable », et **la manœuvre à faire** — jamais la clé. Tant que tout
  échec réseau rend la même phrase, rien n'est diagnosticable : c'est le changement le plus rentable
  du montage, fais-le en premier.
- **L'idempotence est déclarée appel par appel, jamais déduite du verbe HTTP.** `/instance/create`
  est un POST parfaitement idempotent — et c'est le bouton sur lequel la réception tombe.
  `/message/sendText` ne l'est pas : un message posté deux fois chez un client est **pire** qu'un
  envoi manqué, que la file rattrape de toute façon. **`/message/sendText` n'est JAMAIS rejoué.**
- Deux reprises courtes (≈250 ms, 900 ms) sous un **budget de temps**, pas un seuil de délai fixe :
  une demande de QR attend 30 s et ne doit pas être écartée de la reprise alors qu'elle en a le temps.
- Une réponse HTTP, **même en erreur**, prouve que la passerelle est joignable : ce n'est pas le cas
  « poste éteint », et la file d'attente ne doit pas s'en saisir comme tel.
- `createInstance` doit **avaler « already in use »** : c'est le résultat attendu au deuxième appel,
  et ce bouton doit rester cliquable sur une session déjà ouverte pour corriger un webhook périmé.

### 4.4 Le journal et la file — deux tables, jamais une

| Table | Ce qu'elle porte |
| --- | --- |
| `whatsapp_messages` | Le **journal** : destinataire, **texte réellement envoyé**, avancement (`queued → sent → delivered → read → failed`), identifiant côté passerelle |
| `whatsapp_outbox` | La **file** : ce qui n'a pas pu partir, **avec son texte**, tentatives, dernière erreur |

Même identifiant dans les deux : un message rattrapé se retrouve dans le journal au même endroit,
jamais en double. Écriture **par le serveur avec la clé de service** — le webhook n'a aucune session
utilisateur et ne peut pas écrire sous RLS. Si la clé manque, l'envoi direct continue de fonctionner
mais **l'application le DIT** au lieu de le taire.

**La file n'est pas un raffinement.** Le poste sera éteint un jour ou l'autre : sans elle, chaque
message émis pendant ce temps est purement perdu, et un rappel automatique ne laisse rien derrière
lui — personne ne revient l'envoyer à la main.

Trois règles de reprise :

1. **une passerelle injoignable ne consomme JAMAIS de tentative** — sinon un week-end hors ligne
   épuiserait le compteur de toute la file et ferait abandonner des messages valides ;
2. **un refus propre au destinataire en consomme une**, 3 au maximum, puis abandon motivé ;
3. **au-delà de 7 jours, le message est périmé** : un rappel d'une semaine peut être devenu faux.

Un numéro invalide est refusé **avant** la mise en file, jamais découvert trois jours plus tard.

### 4.5 Le noyau partagé — temporisation et numéros

Un module **importé par le navigateur ET par le serveur** : normalisation des numéros (un numéro
écrit différemment dans deux fiches doit désigner le même destinataire, sinon le client reçoit deux
fois le même rappel), temporisation, remplissage des modèles.

**Temporisation anti-bannissement** : 3 à 7 s **tirées au hasard** entre deux destinataires (un
intervalle régulier fait robot), un plafond de destinataires par appel, un plafond par vidage.
**Le vidage de la file respecte exactement la même cadence** — c'est même là qu'elle compte le plus :
le rattrapage traite des lots accumulés, c'est le moment où l'on ressemble le plus à un robot.

**Ne duplique jamais ces constantes** : une divergence ici coûte le numéro, et un compte WhatsApp
banni l'est **sans recours**.

**Budget de temps par requête** : une fonction serverless est coupée net à son délai maximal. Envoie
tant qu'il reste du temps, et **mets le reste en FILE plutôt que d'accélérer** ou d'être coupé en
plein vol. Déclare le délai maximal dans la configuration de l'hébergeur.

### 4.6 Qui déclenche le vidage

En serverless, rien ne tourne entre deux requêtes : c'est **l'application ouverte dans le navigateur**
qui déclenche le rattrapage. Ce n'est pas un pis-aller — le poste hôte a l'application ouverte toute
la journée, et c'est le même poste qui héberge la passerelle.

Cinq règles pour qu'il ne devienne pas nuisible : il **compte** des lignes (route dédiée, aucun appel
à la passerelle) ; il ne vide que s'il reste quelque chose ; un verrou empêche deux vidages
concurrents ; il **s'arrête définitivement** sur 401/403 et sur « route non déployée » ; son premier
passage est différé de quelques secondes, parce qu'il est remonté à chaque navigation. Il n'affiche
rien tant que la file est vide.

### 4.7 L'écran de réglages — le montage doit être utilisable sans terminal

C'est la pièce qui fait la différence à l'usage. Il doit permettre de **connecter le téléphone de
bout en bout** : initialiser l'instance, afficher le QR, le voir passer au vert **tout seul** (sondage
court **uniquement** tant qu'un QR est affiché — un QR expire en moins d'une minute, et cet écran
reste parfois ouvert des heures).

Ce qu'il **n'affiche jamais** : clé API, jeton de webhook, URL complète de la passerelle. Hôte seul,
nom d'instance masqué. Il est ouvert devant du personnel administratif et visible dans l'onglet
réseau du navigateur.

Deux règles qui viennent de pannes réelles :

- **« Réenregistrer le webhook » doit être disponible SESSION OUVERTE.** C'est exactement le cas qui
  en a besoin. S'il n'existe que dans la branche « déconnecté », le seul contournement est de délier
  le téléphone : casser une session saine pour corriger une URL.
- **N'annonce « prête » que si le webhook est RÉELLEMENT vérifié.** Constater que la variable existe
  côté serveur ne dit rien de ce que la passerelle enverra : les deux divergent dès qu'on régénère la
  variable sans réenregistrer le webhook. **Relis le webhook enregistré sur la passerelle** et
  distingue *Non configuré*, *Adresse périmée*, *Jeton divergent*, *Jeton vérifié*.

Affiche aussi : le nombre de messages en attente avec un bouton de vidage manuel, la variable
d'environnement **écartée** s'il y en a une (avec la phrase qui dit quoi faire), et un avertissement
explicite si la persistance n'est pas configurée.

### 4.8 Le garde-fou des déploiements de prévisualisation

Il n'y a qu'une passerelle, qu'une instance, qu'un emplacement de webhook — et le webhook est stocké
**sur la passerelle**. Les variables étant partagées entre production et prévisualisation, chaque
déploiement de branche parle à la même passerelle. **Refuse `setup` et `logout` depuis une
prévisualisation** (409, avec l'explication) : le premier détournerait les accusés de remise de la
production sans qu'aucune erreur ne le signale, le second délierait le téléphone. `connect` et
`restart` restent autorisés.

### 4.9 L'écran d'envoi

- Ne propose **jamais** d'envoyer sans avoir montré le texte.
- **Écris le premier jet à la place de l'utilisateur** : devant un champ vide on écrit vite et mal —
  pas de salutation, pas de nom d'organisation, pas de moyen de répondre. Un client qui reçoit un
  rappel sec d'un numéro inconnu bloque le numéro, et un numéro bloqué par plusieurs personnes finit
  banni. Le texte proposé est modifiable.
- Modèles avec jetons `{client}`, `{vehicule}`… Un jeton **inconnu reste tel quel** plutôt que
  remplacé par du vide : mieux vaut voir `{truc}` à la relecture que d'envoyer une phrase amputée.
- Trois issues distinctes, jamais confondues : **envoyé**, **en attente** (la passerelle était
  injoignable — ce n'est **pas** un échec, ne l'affiche pas en rouge), **échec**.
- Si les alertes de rappel font partie du besoin : **déduis-les**, ne les stocke pas. Une alerte est
  une lecture de l'historique à la lumière des délais du jour ; la stocker imposerait de tout
  recalculer à chaque changement de délai et laisserait des alertes fantômes. Stocke seulement ce que
  l'utilisateur en a fait, avec un identifiant **déterministe** pour que deux postes n'en fassent pas
  deux lignes. Et ne rappelle que sur le **dernier** passage : sinon un client fidèle reçoit
  cinquante rappels.

### 4.10 Sauvegarde

Si le projet a un mécanisme de sauvegarde par table, **déclare les deux tables dedans** — la file
comprise : une restauration faite après une panne de poste doit rendre les messages qui n'étaient pas
encore partis.

## 5. Partie C — Sécurité, non négociable

- Le navigateur ne parle **jamais** à la passerelle. Une seule route serveur détient la clé.
- Le webhook exige **DEUX contrôles** : le `Bearer`, **et** le champ `server_url` du corps, comparé
  au caractère près à l'adresse déclarée. Sans jeton ⇒ **401**.
- Les événements inconnus sont **acceptés et ignorés** : c'est ce qui permet au script de diagnostic
  d'éprouver l'authentification sans rien écrire.
- Aucun secret dans les réponses d'API, les journaux, ou l'interface.
- `.env` de l'infrastructure couvert par `.gitignore`, et son transport prévu **explicitement** lors
  d'un déménagement de poste.

## 6. Partie D — Pièges connus, à respecter dès le départ

Les quatre premiers ne se voient **qu'en production**, et sont détaillés plus haut :

| # | Piège | Où le traiter |
| --- | --- | --- |
| 6.1 | Imports ESM sans extension ⇒ la fonction ne **démarre** pas | §4.1 |
| 6.2 | Chemin lu sur le paramètre de routage ⇒ **toutes** les routes en 404 | §4.1 |
| 6.3 | `process.env` lu au chargement ⇒ **pas de file d'attente**, en silence | §4.2 |
| 6.4 | Gabarit `docker inspect` avec guillemets sous Windows ⇒ le contrôle ne contrôle rien | §3 |

Et les six hérités de la première installation :

- **6.5 — `tailscale funnel status` ment.** Sans l'attribut `funnel` accordé par les ACL, le conteneur
  démarre, **obtient même son certificat TLS** et affiche `# Funnel on: https://…` — cet affichage
  vient du fichier local. Le plan de contrôle refuse silencieusement de publier le DNS public.
  **Seule vérification qui fasse foi** : `tailscale status --json` doit contenir `funnel` **et**
  `funnel-ports`.
- **6.6 — Le webhook survit aux déménagements** et pointe vers l'ancienne adresse. Prévois le bouton
  qui le réécrit, et un contrôle qui le compare au domaine courant.
- **6.7 — Le jeton peut diverger** sans que rien ne le signale : messages partis, accusés refusés en
  401, écran qui affiche « prête ».
- **6.8 — « Ça marche depuis le poste » ne prouve rien** : depuis le poste hôte et tout membre du
  tailnet, la résolution passe par l'IP interne et réussit même si le chemin public est mort. Le seul
  test qui tranche vient d'un **réseau tiers**.
- **6.9 — Le mot de passe Postgres ne peut plus changer** : il n'est appliqué qu'à l'initialisation du
  volume. Le modifier ensuite ⇒ la base rejette la connexion et la passerelle ne démarre plus.
- **6.10 — Déménager : supprimer l'ancien nœud D'ABORD.** Tailscale n'attribue jamais deux fois le
  même nom : tant que l'ancien existe, le nouveau devient `<nom>-1` et **l'adresse publique change**.
  Oublier cette étape *ressemble* à une réussite.

## 7. Partie E — Étapes manuelles à réclamer

Tu ne peux pas les faire. **Arrête-toi et demande-les explicitement**, avec les valeurs exactes à
reporter :

1. Compte **Tailscale** gratuit ; relever le **nom du tailnet** dans **DNS**. *(À sauter si un
   tailnet existe déjà : un seul compte suffit pour tous les projets.)*
2. **DNS → MagicDNS actif**, puis **Enable HTTPS**.
3. **Access controls** — `nodeAttrs` **à l'intérieur** de la politique existante :
   ```
   "nodeAttrs": [
     { "target": ["autogroup:member"], "attr": ["funnel"] },
   ],
   ```
   Le fichier ne peut contenir **qu'un seul** objet de haut niveau : le coller *au-dessus* donne
   `invalid character '{' after top-level value`. Tailnets récents : `grants` ; anciens : `acls` —
   **jamais les deux**. `autogroup:member` couvre **tout** nouveau nœud : cette étape ne se refait
   pas d'un projet à l'autre.
4. **Settings → Keys → Generate auth key**, cochée **Reusable**, **jamais Ephemeral**.
5. Après le premier démarrage : **Machines → `<nœud>` → Disable key expiry**. Sans ce clic, le nœud se
   déconnecte au bout de quelques mois et **les envois s'arrêtent sans aucun avertissement**.
6. Renseigner les variables chez l'hébergeur, **puis redéployer** — elles ne sont lues qu'au
   déploiement. **Ne pas définir la variable d'URL de webhook.**
7. Connecter le téléphone **depuis le site déployé**, jamais depuis `localhost`.

`TAILSCALE_HOSTNAME` ne se récupère nulle part : **c'est un nom que l'on choisit**. L'adresse publique
vaut `https://` + ce nom + `.` + le nom du tailnet.

## 8. Critères d'acceptation

Ne déclare la tâche terminée que si **tout** ceci est vérifié, sorties réelles à l'appui :

- [ ] `docker compose config` valide ; images **épinglées** ; trois conteneurs `unless-stopped` ;
      `name:` de projet distinct et port local distinct ;
- [ ] `tailscale status --json` contient **`funnel`** et `funnel-ports` ;
- [ ] le nom obtenu est **exactement** celui attendu, **sans suffixe `-1`** ;
- [ ] l'adresse publique répond en HTTPS **depuis l'extérieur du réseau** (un test local ne prouve
      rien) ;
- [ ] la clé API est acceptée à travers le tunnel ;
- [ ] le webhook est déclaré vers le **domaine de production**, pas vers `localhost` ni
      `host.docker.internal`, et l'endpoint répond **401 sans jeton** ;
- [ ] le **jeton** enregistré sur la passerelle est celui qu'attend l'application (contrôle actif,
      pas une simple présence de variable) ;
- [ ] **les six routes répondent en production** — pas seulement en développement : c'est là que
      vivent les pièges 6.1 et 6.2 ;
- [ ] un message réel atteint **`delivered`** — franchir `queued` est la seule preuve que la boucle
      est complète ;
- [ ] le panneau de réglages connecte le téléphone **de bout en bout, sans terminal** : QR affiché,
      scanné, badge au vert **tout seul**, numéro lié affiché ;
- [ ] le panneau expose **« Réenregistrer le webhook » en session ouverte** et n'annonce pas
      « prête » sans webhook vérifié ;
- [ ] **aucun secret** dans le panneau ni dans `/status` (vérifier l'onglet réseau) ;
- [ ] **passerelle arrêtée, un envoi est MIS EN ATTENTE** et l'interface l'annonce comme tel, jamais
      comme un échec ;
- [ ] **passerelle rallumée, les messages repartent SEULS**, sans action de l'utilisateur, à la même
      cadence qu'un envoi direct ;
- [ ] une passerelle injoignable **ne consomme pas de tentative** ;
- [ ] la persistance fonctionne **sur le poste de développement aussi** (piège 6.3) ;
- [ ] les tests passent, le build de production réussit, et il existe un test qui **relit le graphe
      d'imports** du dossier serveur ;
- [ ] le script de service continu a été exécuté sur le poste hôte ;
- [ ] la documentation créée mentionne **explicitement** la contrepartie : poste éteint = aucun
      message, sans alerte.

## 9. Ce qu'il ne faut pas faire

- Ne **pas** proposer la WhatsApp Business API « au cas où ».
- Ne **pas** utiliser le tag `latest` pour la passerelle.
- Ne **pas** dupliquer les routes, ni les constantes de temporisation, ni l'adresse de la passerelle.
- Ne **pas** rejouer un envoi de message sur une erreur réseau.
- Ne **pas** accélérer la temporisation pour faire tenir un lot dans une requête.
- Ne **pas** annoncer un coût sans le vérifier : le prix affiché d'un hébergeur géré est souvent le
  plancher de l'abonnement, pas la facture d'un service tournant en continu.
- Ne **pas** minimiser la dépendance au poste allumé : c'est le vrai prix de la gratuité, et
  l'utilisateur doit le décider en connaissance de cause.

# FIN DU PROMPT

*(Tout ce qui précède, depuis la ligne de séparation de la partie 9.3, se copie tel quel. Ce qui
suit décrit à nouveau CE projet.)*

---

## 10. Le SQL

Un seul fichier, idempotent, à coller en entier dans l'éditeur SQL :
[`supabase/migrations/2026-08-22_whatsapp_messaging.sql`](supabase/migrations/2026-08-22_whatsapp_messaging.sql).

Il crée `whatsapp_messages` (journal) et `whatsapp_outbox` (file), leurs index — dont
`(status, created_at)` sur la file, parce que le vidage lit **toujours** « les plus anciens en attente
d'abord » —, la RLS (lecture/écriture pour tout compte connecté, la clé de service la contournant),
et ajoute le journal à la publication temps réel pour que les statuts avancent sans recharger la page.

Vérifications après passage :

```sql
select 'messages' as t, count(*) from public.whatsapp_messages
union all
select 'outbox',        count(*) from public.whatsapp_outbox;

select created_at, recipient_name, recipient_phone, status, left(body, 60)
  from public.whatsapp_messages order by created_at desc limit 20;

select created_at, recipient_phone, attempts, last_error
  from public.whatsapp_outbox where status = 'pending' order by created_at;
```

---

## 11. Les commits de ce montage

| Commit | Objet |
| --- | --- |
| `040a18a` | Le client du lavage a ses voitures, et la station sait les rappeler |
| `ce3f893` | La station rejoint le tailnet de l'école au lieu d'en ouvrir un second |
| `c25e7c5` | La file d'attente existait, mais le poste ne la voyait pas |
| `635b222` | La fonction WhatsApp s'écroulait au chargement : ses imports n'avaient pas d'extension |
| `5a5d43a` | Le chemin demandé se lit sur l'URL, plus sur un paramètre que l'hébergeur n'injecte pas |
| `cdbd1b1` | Le contrôle des montages concurrents ne contrôlait rien, en silence |
| `27338aa` | La file d'attente existait, mais le poste ne la voyait pas — suite : la passerelle est en service |

Chaque message de commit porte le raisonnement complet ; `git show <hash>` reste la source la plus
détaillée sur une décision précise.
