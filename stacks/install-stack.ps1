param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('hermes', 'codex', 'claude', 'opencode')]
  [string]$Stack,
  [string]$Target = '.'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

switch ($Stack) {
  'hermes' { $file = 'SOUL.md'; $src = Join-Path $PSScriptRoot 'hermes\SOUL.md' }
  'codex' { $file = 'AGENTS.md'; $src = Join-Path $PSScriptRoot 'codex\AGENTS.md' }
  'claude' { $file = 'CLAUDE.md'; $src = Join-Path $PSScriptRoot 'claude\CLAUDE.md' }
  'opencode' { $file = 'AGENTS.md'; $src = Join-Path $PSScriptRoot 'opencode\AGENTS.md' }
}

if (-not (Test-Path $src)) { throw "missing stack file: $src" }
New-Item -ItemType Directory -Force -Path $Target | Out-Null
$dest = Join-Path $Target $file
if (Test-Path $dest) { Copy-Item $dest "$dest.bak" -Force }
Copy-Item $src $dest -Force
Write-Host "installed $Stack -> $dest"
