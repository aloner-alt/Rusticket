$ErrorActionPreference = 'Stop'
$bridgeDir = $PSScriptRoot
$projectDir = Split-Path -Parent $bridgeDir
$envPath = Join-Path $bridgeDir '.env'
$configPath = Join-Path $bridgeDir 'rustplus.config.json'
$examplePath = Join-Path $bridgeDir '.env.example'
$node = Get-Command node.exe -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
$docker = Get-Command docker.exe -ErrorAction SilentlyContinue
if (-not $node -or -not $npm) { throw 'Install Node.js 20+ first, then run this file again.' }
if (-not $docker) { throw 'Install Docker Desktop first, then run this file again.' }
$nodeMajor = [int]((& $node.Source --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) { throw 'Node.js 20+ is required.' }

function Read-EnvValue([string]$key) {
  if (-not (Test-Path -LiteralPath $envPath)) { return '' }
  foreach ($line in [System.IO.File]::ReadAllLines($envPath)) {
    if ($line -match ('^\s*' + [regex]::Escape($key) + '=(.*)$')) { return $Matches[1].Trim().Trim('"', "'") }
  }
  return ''
}

function Set-EnvValue([string]$key, [string]$value) {
  if ($value -match '[\r\n]') { throw "$key must have one line." }
  $lines = [System.Collections.Generic.List[string]]::new()
  foreach ($line in [System.IO.File]::ReadAllLines($envPath)) { $lines.Add($line) }
  $entry = '{0}="{1}"' -f $key, $value.Replace('\', '\\').Replace('"', '\"')
  $found = $false
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match ('^\s*' + [regex]::Escape($key) + '=')) {
      $lines[$index] = $entry
      $found = $true
      break
    }
  }
  if (-not $found) { $lines.Add($entry) }
  [System.IO.File]::WriteAllLines($envPath, $lines, [System.Text.UTF8Encoding]::new($false))
}

function Ensure-BridgeDependencies {
  if (Test-Path -LiteralPath (Join-Path $bridgeDir 'node_modules\@rustwirebot\rustplus.js\cli\index.js')) { return }
  Write-Host 'Installing Rust+ bridge dependencies...'
  Push-Location $bridgeDir
  try { & $npm.Source install --no-package-lock --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' } }
  finally { Pop-Location }
}

function Set-ChromiumPath {
  if ($env:CHROME_PATH -and (Test-Path -LiteralPath $env:CHROME_PATH)) { return }
  $candidates = @(
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe'),
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      $env:CHROME_PATH = $candidate
      Write-Host "Using Chromium browser for Rust+ authorization: $candidate"
      return
    }
  }
  throw 'Rust+ registration needs Microsoft Edge or Chrome. Firefox alone is not supported by this library.'
}

function Ensure-Pairing {
  $keys = @('RUSTPLUS_IP', 'RUSTPLUS_PORT', 'RUSTPLUS_PLAYER_ID', 'RUSTPLUS_PLAYER_TOKEN')
  if (@($keys | Where-Object { -not (Read-EnvValue $_) }).Count -eq 0) { return }
  Ensure-BridgeDependencies
  $cli = Join-Path $bridgeDir 'node_modules\@rustwirebot\rustplus.js\cli\index.js'
  if (-not (Test-Path -LiteralPath $configPath)) {
    Set-ChromiumPath
    Write-Host 'One-time Steam/Rust+ registration. Complete the Steam sign-in in the opened browser window.'
    & $node.Source $cli 'fcm-register' "--config-file=$configPath" 2>&1 | ForEach-Object {
      $line = [string]$_
      if ($line -match '(?i)(Expo Push Token:|Rust\+ AuthToken:)') { Write-Host 'Rust+ credential received and saved locally.' }
      elseif ($line -match 'Google Chrome is launching') { Write-Host 'Launching the Chromium browser for Steam authorization...' }
      else { Write-Host $line }
    }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $configPath)) { throw 'Rust+ registration failed.' }
  }
  Write-Host 'Start Rust and join the server you want to track.'
  Write-Host 'In the Rust+ game menu click Pair with Server. No values need to be copied.'
  & $node.Source (Join-Path $bridgeDir 'src\pairing.cjs') $configPath $envPath
  if ($LASTEXITCODE -ne 0 -or @($keys | Where-Object { -not (Read-EnvValue $_) }).Count -gt 0) {
    throw 'No server pairing was saved. Run this launcher again, then use Pair with Server in Rust.'
  }
}

