# `funnel.json` — ce que le fichier ne peut pas dire lui-même

`funnel.json` est **désérialisé par Tailscale**. Il ne supporte donc **aucun
commentaire et aucune clé étrangère** : une clé `_comment` ajoutée pour
s'expliquer casserait la passerelle. Les explications vivent ici.

## Ce que le fichier déclare

```json
{
  "TCP": { "443": { "HTTPS": true } },
  "Web": {
    "${TS_CERT_DOMAIN}:443": {
      "Handlers": { "/": { "Proxy": "http://evolution:8080" } }
    }
  },
  "AllowFunnel": { "${TS_CERT_DOMAIN}:443": true }
}
```

| Ligne | Ce qu'elle fait |
| --- | --- |
| `TCP.443.HTTPS` | Le nœud sert du HTTPS sur 443, avec un certificat Tailscale |
| `Web.…Handlers./` | Tout ce qui arrive est renvoyé au conteneur `evolution`, port 8080 |
| `AllowFunnel` | **Ouvre l'accès depuis l'Internet public**, et pas seulement au tailnet |

## `${TS_CERT_DOMAIN}` ne s'écrit jamais en dur

Il est remplacé au démarrage par le FQDN réel du nœud
(`<TS_HOSTNAME>.<votre-tailnet>.ts.net`). L'écrire en dur ferait échouer la
configuration au moindre changement de nom de nœud.

## Le Funnel n'accepte que trois ports

**443, 8443 et 10000.** Aucun autre. Le port 443 est le seul qui donne une URL
sans numéro de port.

## Le piège qui coûte le plus de temps

**`tailscale funnel status` ment.**

Sans l'attribut `funnel` accordé par les ACL du tailnet, le conteneur démarre,
applique cette configuration, **obtient même son certificat TLS**, et affiche
fièrement `# Funnel on: https://…`. Cet affichage vient du fichier **local**, qui
s'applique quoi qu'il arrive. Le plan de contrôle, lui, refuse silencieusement de
publier l'enregistrement DNS public : l'adresse ne résout nulle part, sans le
moindre message d'erreur.

La seule vérification qui fasse foi compare les **capacités réellement
accordées** au nœud :

```powershell
docker exec rclmc-wa-tailscale tailscale status --json | Select-String "funnel"
```

Doit contenir **`funnel`** *et* `funnel-ports?ports=443,8443,10000`. Si `https`
est présent mais pas `funnel`, le certificat fonctionnera et le Funnel non —
c'est exactement le symptôme observé.

Correctif : console Tailscale → **Access controls**, ajouter `nodeAttrs`
**à l'intérieur** de la politique existante (le fichier ne peut contenir qu'un
seul objet de haut niveau) :

```jsonc
"nodeAttrs": [
  { "target": ["autogroup:member"], "attr": ["funnel"] },
],
```

## Le second piège de diagnostic : « ça marche depuis le poste »

Sur la machine qui héberge la passerelle — et sur **tout** membre du tailnet —
MagicDNS résout le nom vers l'IP **tailnet** du nœud (`100.x`). La requête ne
passe alors jamais par le Funnel : elle réussit même si le chemin public est
complètement cassé.

**Un `curl` réussi depuis le poste ne prouve rien.** Le seul test qui tranche est
une requête depuis un réseau tiers (partage de connexion du téléphone, coupé du
Wi-Fi de la station).
