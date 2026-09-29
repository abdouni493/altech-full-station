<#
.SYNOPSIS
    Démarre la passerelle WhatsApp, et VÉRIFIE ce qui échoue en silence.

.DESCRIPTION
    Ce script existe pour deux pannes qui *ressemblent à une réussite* — tout
    démarre, aucun journal ne proteste, et pourtant rien ne fonctionnera :

      1. LE NOM DU NŒUD PREND UN SUFFIXE. Tailscale n'attribue jamais deux fois
         le même nom : si un nœud s'appelle déjà `rclmc-wa`, le nouveau devient
         `rclmc-wa-1`. L'adresse publique n'est alors plus celle déclarée chez
         l'hébergeur, et l'application appelle dans le vide.

      2. LE FUNNEL N'EST PAS ACCORDÉ. Sans l'attribut `funnel` dans les ACL, le
         conteneur démarre, applique sa configuration, obtient même son
         certificat TLS, et affiche fièrement « Funnel on: https://… ». Cet
         affichage vient du fichier LOCAL. Le plan de contrôle, lui, refuse
         silencieusement de publier l'enregistrement DNS public.

    Il refuse aussi de démarrer si `evolution/.env` est incomplet — mieux vaut
    un refus qui nomme la ligne manquante qu'un conteneur qui boucle sur une
    erreur d'authentification.

.PARAMETER Recreate
    Recrée les conteneurs (`up -d --force-recreate`). Ne touche PAS aux volumes :
    la session WhatsApp survit.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File evolution\start-gateway.ps1
#>
[CmdletBinding()]
param([switch]$Recreate)

$ErrorActionPreference = 'Continue'
$root    = Split-Path -Parent $PSScriptRoot
$compose = Join-Path $PSScriptRoot 'docker-compose.funnel.yml'
$envFile = Join-Path $PSScriptRoot '.env'

function Ok($t)   { Write-Host "  [OK]  $t" -ForegroundColor Green }
function Bad($t)  { Write-Host "  [KO]  $t" -ForegroundColor Red }
function Warn($t) { Write-Host "  [!]   $t" -ForegroundColor Yellow }
function Fix($t)  { Write-Host "        -> $t" -ForegroundColor DarkGray }
function Head($t) { Write-Host ''; Write-Host "=== $t" -ForegroundColor Cyan }

Write-Host ''
Write-Host '  PASSERELLE WHATSAPP — DEMARRAGE CONTROLE' -ForegroundColor White

# =====================================================================================
#  1. LE FICHIER DE SECRETS
# =====================================================================================
Head '1. evolution/.env'

if (-not (Test-Path $envFile)) {
  Bad 'evolution/.env est absent.'
  Fix 'copy evolution\.env.example evolution\.env  puis remplissez-le.'
  exit 1
}