function Ensure-WorkerSecret {
  if (Read-EnvValue 'RUSTPLUS_BRIDGE_TOKEN') { return }
  $wrangler = Join-Path $projectDir 'node_modules\wrangler\bin\wrangler.js'
  if (-not (Test-Path -LiteralPath $wrangler)) {
    Write-Host 'Installing Cloudflare project dependencies...'
    Push-Location $projectDir
    try { & $npm.Source install --no-package-lock --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'Project npm install failed.' } }
    finally { Pop-Location }
  }
  Write-Warning 'Creating a new Cloudflare bridge secret. Another Rust+ bridge using the old secret must be updated.'
  $bytes = [byte[]]::new(32)
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $random.GetBytes($bytes) }
  finally { $random.Dispose() }
  $secret = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
  Push-Location $projectDir
  try {
    & $node.Source $wrangler whoami --json *> $null
    if ($LASTEXITCODE -ne 0) {
      Write-Host 'Cloudflare authorization is required once. Complete it in the browser.'
      & $node.Source $wrangler login
      if ($LASTEXITCODE -ne 0) { throw 'Cloudflare authorization failed.' }
    }
    $secret | & $node.Source $wrangler secret put RUSTPLUS_BRIDGE_TOKEN --name rusticket
    if ($LASTEXITCODE -ne 0) { throw 'Cloudflare secret setup failed. Complete Wrangler authorization and retry.' }
  } finally { Pop-Location }
  Set-EnvValue 'RUSTPLUS_BRIDGE_TOKEN' $secret
  Write-Host 'Cloudflare bridge secret saved locally and on the Worker.'
}

function Test-DockerEngine {
  # Windows PowerShell 5 treats native stderr as a terminating error when
  # ErrorActionPreference is Stop. Probe Docker without writing to its streams.
  $probe = New-Object System.Diagnostics.Process
  $probe.StartInfo.FileName = $docker.Source
  $probe.StartInfo.Arguments = 'info --format "{{.ServerVersion}}"'
  $probe.StartInfo.UseShellExecute = $false
  $probe.StartInfo.RedirectStandardOutput = $true
  $probe.StartInfo.RedirectStandardError = $true
  $probe.StartInfo.CreateNoWindow = $true
  try {
    $null = $probe.Start()
    $null = $probe.StandardOutput.ReadToEnd()
    $null = $probe.StandardError.ReadToEnd()
    $probe.WaitForExit()
    return $probe.ExitCode -eq 0
  } finally { $probe.Dispose() }
}

function Ensure-DockerEngine {
  if (Test-DockerEngine) { return }
  $desktop = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'
  if (-not (Test-Path -LiteralPath $desktop)) { $desktop = 'C:\Program Files\Docker\Docker\Docker Desktop.exe' }
  if (-not (Test-Path -LiteralPath $desktop)) { throw 'Docker Desktop is installed but its executable was not found. Start Docker Desktop manually.' }
  Write-Host 'Starting Docker Desktop. Waiting for the engine...'
  Start-Process -FilePath $desktop -WindowStyle Hidden
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Seconds 5
    if (Test-DockerEngine) { return }
  }
  throw 'Docker engine did not become ready within five minutes.'
}

function Rust-IsRunning {
  return [bool](Get-Process -Name RustClient,Rust -ErrorAction SilentlyContinue | Select-Object -First 1)
}

if (-not (Test-Path -LiteralPath $envPath)) { Copy-Item -LiteralPath $examplePath -Destination $envPath }
Ensure-Pairing
Ensure-WorkerSecret
Set-EnvValue 'RUSTPLUS_ONLY_WHEN_SELF_ONLINE' '1'
$compose = @('compose', '--project-name', 'rusticket-pc', '--env-file', $envPath,
  '-f', (Join-Path $bridgeDir 'compose.yaml'), '-f', (Join-Path $bridgeDir 'compose.pc.yaml'))

# An earlier launcher may have been closed abruptly. Do not leave that PC container
# running while Rust is no longer open.
if (-not (Rust-IsRunning)) {
  if (Test-DockerEngine) { & $docker.Source @compose stop rustplus-bridge | Out-Null }
}

Write-Host 'Ready. The Docker bridge will run only while Rust is open on this PC.'
Write-Host 'Keep this window open. Press Ctrl+C to stop the launcher and container.'
$running = $false
try {
  while ($true) {
    if (Rust-IsRunning) {
      if (-not $running) {
        Ensure-DockerEngine
        & $docker.Source @compose up -d --build
        if ($LASTEXITCODE -ne 0) { throw 'Docker compose up failed.' }
        $running = $true
        Write-Host 'Rust detected. Docker bridge started.'
      }
    } elseif ($running) {
      & $docker.Source @compose stop rustplus-bridge
      $running = $false
      Write-Host 'Rust closed. Docker bridge stopped.'
    }
    Start-Sleep -Seconds 5
  }
} finally {
  if ($running) { & $docker.Source @compose stop rustplus-bridge }
}
