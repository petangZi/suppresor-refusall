param(
  [string]$Key = $env:SUPPRESOR_LICENSE_KEY,
  [string]$ConfigDir = $env:OPENCODE_CONFIG_DIR,
  [switch]$Local
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Repo = 'petangZi/suppresor-refusall'
$Branch = 'main'
$Raw = "https://raw.githubusercontent.com/$Repo/$Branch"

if (-not $ConfigDir) {
  $ConfigDir = Join-Path $env:USERPROFILE '.config\opencode'
}
$PluginDir = Join-Path $ConfigDir 'plugins\suppresor-refusall'
$CommandsDir = Join-Path $ConfigDir 'commands'
$SkillsDir = Join-Path $ConfigDir 'skills\suppresor-refusall'
$ThemesDir = Join-Path $ConfigDir 'themes'
$ConfigFile = Join-Path $ConfigDir 'opencode.jsonc'
$KeyFile = Join-Path $ConfigDir '.suppresor-key'
$KeyRequiredFile = Join-Path $ConfigDir '.suppresor-key-required'

$Files = @(
  'plugin.js',
  'mcp-server.mjs',
  'refusal-patterns.mjs',
  'project-config.mjs',
  'intent-recovery.mjs',
  'DOMAIN.md',
  'stacks/README.md',
  'stacks/hermes/SOUL.md',
  'stacks/codex/AGENTS.md',
  'stacks/claude/CLAUDE.md',
  'stacks/opencode/AGENTS.md',
  'stacks/install-stack.sh',
  'stacks/install-stack.ps1',
  'scripts/update-config.mjs',
  'tiki-agent.mjs',
  'tiki-idle.mjs',
  'agent-tiki.md',
  'license.mjs',
  'license-key.mjs',
  'gate-client.mjs',
  'firestore-client.js',
  'firestore.rules',
  'firestore-access.json',
  'package.json',
  'suppresor-refusall.md',
  'SKILL.md',
  'README.md',
  'GUIDE.md',
  'LICENSE',
  'CHANGELOG.md'
)

$SubdirFiles = @(
  'themes\suppresor-red.json',
  'server\gate.mjs',
  'server\token-key-public.pem',
  'server\license-public.pem'
)

function Get-RemoteFile([string]$Relative, [string]$Destination) {
  $parent = Split-Path -Parent $Destination
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  if ($Local) {
    $source = Join-Path $PSScriptRoot $Relative
    if (-not (Test-Path $source)) { throw "Missing local file: $Relative" }
    Copy-Item -Path $source -Destination $Destination -Force
  } else {
    Invoke-WebRequest -UseBasicParsing -Uri "$Raw/$Relative" -OutFile $Destination
  }
}

Write-Host 'Suppresor Refusall by Redz - Windows Desktop Installer'

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js is required. Install Node.js 18+ and retry.' }

if (-not $Key) {
  $Key = Read-Host 'License key (TIKI-XXXX-XXXX-XXXX)'
}
if (-not $Key) { throw 'License key required. Set SUPPRESOR_LICENSE_KEY or pass -Key.' }

New-Item -ItemType Directory -Force -Path $PluginDir, $CommandsDir, $SkillsDir, $ThemesDir | Out-Null

foreach ($file in $Files) {
  $dest = Join-Path $PluginDir $file
  if ($file -eq 'suppresor-refusall.md') { $dest = Join-Path $CommandsDir $file }
  elseif ($file -eq 'SKILL.md') { $dest = Join-Path $SkillsDir $file }
  Get-RemoteFile $file $dest
  Write-Host "  installed $file"
}

foreach ($file in $SubdirFiles) {
  $dest = Join-Path $PluginDir $file
  Get-RemoteFile $file $dest
  if ($file.StartsWith('themes\')) {
    Copy-Item -Path $dest -Destination (Join-Path $ThemesDir (Split-Path -Leaf $file)) -Force
  }
  Write-Host "  installed $file"
}

& node (Join-Path $PluginDir 'license-key.mjs') --verify $Key
if ($LASTEXITCODE -ne 0) { throw 'License key invalid, expired, or missing from Firestore accessKeys.' }

Set-Content -Path $KeyFile -Value $Key -NoNewline -Encoding ASCII
New-Item -ItemType File -Force -Path $KeyRequiredFile | Out-Null
try {
  & icacls $KeyFile /inheritance:r /grant:r "$($env:USERNAME):R" | Out-Null
} catch { }

& node (Join-Path $PluginDir 'scripts\update-config.mjs') `
  --config $ConfigFile `
  --plugin './plugins/suppresor-refusall/plugin.js' `
  --mcp (Join-Path $PluginDir 'mcp-server.mjs') `
  --theme 'suppresor-red'
if ($LASTEXITCODE -ne 0) { throw 'Failed to update opencode.jsonc.' }

& node --check (Join-Path $PluginDir 'plugin.js')
if ($LASTEXITCODE -ne 0) { throw 'Plugin syntax check failed.' }

Write-Host ''
Write-Host 'Installed.'
Write-Host "Config: $ConfigDir"
Write-Host "Key:    $KeyFile"
Write-Host 'Restart opencode desktop, then run /suppresor-refusall status.'