$cfg = @{}
foreach ($line in Get-Content $envFile) {
  $t = $line.Trim()
  if ($t -and -not $t.StartsWith('#') -and $t.Contains('=')) {
    $i = $t.IndexOf('=')
    $cfg[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim()
  }
}

$missing = @()
foreach ($k in @('TAILSCALE_AUTHKEY','TAILSCALE_HOSTNAME','TUNNEL_PUBLIC_URL','EVOLUTION_API_KEY','POSTGRES_PASSWORD')) {
  $v = $cfg[$k]
  if ([string]::IsNullOrWhiteSpace($v) -or $v -like '*remplacez*' -or $v -like '*xxxx*') { $missing += $k }
}

if ($missing -contains 'TAILSCALE_AUTHKEY') {
  Bad 'TAILSCALE_AUTHKEY est vide.'
  Fix 'Console Tailscale -> Settings -> Keys -> « Generate auth key... »'
  Fix '  . cochez REUSABLE'
  Fix '  . surtout PAS Ephemeral (le noeud reviendrait sous un autre nom)'
  Fix "Collez-la dans $envFile, puis relancez ce script."
}
foreach ($k in $missing | Where-Object { $_ -ne 'TAILSCALE_AUTHKEY' }) {
  Bad "$k n'est pas renseignee."
}
if ($missing.Count -gt 0) { Write-Host ''; exit 1 }

if ($cfg['TAILSCALE_AUTHKEY'] -notmatch '^tskey-') {
  Warn "TAILSCALE_AUTHKEY ne commence pas par « tskey- » : est-ce bien une cle d'authentification ?"
}
Ok 'les cinq valeurs sont renseignees.'

# L'adresse publique doit decouler du nom de noeud, sans slash final.
$hostname = $cfg['TAILSCALE_HOSTNAME']
$tunnel   = $cfg['TUNNEL_PUBLIC_URL']
if ($tunnel.EndsWith('/')) {
  Bad 'TUNNEL_PUBLIC_URL se termine par un slash.'
  Fix 'Retirez-le : cette valeur est comparee au caractere pres, un slash en trop'
  Fix 'fait rejeter TOUS les accuses de remise en 403.'
  exit 1
}
if ($tunnel -notlike "https://$hostname.*") {
  Bad "TUNNEL_PUBLIC_URL ($tunnel) ne correspond pas a TAILSCALE_HOSTNAME ($hostname)."
  Fix "Attendu : https://$hostname.<votre-tailnet>.ts.net"
  exit 1
}
Ok "adresse publique visee : $tunnel"

# =====================================================================================
#  2. LE MOTEUR DOCKER
# =====================================================================================
Head '2. Docker'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Bad 'La commande `docker` est introuvable.'
  Fix 'Installez Docker Desktop (Windows 10/11 + WSL2), puis relancez.'
  exit 1
}
docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Bad 'Le moteur Docker ne repond pas.'
  Fix 'Lancez Docker Desktop et attendez qu''il soit « Running ».'
  exit 1
}
Ok 'moteur Docker en marche.'

# Un voisin n'est pas un conflit : plusieurs organisations cohabitent tres bien
# sur un meme poste, chacune avec son projet Compose et ses propres volumes.
# Le conflit, c'est qu'un autre conteneur monte NOS volumes — deux passerelles
# sur la meme session WhatsApp la corrompent. On compare donc les volumes.
#
# Le gabarit ne porte AUCUN guillemet interne : sous Windows, docker.exe les
# avale, et `{{if eq .Type "volume"}}` echouerait sur « function volume not
# defined » — le controle ne controlerait alors plus rien, en silence.
$ourVolumes = @('rclmc-wa_evolution_instances', 'rclmc-wa_postgres_data', 'rclmc-wa_tailscale_state')
$intruders = @()
foreach ($name in (docker ps --format '{{.Names}}' 2>$null)) {
  if ($name -like 'rclmc-wa-*') { continue }
  $mounts = (docker inspect -f '{{range .Mounts}}{{.Name}} {{end}}' $name 2>$null) -join ' '
  if (-not $mounts.Trim()) { continue }
  foreach ($v in $ourVolumes) {
    if ($mounts -match [regex]::Escape($v)) { $intruders += "$name monte $v"; break }
  }
}
if ($intruders) {
  Bad 'Un autre conteneur monte NOS volumes :'
  $intruders | ForEach-Object { Fix $_ }
  Fix 'Arretez-le : deux passerelles sur la meme session WhatsApp la corrompent.'
  exit 1
}
Ok 'aucun conteneur etranger ne monte nos volumes.'

# =====================================================================================
#  3. DEMARRAGE
# =====================================================================================
Head '3. Demarrage de la pile'
$args = @('compose', '-f', $compose, 'up', '-d')
if ($Recreate) { $args += '--force-recreate' }
Push-Location $root
& docker @args
$started = ($LASTEXITCODE -eq 0)
Pop-Location
if (-not $started) {
  Bad 'docker compose up a echoue (voir ci-dessus).'
  exit 1
}
Ok 'conteneurs lances.'

