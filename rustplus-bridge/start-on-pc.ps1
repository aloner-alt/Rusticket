param(
  [switch]$SetupOnly,
  [switch]$RunNow,
  [switch]$NewWorkerSecret
)

$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne 'Win32NT') {
  throw 'This launcher is for Windows. Run node src/index.cjs on Linux.'
}

$bridgeDir = $PSScriptRoot
$envPath = Join-Path $bridgeDir '.env'
$examplePath = Join-Path $bridgeDir '.env.example'
if (-not (Test-Path -LiteralPath $envPath)) {
  Copy-Item -LiteralPath $examplePath -Destination $envPath
  Write-Host 'Created local .env from .env.example.'
}

$lines = [System.Collections.Generic.List[string]]::new()
foreach ($line in [System.IO.File]::ReadAllLines($envPath)) { $lines.Add($line) }

function Get-EnvValue([string]$key) {
  foreach ($line in $lines) {
    if ($line -match ('^\s*' + [regex]::Escape($key) + '=(.*)$')) {
      return $Matches[1].Trim().Trim('"', "'")
    }
  }
  return ''
}

function Set-EnvValue([string]$key, [string]$value) {
  if ($value -match '[\r\n]') { throw "$key must be a single line." }
  $escaped = $value.Replace('\', '\\').Replace('"', '\"')
  $entry = '{0}="{1}"' -f $key, $escaped
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match ('^\s*' + [regex]::Escape($key) + '=')) {
      $lines[$index] = $entry
      return
    }
  }
  $lines.Add($entry)
}

function Read-Secret([string]$label) {
  $secure = Read-Host $label -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

$changed = $false
$prompts = [ordered]@{
  RUSTPLUS_SERVER_ID = 'Stable server ID, e.g. mirage-main'
  RUSTPLUS_IP = 'Rust+ IP from Pair with Server (not the game connect address)'
  RUSTPLUS_PORT = 'Rust+ port from Pair with Server'
  RUSTPLUS_PLAYER_ID = 'playerId / SteamID64 from pairing'
  RUSTPLUS_PLAYER_TOKEN = 'playerToken from pairing'
  WORKER_URL = 'Cloudflare Worker URL'
  RUSTPLUS_BRIDGE_TOKEN = 'Shared Worker secret RUSTPLUS_BRIDGE_TOKEN'
}

foreach ($key in $prompts.Keys) {
  if ($NewWorkerSecret -and $key -eq 'RUSTPLUS_BRIDGE_TOKEN') { continue }
  if (Get-EnvValue $key) { continue }
  if (-not [Environment]::UserInteractive) { throw "Missing $key in $envPath. Run interactively once." }
  do {
    $value = if ($key -in @('RUSTPLUS_PLAYER_TOKEN', 'RUSTPLUS_BRIDGE_TOKEN')) {
      Read-Secret $prompts[$key]
    } else {
      Read-Host $prompts[$key]
    }
    $value = $value.Trim()
    if (-not $value) { Write-Host "$key is required." }
  } until ($value)
  Set-EnvValue $key $value
  $changed = $true
}

$serverId = Get-EnvValue 'RUSTPLUS_SERVER_ID'
$ip = Get-EnvValue 'RUSTPLUS_IP'
$port = Get-EnvValue 'RUSTPLUS_PORT'
$playerId = Get-EnvValue 'RUSTPLUS_PLAYER_ID'
$workerUrl = Get-EnvValue 'WORKER_URL'
if ($serverId -notmatch '^[a-z0-9][a-z0-9_-]{1,39}$') { throw 'RUSTPLUS_SERVER_ID must be 2-40 lowercase letters, digits, _ or -.' }
if ($ip -notmatch '^[a-zA-Z0-9.:-]+$') { throw 'RUSTPLUS_IP must be a host or IP, not a connect command.' }
if ($port -notmatch '^\d{2,5}$' -or [int]$port -gt 65535) { throw 'RUSTPLUS_PORT must be a valid TCP port.' }
if ($playerId -notmatch '^\d{17,20}$') { throw 'RUSTPLUS_PLAYER_ID must be SteamID64.' }
if ($workerUrl -notmatch '^https://') { throw 'WORKER_URL must start with https://.' }

if ($NewWorkerSecret) {
  $nodeForSecret = Get-Command node.exe -ErrorAction SilentlyContinue
  $wranglerPath = Join-Path $bridgeDir '..\node_modules\wrangler\bin\wrangler.js'
  if (-not $nodeForSecret -or -not (Test-Path -LiteralPath $wranglerPath)) {
    throw 'Install root project dependencies and log in to Wrangler before using -NewWorkerSecret.'
  }
  Write-Warning 'This rotates the existing Worker secret. Any other Rust+ bridge must be updated with the new value.'
  $randomBytes = [byte[]]::new(32)
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $random.GetBytes($randomBytes) }
  finally { $random.Dispose() }
  $newSecret = [BitConverter]::ToString($randomBytes).Replace('-', '').ToLowerInvariant()
  $newSecret | & $nodeForSecret.Source $wranglerPath secret put RUSTPLUS_BRIDGE_TOKEN --name rusticket
  if ($LASTEXITCODE -ne 0) { throw 'Could not save the shared secret to Cloudflare. The local .env was not changed.' }
  Set-EnvValue 'RUSTPLUS_BRIDGE_TOKEN' $newSecret
  $changed = $true
  Write-Host 'Shared secret saved to Cloudflare and local .env.'
}

