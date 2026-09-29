# Ce qu'il vous reste à faire — guide pas à pas

Cette mise à jour apporte six choses. **Cinq fonctionnent dès que le code est
déployé, sans rien faire.** La sixième — l'envoi WhatsApp — demande une mise en
service, et c'est l'essentiel de ce guide.

Lisez la **partie A** (5 minutes, obligatoire), puis la **partie B** seulement si
vous voulez envoyer des messages WhatsApp.

---

## Ce qui est arrivé dans cette mise à jour

| | Ce qui change | À faire |
| --- | --- | --- |
| 1 | **Brigades** — la liste part de la dernière créée vers la plus ancienne | rien |
| 2 | **Achats Carburant** — les boutons d'action suivent le fournisseur ; cuves et volume passent en fin de tableau | rien |
| 3 | **Point de vente** (Cafétéria et Lavage) — le curseur se place tout seul dans la recherche à l'ouverture, et la lâche dès qu'on clique ailleurs | rien |
| 4 | **Clients du Lavage** — chaque client peut avoir **plusieurs voitures** (modèle, marque, plaque facultative, couleur, année, kilométrage) | rien |
| 5 | **Fiche d'intervention** — on cherche le client **par nom ou téléphone**, ses voitures se proposent, et le kilométrage se relève sur place | rien |
| 6 | **Messages clients** (nouvel écran du Lavage) — rappels de lavage / révision et envoi WhatsApp | **partie A + partie B** |

---

# PARTIE A — Obligatoire (5 minutes)

## Étape A1 — Exécuter le script SQL

1. Ouvrez **Supabase** → votre projet → **SQL Editor** → **New query**.
2. Ouvrez le fichier
   [`supabase/migrations/2026-08-22_whatsapp_messaging.sql`](supabase/migrations/2026-08-22_whatsapp_messaging.sql)
   et **collez-le en entier**.
3. Cliquez **Run**.

Le script est **idempotent** : vous pouvez le relancer sans risque.

Il crée deux tables — `whatsapp_messages` (le journal des envois) et
`whatsapp_outbox` (les messages en attente). Il ne touche à **aucune** table
existante et n'efface rien.

> **Les voitures des clients ne demandent aucun SQL.** Elles vivent sur la fiche
> du client, dans les données des parties commerciales. Vos clients existants
> apparaîtront simplement sans véhicule : ajoutez-les au fil des passages.

**Vérification** (facultatif, dans le même éditeur) :

```sql
select 'messages' as t, count(*) from public.whatsapp_messages
union all
select 'outbox',        count(*) from public.whatsapp_outbox;
```

Deux lignes à zéro = c'est bon.

## Étape A2 — Déployer l'application

Poussez / redéployez comme d'habitude. Les points 1 à 5 du tableau sont alors
actifs.

## Étape A3 — Régler les délais de rappel

**Lavage & Réparation → Messages clients → Délais de rappel.**

Deux nombres, **indépendants l'un de l'autre** :

| Réglage | Valeur de départ | Ce qu'il veut dire |
| --- | --- | --- |
| Rappeler un **LAVAGE** après | 30 jours | un client lavé le 1er est rappelé le 31 |
| Rappeler une **RÉPARATION** après | 180 jours | une révision se refait tous les six mois |

Mettre **0** coupe cette nature-là, sans toucher à l'autre.
L'interrupteur « Rappels actifs » coupe tout, **sans perdre** les délais réglés.

> **Comment les alertes sont calculées, en une phrase :** l'échéance part du
> **dernier passage** de chaque véhicule, pour chaque nature. Un client qui lave
> sa voiture toutes les semaines ne reçoit donc **qu'un seul** rappel, jamais un
> par passage.

## Étape A4 — Installer les modèles de message

**Messages clients → onglet Modèles → « Installer les modèles de départ ».**

Trois textes professionnels apparaissent (rappel de lavage, rappel de révision,
véhicule prêt). **Modifiez-les librement** : ce sont vos mots, pas les nôtres.

Les jetons entre accolades — `{client}`, `{vehicule}`, `{kilometrage}`… — sont
remplis automatiquement avec les informations du client et de sa voiture.

---

# PARTIE B — L'envoi WhatsApp