Write-Host '  Attente de l''enregistrement du noeud Tailscale...' -ForegroundColor DarkGray

# =====================================================================================
#  4. LE NOM REELLEMENT OBTENU — le piege qui ressemble a une reussite
# =====================================================================================
Head '4. Nom du noeud'
$actual = $null
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 2
  $json = docker exec rclmc-wa-tailscale tailscale status --json 2>$null | ConvertFrom-Json
  if ($json -and $json.Self -and $json.Self.DNSName) {
    $actual = $json.Self.DNSName.TrimEnd('.')
    break
  }
}

if (-not $actual) {
  Bad 'Le noeud ne s''est pas enregistre dans les 60 s.'
  Fix 'docker compose -f evolution/docker-compose.funnel.yml logs tailscale'
  Fix 'Une cle invalide ou deja revoquee est la cause la plus frequente.'
  exit 1
}

$expected = "$hostname." + ($tunnel -replace '^https://[^.]+\.', '')
if ($actual -eq $expected) {
  Ok "nom obtenu : $actual"
} else {
  Bad "nom obtenu : $actual"
  Fix "ATTENDU     : $expected"
  if ($actual -match '-\d+\.') {
    Fix 'Le suffixe signifie qu''un noeud porte DEJA ce nom. Supprimez l''ancien'
    Fix 'dans la console (Machines), puis relancez avec -Recreate.'
    Fix "Sans cela l'adresse publique n'est PAS celle declaree chez l'hebergeur,"
    Fix 'et rien ne le signalera.'
  }
}

# =====================================================================================
#  5. LE FUNNEL EST-IL REELLEMENT ACCORDE ?
# =====================================================================================
Head '5. Funnel'
$caps = @()
if ($json.Self.Capabilities) { $caps = $json.Self.Capabilities }
if ($caps -contains 'funnel') {
  Ok 'attribut « funnel » accorde par le plan de controle.'
} else {
  Bad 'attribut « funnel » ABSENT — l''adresse publique ne resoudra nulle part.'
  Fix '`tailscale funnel status` MENT : il reflete le fichier local, pas les ACL.'
  Fix 'Console -> Access controls -> nodeAttrs { target: autogroup:member, attr: [funnel] }'
}

# =====================================================================================
#  6. LA PASSERELLE REPOND-ELLE EN LOCAL ?
# =====================================================================================
Head '6. Passerelle'
$local = $null
for ($i = 0; $i -lt 15; $i++) {
  try {
    $local = Invoke-RestMethod -Uri 'http://127.0.0.1:8082/' -TimeoutSec 4
    break
  } catch { Start-Sleep -Seconds 2 }
}
if ($local) { Ok "Evolution API $($local.version) repond sur 127.0.0.1:8082." }
else {
  Bad 'Evolution ne repond pas sur 127.0.0.1:8082.'
  Fix 'docker compose -f evolution/docker-compose.funnel.yml logs evolution'
}

# =====================================================================================
Head 'Ce qu''il reste a faire'
Write-Host @"
  1. Sur le SITE DEPLOYE (jamais depuis localhost) :
     Reglages -> WhatsApp -> « Initialiser l'instance » -> « Connecter WhatsApp »
     puis scannez le QR avec le telephone de la station.

  2. Console Tailscale -> Machines -> $hostname -> ... -> Disable key expiry.
     Sans ce clic, tout s'arrete dans quelques mois, SANS PREAVIS.

  3. Verification de bout en bout :
     evolution\check-gateway.ps1 -BaseUrl $tunnel -ApiKey <cle> -Instance rclmc -AppUrl <domaine>

  RAPPEL : ce poste eteint = aucun message ne part. Les envois sont mis en
  attente et repartent seuls au retour, mais rien ne part tant qu'il dort.
"@ -ForegroundColor DarkGray
Write-Host ''
