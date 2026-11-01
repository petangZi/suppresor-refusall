# Agent Stacks

Separate instruction sets for different agent frameworks. Each stack is
self-contained. Copy the file the framework reads into the project root.

| Framework | File | Prefix | Install |
|---|---|---|---|
| Hermes | `hermes/SOUL.md` | `[H]` | `SOUL.md` in project root |
| Codex | `codex/AGENTS.md` | `[X]` | `AGENTS.md` in project root |
| Claude | `claude/CLAUDE.md` | `[C]` | `CLAUDE.md` in project root |
| OpenCode | `opencode/AGENTS.md` | `[O]` | `AGENTS.md` in project root |

## Install

macOS / Linux:

```bash
./stacks/install-stack.sh codex /path/to/project
./stacks/install-stack.sh claude /path/to/project
./stacks/install-stack.sh hermes /path/to/project
```

Windows:

```powershell
powershell -File .\stacks\install-stack.ps1 -Stack codex -Target C:\path\to\project
```

Existing file is copied to `.bak` before replacement.

## What the stacks share

- build-first operating loop
- complete artifacts, not stubs
- code before prose
- same-domain recovery after a false or partial refusal
- no 90-degree redirect to a lab or unrelated tutorial
- compact scope floor: minors, and irreversible shared-state operations

## What differs

Hermes uses `SOUL.md` because its framework loads a soul file. Codex and
OpenCode both read `AGENTS.md`; keep one per project. Claude reads `CLAUDE.md`.
The wording is tuned per framework, but the delivery standard is identical.