> ## ✅ État au 2026-08-23 — la partie B est FAITE, sauf le scan du QR
>
> La passerelle de la station est **installée, démarrée et jointe depuis
> l'extérieur**. Vérifié, pas supposé :
>
> | Contrôle | Résultat |
> | --- | --- |
> | Nœud Tailscale | `rclmc-wa.tail6ac334.ts.net` — **sans suffixe `-1`** |
> | Attribut `funnel` | accordé par le plan de contrôle |
> | Certificat TLS | obtenu (ACME dns-01) |
> | Passerelle en local | Evolution API 2.3.7 sur `127.0.0.1:8082` |
> | **Joignable depuis l'extérieur** | **oui** — l'application déployée l'atteint, `error: null` |
> | Instance `rclmc` | créée |
> | Webhook | **Jeton vérifié** |
> | Journal + file d'attente | `storageConfigured: true` |
> | Session WhatsApp | **fermée — c'est le seul point restant** |
>
> Le contrôle « joignable depuis l'extérieur » a été fait **par l'application
> hébergée**, qui est hors du tailnet. C'est la seule preuve qui vaille : depuis
> ce poste, MagicDNS résout vers l'IP interne et un `curl` réussit même si le
> chemin public est mort.
>
> **Il vous reste exactement deux gestes**, décrits en [B8](#b8--connecter-le-téléphone)
> et [B10](#b10--désactiver-lexpiration-de-la-clé-) : scanner le QR avec le
> téléphone de la station, et désactiver l'expiration de la clé du nœud
> (elle expire le **2027-02-19**).
>
> Les sections ci-dessous restent la procédure complète — pour un déménagement,
> une réinstallation, ou une seconde station.

## B0 — Lisez ceci avant de commencer

Ce montage envoie depuis **le vrai numéro WhatsApp de la station**, sans passer
par la WhatsApp Business API : **aucun modèle à faire approuver, aucune
facturation par message, 0 DA/mois.**

En échange, **une machine doit rester allumée**. Une session WhatsApp Web garde
une connexion ouverte en permanence ; l'hébergement de l'application, lui,
s'éteint entre deux requêtes. Il n'y a pas de troisième voie : soit on loue un
serveur, soit on utilise un poste qu'on possède déjà.

**Poste éteint, en veille ou sans Internet ⇒ aucun message ne part.** Les envois
sont alors **mis en attente** et repartent seuls au retour — rien n'est perdu —
mais rien ne part tant que le poste dort, et personne n'est prévenu.

Choisissez le poste de la station qui reste allumé toute la journée.

**Il vous faut aussi :**

- **Docker Desktop** installé sur ce poste (Windows 10/11 + WSL2, ~8 Go de RAM) ;
- un **numéro WhatsApp dédié**, **différent de celui de l'école** — et pas le
  portable personnel du gérant. Un numéro banni par WhatsApp l'est **sans
  recours** ;
- votre compte **Tailscale existant** — celui de l'école. **N'en créez pas un
  second** : voir B1.

Si le poste allumé n'est pas envisageable, la seule alternative est un
hébergement payant type Railway (**7–10 $/mois**) : la bascule prend 20 minutes —
changer `EVOLUTION_BASE_URL`, redéployer, rescanner le QR.

## B1 — Compte Tailscale : **vous en avez déjà un, n'en créez pas un second**

C'est la bonne nouvelle de ce guide. **Un seul compte Tailscale suffit pour tous
vos projets.** Celui que vous avez ouvert pour l'école héberge autant de machines
que nécessaire, et chacune obtient sa propre adresse publique :

```
benzaoui-wa.tail6ac334.ts.net     ← l'école
rclmc-wa.tail6ac334.ts.net        ← la station   (même compte, même tailnet)
```

Seule change la **première moitié** du nom — c'est-à-dire `TAILSCALE_HOSTNAME`.
La seconde moitié, le nom du tailnet, **reste la même pour toujours**.

Ce qui est donc **déjà fait et ne se refait pas** :

| Étape de l'installation de l'école | À refaire ici ? |
| --- | --- |
| Créer le compte Tailscale | **Non** |
| Activer **MagicDNS** | **Non** |
| Activer les **certificats HTTPS** | **Non** |
| Autoriser le **Funnel** dans les ACL | **Non** — l'attribut vise `autogroup:member`, donc tout nouveau nœud du même tailnet en hérite automatiquement |
| Générer une **clé d'authentification** | **Non**, si la clé Reusable de l'école n'a pas expiré |

Autrement dit : les étapes qui vous avaient coûté le plus de temps — les ACL,
surtout — **sont derrière vous définitivement**. La station est plus simple à
installer que l'école ne l'a été.

**Ce que vous avez quand même à faire ici :**

1. Console Tailscale → **DNS** : relevez le **nom du tailnet**
   (`tailXXXXXX.ts.net`). Vous en avez besoin pour construire l'adresse.
2. Vérifiez d'un coup d'œil, sur cette même page, que **MagicDNS** et **HTTPS**
   sont bien actifs (ils le sont, sauf si quelqu'un les a désactivés depuis).
3. Choisissez un **nom de nœud différent** de celui de l'école : `rclmc-wa`.
   C'est obligatoire — deux projets ne peuvent pas partager une adresse.
4. Prévoyez un **numéro WhatsApp différent** de celui de l'école. Une instance
   lie **un** téléphone ; deux projets sur un même numéro mélangeraient les
   conversations.

## B2 — Le Funnel dans les ACL : **rien à faire, mais vérifiez-le**

L'attribut que vous aviez ajouté pour l'école vise `autogroup:member` :

```jsonc
"nodeAttrs": [
  { "target": ["autogroup:member"], "attr": ["funnel"] },
],
```

`autogroup:member`, c'est **tout membre de votre tailnet** — donc le nœud de la
station en hérite **automatiquement**, sans que vous touchiez aux ACL.

Vous n'avez donc rien à ajouter. Vous le **vérifierez** à l'étape B5, une fois le
conteneur démarré, avec la commande qui fait foi.

> **Si et seulement si** cette vérification échoue : Console → **Access
> controls**, et collez le bloc ci-dessus **à l'intérieur** de la politique
> existante. Le fichier ne peut contenir **qu'un seul** objet de haut niveau —
> le coller *au-dessus* donne `invalid character '{' after top-level value`. Les
> tailnets récents utilisent `grants`, les anciens `acls` : **ne mettez pas les
> deux**.

**Sans cet attribut, tout paraîtrait fonctionner** — le conteneur démarre, obtient
même son certificat, affiche « Funnel on: https://… » — et l'adresse ne résoudrait
nulle part. C'est le piège le plus coûteux du montage, et la seule raison pour
laquelle cette étape existe encore ici alors qu'il n'y a rien à faire.

## B3 — Clé d'authentification : ⚠️ **il faut en générer une neuve**

**Settings → Keys.** Constaté sur votre tailnet le 2026-08-23 :

```
You don't have any valid auth keys
2 recently invalidated auth keys
```

**Toutes vos clés ont été invalidées** — y compris celle de l'école. Il n'y a
donc rien à réutiliser : `evolution/.env` a été laissé avec
`TAILSCALE_AUTHKEY=` **vide**, exprès. Une clé morte ferait échouer le conteneur
à l'authentification avec un message qui ne désigne pas la cause ; un champ vide,
lui, est refusé tout de suite et nommément par `start-gateway.ps1`.

> Cela n'affecte **pas** l'école : une clé d'authentification ne sert qu'au
> PREMIER enregistrement d'un nœud. `benzaoui-wa` est déjà enregistré, connecté,
> et son expiration est désactivée — il continue de fonctionner.

**Generate auth key** :

- cochez **Reusable** ;
- **surtout pas Ephemeral** : un nœud éphémère disparaît dès qu'il se déconnecte
  et revient sous un nom différent — **l'adresse publique change** et
  l'application n'atteint plus rien.

Copiez la clé (`tskey-auth-…`), elle ne se réaffiche pas.

> **La clé d'authentification se partage entre projets ; la clé API de la
> passerelle, non.** `EVOLUTION_API_KEY` et `POSTGRES_PASSWORD` doivent être
> **propres à la station** (étape B4) : deux organisations ne doivent pas
> partager un secret.

## B4 — Renseigner les secrets du poste

Sur le poste, dans le dossier du projet :

```powershell
copy evolution\.env.example evolution\.env
notepad evolution\.env
```

Remplissez les cinq valeurs. Pour générer les deux chaînes aléatoires :

```powershell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
```

| Variable | Valeur |
| --- | --- |
| `TAILSCALE_AUTHKEY` | la clé de l'étape B3 |
| `TAILSCALE_HOSTNAME` | `rclmc-wa` (un nom **que vous choisissez**) |
| `TUNNEL_PUBLIC_URL` | `https://rclmc-wa.tailXXXXXX.ts.net` — **sans slash final** |
| `EVOLUTION_API_KEY` | une chaîne aléatoire de 32 octets |
| `POSTGRES_PASSWORD` | une **autre** chaîne aléatoire |

Ce fichier n'entre **jamais** dans Git. Notez ces valeurs ailleurs : vous en
aurez besoin à l'étape B7, et lors d'un changement de poste.

## B5 — Démarrer la passerelle : **une seule commande**

```powershell
powershell -ExecutionPolicy Bypass -File evolution\start-gateway.ps1
```

Ce script fait tout ce que les paragraphes ci-dessous décrivent, **et vérifie les
deux pannes qui ressemblent à une réussite** — le nom de nœud suffixé et le
Funnel non accordé. Il refuse de toucher à Docker tant que `evolution/.env` est
incomplet, en nommant la ligne manquante.

Si vous préférez à la main :

```powershell
docker compose -f evolution/docker-compose.funnel.yml up -d
docker compose -f evolution/docker-compose.funnel.yml logs -f tailscale
```

> **L'école tourne sur ce même poste** — vérifié : ses conteneurs
> `evolution-tailscale`, `evolution-funnel` et `evolution-funnel-postgres` sont
> en marche. La cohabitation est sûre, et elle a été contrôlée : les volumes sont
> distincts (`evolution_*` d'un côté, `rclmc-wa_*` de l'autre) et les ports aussi
> (8081 / 8082). `keep-alive.ps1` le revérifie à chaque passage.

> **Le port local vaut 8082, et pas 8081.** Le montage de l'école occupe déjà
> 8081. Sur deux machines séparées cela n'aurait aucune importance ; mais si les
> deux piles se retrouvaient un jour sur le même poste, le second conteneur
> refuserait de démarrer avec une erreur de port qui ne dit rien de la vraie
> cause. Le nom de projet Compose est distinct pour la même raison
> (`name: rclmc-wa`) — et celui-là est autrement plus grave : deux montages
> portant le même nom **partagent les mêmes volumes**, donc la même session
> WhatsApp et la même base.

Le nom obtenu doit être **exactement** `rclmc-wa.tailXXXXXX.ts.net`.

> **Un suffixe `-1`** (`rclmc-wa-1.…`) signifie qu'un nœud porte déjà ce nom.
> Supprimez l'ancien dans **Machines**, puis `down` et `up -d`. Sinon l'adresse
> publique n'est pas celle que vous allez déclarer.

Vérifiez ensuite que le Funnel est **réellement** accordé :

```powershell
docker exec rclmc-wa-tailscale tailscale status --json | Select-String "funnel"
```

La sortie doit contenir **`funnel`** *et* `funnel-ports`.
`tailscale funnel status` **ne fait pas foi** (voir B2).

## B6 — Rendre le poste apte au service continu

Dans un PowerShell **administrateur**, depuis le dossier du projet :

```powershell
powershell -ExecutionPolicy Bypass -File evolution\keep-alive.ps1          # rapport seul
powershell -ExecutionPolicy Bypass -File evolution\keep-alive.ps1 -Apply   # applique
```

Il corrige les deux causes n°1 de « ça marchait la journée, plus le soir » :

- la **mise en veille** (elle suspend les conteneurs et fait tomber la session) ;
- l'absence de **démarrage automatique de Docker** (après une coupure de courant,
  rien ne repart tant que le moteur n'est pas lancé).

Il **signale sans les modifier** deux réglages qui vous appartiennent :
l'ouverture de session automatique (elle stocke un mot de passe — à ne faire que
si le poste est protégé physiquement) et les heures d'activité de Windows Update.

## B7 — Variables chez l'hébergeur, **puis redéployer**

Dans les réglages de votre hébergement (Vercel → Settings → Environment
Variables) :

| Variable | Valeur |
| --- | --- |
| `EVOLUTION_BASE_URL` | `https://rclmc-wa.tailXXXXXX.ts.net` — **sans slash final** |
| `EVOLUTION_API_KEY` | **la même** qu'à l'étape B4 |
| `EVOLUTION_INSTANCE` | `rclmc` (ou le nom de votre choix) |
| `EVOLUTION_WEBHOOK_TOKEN` | une chaîne aléatoire, **différente** de la clé API |
| `SUPABASE_URL` | l'URL de votre projet Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` |

> ⚠️ **Ne définissez PAS `EVOLUTION_WEBHOOK_URL`.** L'application déduit
> l'adresse de son propre domaine. Recopier un `.env` local en bloc emporte la
> valeur `http://host.docker.internal:3000` et casse la mise en service.
> L'application l'écarte désormais et **nomme la variable fautive** dans l'écran
> de réglages — mais autant ne pas la laisser traîner.

> **`SUPABASE_SERVICE_ROLE_KEY` n'est pas optionnelle.** Sans elle, les messages
> peuvent partir, mais rien n'est journalisé et **un envoi tenté passerelle
> éteinte serait perdu** au lieu d'être mis en attente. L'écran de réglages vous
> le dira en toutes lettres.

**Redéployez ensuite** : les variables ne sont lues qu'au déploiement.

## B8 — Connecter le téléphone

**Sur le site déployé** — jamais depuis `localhost`, sinon le webhook pointera
sur votre machine de développement et aucun accusé ne reviendra :

1. **Réglages → WhatsApp**
2. **« Initialiser l'instance »** — crée l'instance et y enregistre l'adresse du
   webhook
3. **« Connecter WhatsApp »** — un QR code s'affiche
4. Sur le téléphone de la station :
   **WhatsApp → ⋮ → Appareils connectés → Connecter un appareil**, puis scannez

Le badge passe au vert **tout seul** dès que le scan est pris en compte : le QR
expire en moins d'une minute, l'écran se met à jour sans qu'on recharge.

La ligne **« Webhook »** doit afficher **« Jeton vérifié »**. Si elle affiche
autre chose, cliquez **« Réenregistrer le webhook »** — ce bouton fonctionne
session ouverte, il n'y a jamais à délier le téléphone.

## B9 — Vérifier toute la chaîne

Sur le poste de la passerelle :

```powershell
powershell -ExecutionPolicy Bypass -File evolution\check-gateway.ps1 `
  -BaseUrl  https://rclmc-wa.tailXXXXXX.ts.net `
  -ApiKey   <votre EVOLUTION_API_KEY> `
  -Instance rclmc `
  -AppUrl   https://<votre-domaine>
```

Les sept contrôles doivent passer. Puis **envoyez un vrai message** à votre
propre numéro et vérifiez qu'il atteint **« Remis »** dans le journal :
franchir « En attente » est la **seule** preuve que la boucle est fermée.

## B10 — Désactiver l'expiration de la clé ⚠️

**Console Tailscale → Machines → `rclmc-wa` → ⋯ → Disable key expiry.**

Un clic, définitif. **Sans lui, le nœud se déconnecte au bout de quelques mois et
les envois s'arrêtent sans aucun avertissement.** C'est l'oubli qui se paie le
plus cher, parce qu'il survient des mois plus tard, quand personne ne fait plus
le lien.

---

# Comment on s'en sert, au quotidien

## Ajouter les voitures d'un client

**Lavage & Réparation → Clients → Nouveau client** (ou Modifier).
Un encadré bleu « Véhicules du client » : **« Ajouter un véhicule »**, autant de
fois que nécessaire. Seule la marque **ou** le modèle est nécessaire — la plaque
est facultative.

Le même encadré apparaît **partout** où l'on crée un client dans la partie
Lavage : écran Clients, point de vente, et directement depuis la fiche
d'intervention.

## Créer une intervention

**Réparations & Lavage → Nouvelle intervention.**

1. Tapez le **nom ou le téléphone** du client, choisissez-le dans la liste.
2. Ses voitures s'affichent — cliquez celle qui passe aujourd'hui.
   *(Un client qui n'en a qu'une la voit sélectionnée d'office.)*
3. Relevez le **kilométrage**. Il remonte sur la fiche du client à
   l'enregistrement.

Un client de passage, ou une voiture prêtée ? La **saisie libre** est toujours là,
exactement comme avant.

## Traiter les rappels

**Lavage & Réparation → Messages clients.**
Une pastille rouge dans la barre latérale annonce les rappels **échus**.

| Onglet | Ce qu'il montre |
| --- | --- |
| **Alertes** | ce qui est dû aujourd'hui ou en retard |
| **À venir** | ce qui tombe dans les sept prochains jours |
| **Journal des envois** | tous les messages partis, avec leur accusé de remise |
| **Modèles** | vos textes types |

Sur chaque alerte, deux gestes :

- **« Envoyer le message »** — le texte est **déjà écrit**, rempli avec le nom du
  client, sa voiture, son kilométrage et la date de son dernier passage. Relisez,
  corrigez si vous voulez, envoyez. L'alerte disparaît de la liste.
- **« Marquer comme lu »** — l'alerte est classée sans écrire, et ne revient plus.

Le bouton **« Envoyer à tous »** traite toute la liste d'un coup : un message par
client, chacun rempli avec **ses** informations, tous relisibles avant l'envoi.

## Écrire un message libre

**Messages clients → Nouveau message.** Cherchez le client par nom ou téléphone.
S'il a **plusieurs voitures**, l'application demande laquelle — les informations
du véhicule entrent alors dans le message.

## Lire les statuts

| Étiquette | Ce qu'elle dit |
| --- | --- |
| **En attente** | la passerelle était injoignable — le message repartira **tout seul**. *Ce n'est pas un échec.* |
| **Envoyé** | la passerelle l'a pris en charge |
| **Remis** | arrivé sur le téléphone du client |
| **Lu** | le client l'a ouvert |
| **Échec** | numéro invalide, ou sans compte WhatsApp |

Un bandeau discret en bas de l'écran apparaît tant qu'il reste des messages en
attente. Il disparaît tout seul quand la file se vide.

---

# Si quelque chose ne marche pas

| Symptôme | Cause la plus probable | Correctif |
| --- | --- | --- |
| « Passerelle injoignable » | le poste est éteint, en veille, ou hors ligne | rallumez-le ; puis `keep-alive.ps1 -Apply` pour que ça ne recommence pas |
| Les statuts restent sur **« En attente »** alors que les messages arrivent | le webhook pointe vers une ancienne adresse, ou son jeton a divergé | **Réglages → WhatsApp → « Réenregistrer le webhook »** |
| L'écran nomme une **variable ignorée** | `EVOLUTION_WEBHOOK_URL` a été recopiée depuis un `.env` local | retirez-la des variables de l'hébergeur, puis redéployez |
| « Ni journal, ni file d'attente » | `SUPABASE_SERVICE_ROLE_KEY` manque | ajoutez-la (étape B7), puis **redéployez** |
| Le QR ne s'affiche pas | l'instance n'existe pas encore | **« Initialiser l'instance »** d'abord |
| L'adresse publique ne répond pas | l'attribut `funnel` n'est pas accordé | refaites l'étape B2, puis vérifiez avec la commande de B5 |
| Tout marchait, puis plus rien après quelques mois | la clé du nœud a expiré | étape **B10** — et cette fois faites-la |

**Le piège de diagnostic à connaître :** depuis le poste qui héberge la
passerelle, `curl` vers l'adresse publique **réussit toujours** — la requête
passe par le réseau interne Tailscale et **jamais** par le chemin public. Un test
réussi depuis ce poste ne prouve **rien**. Le seul test qui tranche se fait
depuis un autre réseau (le partage de connexion de votre téléphone, Wi-Fi de la
station coupé).

Le diagnostic complet, avec les sept contrôles et leurs correctifs, est dans
[`evolution/README.md`](evolution/README.md).

---

# Protéger le numéro — à lire une fois, à retenir toujours

**Un numéro banni par WhatsApp l'est sans recours.** Il n'y a ni support, ni
recours, ni délai de grâce.

- N'écrivez qu'à des gens qui **attendent quelque chose** de la station. Un
  rappel de lavage à un client qui est déjà venu trois fois : oui. Une promotion
  à toute la base : non.
- **Montez en charge progressivement** : environ 50 messages par jour la
  première semaine.
- **Ne cherchez jamais à accélérer les envois groupés.** L'application attend
  volontairement quelques secondes entre chaque destinataire, y compris quand
  elle rattrape les messages en attente — c'est précisément le moment où l'on
  ressemble le plus à un robot.
- Utilisez un **numéro dédié**, jamais un portable personnel.
- Le téléphone qui a scanné doit se reconnecter à Internet **de temps en temps**,
  sinon WhatsApp finit par délier l'appareil.
