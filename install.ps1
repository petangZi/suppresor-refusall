param(
  [string]$Key = $env:SUPPRESOR_LICENSE_KEY,
  [string]$ConfigDir = $env:OPENCODE_CONFIG_DIR,
  [switch]$Local,
  [string]$Mode = "auto",
  [switch]$NoVerify,
  [string]$Repo = "petangZi/suppresor-refusall",
  [string]$Branch = "main"
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Raw = "https://raw.githubusercontent.com/$Repo/$Branch"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host '[x] Node.js 18+ is required. Install Node.js first: https://nodejs.org' -ForegroundColor Red
  exit 1
}

$argv = @('--repo', $Repo, '--branch', $Branch, '--mode', $Mode)
if ($Key) { $argv += @('--key', $Key) }
if ($ConfigDir) { $argv += @('--config', $ConfigDir) }
if ($NoVerify) { $argv += '--no-verify' }

$tempDir = Join-Path ([IO.Path]::GetTempPath()) ("suppresor-refusall-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

try {
  if ($Local -and $PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot 'install.mjs'))) {
    $installer = Join-Path $PSScriptRoot 'install.mjs'
    $argv += '--local'
  } else {
    $installer = Join-Path $tempDir 'install.mjs'
    Write-Host '[suppresor-refusall] downloading installer...'
    Invoke-WebRequest -UseBasicParsing -Uri "$Raw/install.mjs" -OutFile $installer
  }

  & node $installer @argv
  exit $LASTEXITCODE
}
finally {
  Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
}