if (-not (Get-EnvValue 'RUSTPLUS_ONLY_WHEN_SELF_ONLINE')) {
  Set-EnvValue 'RUSTPLUS_ONLY_WHEN_SELF_ONLINE' '1'
  $changed = $true
}
if ($changed) {
  [System.IO.File]::WriteAllLines($envPath, $lines, [System.Text.UTF8Encoding]::new($false))
  Write-Host 'Saved .env locally. Pairing values and secrets were not printed.'
}

if ($SetupOnly) { return }

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js 20+ is required. Install Node.js and run this launcher again.' }
$nodeMajor = [int]((& $node.Source --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) { throw 'Node.js 20+ is required.' }

$rustPlusModule = Join-Path $bridgeDir 'node_modules\@rustwirebot\rustplus.js'
$dotenvModule = Join-Path $bridgeDir 'node_modules\dotenv'
if (-not (Test-Path -LiteralPath $rustPlusModule) -or -not (Test-Path -LiteralPath $dotenvModule)) {
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npm) { throw 'npm is required to install bridge dependencies.' }
  Write-Host 'Installing bridge dependencies...'
  Push-Location $bridgeDir
  try { & $npm.Source install --no-package-lock --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' } }
  finally { Pop-Location }
}

Write-Host 'Waiting for RustClient.exe. Keep this window open; Ctrl+C stops the launcher.'
Write-Host 'The bridge publishes only while the paired Steam account is online on the server.'
$bridge = $null
try {
  while ($true) {
    $gameRunning = $RunNow -or [bool](Get-Process -Name RustClient,Rust -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($gameRunning -and ($null -eq $bridge -or $bridge.HasExited)) {
      Write-Host 'Rust detected. Starting Rust+ bridge...'
      $bridge = Start-Process -FilePath $node.Source -ArgumentList 'src/index.cjs' -WorkingDirectory $bridgeDir -NoNewWindow -PassThru
    } elseif (-not $gameRunning -and $null -ne $bridge) {
      if (-not $bridge.HasExited) {
        Write-Host 'Rust closed. Stopping Rust+ bridge...'
        Stop-Process -Id $bridge.Id -ErrorAction SilentlyContinue
      }
      $bridge = $null
    }
    Start-Sleep -Seconds 10
  }
} finally {
  if ($null -ne $bridge -and -not $bridge.HasExited) {
    Stop-Process -Id $bridge.Id -ErrorAction SilentlyContinue
  }
}
