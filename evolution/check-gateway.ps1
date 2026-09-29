<#
.SYNOPSIS
    Diagnostic de bout en bout de la passerelle WhatsApp. Ne modifie RIEN.

.DESCRIPTION
    Sept controles, dans l'ordre ou ils dependent les uns des autres. Chaque
    echec porte la manoeuvre qui le corrige.

      1. la passerelle repond ;
      2. la cle API est acceptee ;
      3. l'instance existe et la session est connectee ;
      4. le webhook est declare vers le BON domaine ;
      5. l'endpoint webhook de l'application repond 401 sans jeton ;
      6. le JETON que la passerelle envoie est bien celui que l'application
         attend (c'est la panne la plus muette du montage : les messages
         partent, tout a l'air normal, et chaque accuse de remise est refuse
         en 401) ;
      7. la cle du noeud Tailscale n'est pas sur le point d'expirer.

    ATTENTION AU FAUX POSITIF. Depuis le poste qui heberge la passerelle — et
    depuis tout membre du tailnet — MagicDNS resout le nom vers l'IP tailnet
    (100.x). La requete ne passe alors JAMAIS par le Funnel : elle reussit meme
    si le chemin public est completement casse. Le controle 1 le signale.
    Le seul test qui tranche est une requete depuis un RESEAU TIERS.

.PARAMETER BaseUrl
    Adresse publique de la passerelle, sans slash final.

.PARAMETER ApiKey
    La cle API de la passerelle (AUTHENTICATION_API_KEY).

.PARAMETER Instance
    Nom de l'instance. « station » par defaut.

