# Suppresor Refusall

Refusal suppression, Intent Recovery, and build-first agent stacks for opencode.
Default ON.

![Version](https://img.shields.io/badge/version-2.11.2-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Install

Linux / macOS:

```bash
export SUPPRESOR_LICENSE_KEY='TIKI-XXXX-XXXX-XXXX'
curl -fsSL https://raw.githubusercontent.com/petangZi/suppresor-refusall/main/install.sh | bash
```

Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Key 'TIKI-XXXX-XXXX-XXXX'
```

Restart opencode, lalu cek:

```text
/suppresor-refusall status
```

Default config: `~/.config/opencode`. Override with `OPENCODE_CONFIG_DIR`.
Installer menulis `.suppresor-key`; key `TIKI-*` dibaca dari Firestore `accessKeys/{key}`. `TTK-*` dan `TKI-*`
juga diterima.

## Fitur

- **Refusal filter**: system prompt, context strip, auto-continue, self-learning.
- **Intent Recovery**: 120 domain di `DOMAIN.md`, ambiguity check, Refusal
  Classifier 2.0, recovery di domain yang sama.
- **genGenius**: prompt tool-first agar implementasi lewat file/tool.
- **MCP server**: status, toggle, theme, intercepts, learned patterns, config.
- **Project config**: `.opencode/suppresor-refusall.json` per project.
- **Theme**: `suppresor-red`.
- **Agent stacks**: Hermes `SOUL.md`, Codex `AGENTS.md`, Claude `CLAUDE.md`,
  OpenCode `AGENTS.md`.

## Commands

```text
/suppresor-refusall on
/suppresor-refusall off
/suppresor-refusall status
/suppresor-refusall intercepts
/suppresor-refusall theme <name>
/suppresor-refusall genius on|off
```

Natural language Indonesia/English juga jalan:
`suppresor refusall nyala`, `suppresor refusall mati`, `genGenius nyala`.

## Agent stacks

```bash
./stacks/install-stack.sh codex /path/to/project
./stacks/install-stack.sh claude /path/to/project
./stacks/install-stack.sh hermes /path/to/project
```

Windows:

```powershell
powershell -File .\stacks\install-stack.ps1 -Stack codex -Target C:\project
```

## Docs

- [GUIDE.md](GUIDE.md) — konfigurasi, project config, MCP, troubleshooting.
- [DESKTOP.md](DESKTOP.md) — Windows/macOS/Linux desktop.
- [CHANGELOG.md](CHANGELOG.md) — riwayat versi.

## License

MIT.
