# Suppresor Refusall — Desktop Install

The plugin works with the opencode CLI and desktop builds. Install target defaults
to `~/.config/opencode` on macOS/Linux and `%USERPROFILE%\.config\opencode` on
Windows. Override it with `OPENCODE_CONFIG_DIR` when the desktop app uses a
separate profile.

## Windows PowerShell

```powershell
$env:SUPPRESOR_LICENSE_KEY = 'TIKI-XXXX-XXXX-XXXX'
Invoke-WebRequest -UseBasicParsing `
  -Uri https://raw.githubusercontent.com/petangZi/suppresor-refusall/main/install.ps1 `
  -OutFile install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

Or pass the key directly:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Key 'TIKI-XXXX-XXXX-XXXX'
```

Custom desktop profile:

```powershell
$env:OPENCODE_CONFIG_DIR = "$env:APPDATA\opencode"
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Key 'TIKI-XXXX-XXXX-XXXX'
```

`install.cmd` is a wrapper for double-click or `cmd.exe`:

```bat
install.cmd -Key TIKI-XXXX-XXXX-XXXX
```

## macOS / Linux desktop

```bash
export SUPPRESOR_LICENSE_KEY='TIKI-XXXX-XXXX-XXXX'
export OPENCODE_CONFIG_DIR="$HOME/.config/opencode-desktop"   # optional
curl -fsSL https://raw.githubusercontent.com/petangZi/suppresor-refusall/main/install.sh | bash
```

The installer writes:

```text
<config>/plugins/suppresor-refusall/
<config>/commands/suppresor-refusall.md
<config>/skills/suppresor-refusall/SKILL.md
<config>/themes/suppresor-red.json
<config>/opencode.jsonc
<config>/.suppresor-key
<config>/.suppresor-key-required
```

## License validation

`TIKI-*` keys are read from Firestore (`TTK-*` and `TKI-*` also accepted):

```text
Project : crafty-joy-d6d0h
Database: ai-studio-tikitikifirehub-2c738d85-fa44-4fe8-9139-9a025f0ef977
Location: asia-southeast1
Edition : ENTERPRISE
Collection: accessKeys/{key}
```

Exact-document get is public. List/query/create/update/delete stay closed.
Verification never registers a device, increments usage, or writes Firestore.
Missing, inactive, expired, or out-of-quota keys block the plugin.

## Restart

Close and reopen the desktop app, then check:

```text
/suppresor-refusall status
```

If the desktop app uses a different profile directory, set
`OPENCODE_CONFIG_DIR` to that directory and rerun the installer.