.PARAMETER AppUrl
    Adresse publique de l'application, sans slash final.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File evolution\check-gateway.ps1 `
      -BaseUrl https://rclmc-wa.tailXXXXXX.ts.net `
      -ApiKey  <cle> `
      -AppUrl  https://mon-app.vercel.app
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$BaseUrl,
  [Parameter(Mandatory = $true)][string]$ApiKey,
  [string]$Instance = 'station',
  [string]$AppUrl,
  [string]$ContainerName = 'rclmc-wa-tailscale'
)

$ErrorActionPreference = 'Continue'
$BaseUrl = $BaseUrl.TrimEnd('/')
if ($AppUrl) { $AppUrl = $AppUrl.TrimEnd('/') }
$script:Failures = 0

function Step($n, $label)      { Write-Host ("{0}. {1}" -f $n, $label.PadRight(34)) -NoNewline }
function Pass($detail = '')    { Write-Host "[OK]  $detail" -ForegroundColor Green }
function Fail($detail)         { Write-Host "[KO]  $detail" -ForegroundColor Red; $script:Failures++ }
function Note($detail)         { Write-Host "[!]   $detail" -ForegroundColor Yellow }
function Fix($text)            { Write-Host "                                      -> $text" -ForegroundColor DarkGray }

Write-Host ''
Write-Host "  PASSERELLE WHATSAPP — DIAGNOSTIC ($BaseUrl)" -ForegroundColor White
Write-Host ''

# =====================================================================================
#  1. LA PASSERELLE REPOND
# =====================================================================================
Step 1 'Joignabilite de la passerelle'
$version = $null
try {
  $root = Invoke-RestMethod -Uri "$BaseUrl/" -Method GET -TimeoutSec 20
  $version = $root.version
  Pass ("Evolution API " + $version)
} catch {
  Fail $_.Exception.Message
  Fix 'Le poste est-il allume, eveille et connecte ? Les conteneurs tournent-ils ?'
  Fix 'docker compose -f evolution/docker-compose.funnel.yml ps'
}

# Le faux positif du tailnet.
try {
  $host_ = ([Uri]$BaseUrl).Host
  $ips = [System.Net.Dns]::GetHostAddresses($host_) | ForEach-Object { $_.IPAddressToString }
  if ($ips -and ($ips | Where-Object { $_ -like '100.*' })) {
    Note 'Ce poste resout le nom vers son IP TAILNET (100.x) : la requete ci-dessus'
    Fix  "n'est PAS passee par le Funnel. Un test reussi ici ne prouve rien du chemin public."
    Fix  'Refaites-le depuis un reseau tiers (partage de connexion du telephone).'
  }
} catch { }

# =====================================================================================
#  2. LA CLE API
# =====================================================================================
Step 2 'Cle API'
$headers = @{ apikey = $ApiKey }
$instances = $null
try {
  $instances = Invoke-RestMethod -Uri "$BaseUrl/instance/fetchInstances" -Headers $headers -Method GET -TimeoutSec 20
  Pass 'acceptee'
} catch {
  Fail $_.Exception.Message
  Fix 'EVOLUTION_API_KEY doit valoir EXACTEMENT AUTHENTICATION_API_KEY de la passerelle.'
}

# =====================================================================================
#  3. LA SESSION
# =====================================================================================
Step 3 'Session WhatsApp'
try {
  $state = Invoke-RestMethod -Uri "$BaseUrl/instance/connectionState/$Instance" -Headers $headers -Method GET -TimeoutSec 20
  $s = if ($state.instance) { $state.instance.state } else { $state.state }
  if ($s -eq 'open') {
    $number = ''
    if ($instances) {
      $mine = $instances | ForEach-Object { if ($_.instance) { $_.instance } else { $_ } } |
              Where-Object { $_.instanceName -eq $Instance -or $_.name -eq $Instance }
      if ($mine -and $mine.owner) { $number = ($mine.owner -split '@')[0] }
    }
    Pass ("connectee" + $(if ($number) { " — $number" } else { '' }))
  } else {
    Fail "etat « $s »"
    Fix 'Application -> Reglages -> WhatsApp -> Connecter WhatsApp, puis scannez le QR.'
  }
} catch {
  Fail $_.Exception.Message
  Fix "L'instance « $Instance » n'existe peut-etre pas encore : cliquez « Initialiser l'instance »."
}

# =====================================================================================
#  4. LE WEBHOOK DECLARE
#     Il est stocke SUR LA PASSERELLE, pas dans l'application : il survit aux
#     demenagements et continue de pointer vers l'ancienne adresse. Symptome :
#     les messages partent, les statuts restent bloques, aucune erreur nulle part.
# =====================================================================================
Step 4 'Webhook declare'
$declaredUrl = $null
$declaredToken = $null
try {
  $wh = Invoke-RestMethod -Uri "$BaseUrl/webhook/find/$Instance" -Headers $headers -Method GET -TimeoutSec 20
  $w = if ($wh.webhook) { $wh.webhook } else { $wh }
  $declaredUrl = $w.url
  if ($w.headers) {
    $auth = $w.headers.Authorization
    if (-not $auth) { $auth = $w.headers.authorization }
    if ($auth) { $declaredToken = ($auth -replace '^Bearer\s+', '') }
  }
  if (-not $declaredUrl) {
    Fail 'aucun webhook enregistre'
    Fix 'Application -> Reglages -> WhatsApp -> « Reenregistrer le webhook ».'
  } elseif ($AppUrl -and $declaredUrl -notlike "$AppUrl*") {
    Fail "pointe vers $declaredUrl"
    Fix "Attendu : $AppUrl/api/whatsapp/webhook — cliquez « Reenregistrer le webhook »."
  } else {
    Pass "vers $declaredUrl"
  }
} catch {
  Fail $_.Exception.Message
}

# =====================================================================================
#  5. L'ENDPOINT DE L'APPLICATION
# =====================================================================================
if ($AppUrl) {
  Step 5 'Endpoint webhook'
  try {
    Invoke-RestMethod -Uri "$AppUrl/api/whatsapp/webhook" -Method POST -Body '{}' `
      -ContentType 'application/json' -TimeoutSec 20 | Out-Null
    Fail 'repond SANS jeton — il devrait refuser en 401'
    Fix 'EVOLUTION_WEBHOOK_TOKEN est-elle bien definie chez l''hebergeur ?'
  } catch {
    $code = $null
    try { $code = [int]$_.Exception.Response.StatusCode } catch { }
    if ($code -eq 401) { Pass 'joignable et protege (401 sans jeton)' }
    elseif ($code) { Fail "HTTP $code" }
    else { Fail $_.Exception.Message; Fix 'L''application est-elle deployee, et le dossier api/ avec elle ?' }
  }

  # ===================================================================================
  #  6. LE JETON REELLEMENT ENVOYE PAR LA PASSERELLE
  #     On rejoue un appel AUTHENTIQUE vers l'application avec le jeton que la
  #     passerelle utilise vraiment, sur un evenement INCONNU que la route
  #     ignore : rien n'est ecrit, seule l'authentification est mise a l'epreuve.
  #     Aucun secret n'a besoin d'etre connu de l'operateur.
  # ===================================================================================
  Step 6 'Jeton du webhook'
  if (-not $declaredToken) {
    Fail 'la passerelle n''envoie aucun jeton'
    Fix 'Cliquez « Reenregistrer le webhook » dans l''application.'
  } else {
    try {
      $probe = @{ event = 'DIAGNOSTIC_PROBE'; server_url = $BaseUrl; data = @{} } | ConvertTo-Json -Compress
      Invoke-RestMethod -Uri "$AppUrl/api/whatsapp/webhook" -Method POST -Body $probe `
        -ContentType 'application/json' -Headers @{ Authorization = "Bearer $declaredToken" } -TimeoutSec 20 | Out-Null
      Pass 'accepte par l''application'
    } catch {
      $code = $null
      try { $code = [int]$_.Exception.Response.StatusCode } catch { }
      if ($code -eq 401) {
        Fail 'REFUSE (401) — le jeton de la passerelle n''est plus celui de l''application'
        Fix 'C''est la panne la plus muette du montage : les messages partent, aucun accuse ne revient.'
        Fix 'Correctif en un clic : Reglages -> WhatsApp -> « Reenregistrer le webhook ».'
      } elseif ($code -eq 403) {
        Fail 'REFUSE (403) — server_url ne correspond pas'
        Fix "EVOLUTION_BASE_URL cote application doit valoir EXACTEMENT $BaseUrl (sans slash final)."
      } else {
        Fail $(if ($code) { "HTTP $code" } else { $_.Exception.Message })
      }
    }
  }
} else {
  Write-Host '5. Endpoint webhook                   [--]  -AppUrl non fourni' -ForegroundColor DarkGray
  Write-Host '6. Jeton du webhook                   [--]  -AppUrl non fourni' -ForegroundColor DarkGray
}

# =====================================================================================
#  7. LA CLE DU NOEUD TAILSCALE
#     Sans « Disable key expiry », le noeud se deconnecte au bout de quelques
#     mois et LES ENVOIS S'ARRETENT SANS AUCUN AVERTISSEMENT. C'est l'oubli qui
#     se paie le plus cher, parce qu'il survient des mois plus tard.
# =====================================================================================
Step 7 'Cle du noeud Tailscale'
try {
  $json = docker exec $ContainerName tailscale status --json 2>$null | ConvertFrom-Json
  if (-not $json) { throw 'conteneur injoignable' }

  $caps = @()
  if ($json.Self -and $json.Self.Capabilities) { $caps = $json.Self.Capabilities }
  if (-not ($caps -contains 'funnel')) {
    Fail 'l''attribut « funnel » n''est PAS accorde a ce noeud'
    Fix '`tailscale funnel status` MENT : il reflete le fichier local, pas le plan de controle.'
    Fix 'Console Tailscale -> Access controls -> nodeAttrs { target: autogroup:member, attr: [funnel] }'
  } elseif ($json.Self.KeyExpiry) {
    $expiry = [DateTime]$json.Self.KeyExpiry
    $days = [int]($expiry - (Get-Date)).TotalDays
    if ($days -lt 0)      { Fail "la cle a EXPIRE le $($expiry.ToString('yyyy-MM-dd'))" }
    elseif ($days -lt 30) { Fail "expire le $($expiry.ToString('yyyy-MM-dd')) (dans $days j)" }
    else                  { Note "expire le $($expiry.ToString('yyyy-MM-dd')) (dans $days j)" }
    Fix 'Console Tailscale -> Machines -> le noeud -> ... -> Disable key expiry. Un clic, definitif.'
  } else {
    Pass 'expiration desactivee'
  }
} catch {
  Write-Host "[--]  non verifiable depuis ce poste" -ForegroundColor DarkGray
  Fix "Executez ce script sur le poste qui heberge la passerelle, ou avec -ContainerName."
}

# =====================================================================================
Write-Host ''
if ($script:Failures -eq 0) {
  Write-Host '  RESULTAT : la chaine est complete.' -ForegroundColor Green
  Write-Host '  Dernier test : envoyez un vrai message et verifiez qu''il atteint « Remis ».' -ForegroundColor DarkGray
  Write-Host '  Franchir « En attente » est la seule preuve que la boucle est fermee.' -ForegroundColor DarkGray
} else {
  Write-Host "  RESULTAT : $($script:Failures) controle(s) en echec." -ForegroundColor Red
}
Write-Host ''
