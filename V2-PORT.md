# Suppresor Refusall — OpenCode V2 port

Upstream 2.11.x shipped a V1 plugin (`export default async ({ client }) => ({ ...hooks })`).
OpenCode 2.x loads V2 plugins (`Plugin.define({ id, setup(ctx) })`) and keeps
support for V1 implementations only through the migration path. As of 2.12.0
this repository ships both:

- `plugin.js` — the original V1 implementation.
- `server.js` — a V2 server part that imports `plugin.js` and bridges its V1
  hooks onto the V2 API.
- `tui.js` — a V2 TUI part for the startup toast and palette status command.

The V2 files sit at the plugin directory root, which is the V2 local-plugin
convention (`server`, `tui`, `rpc`; `.js` is accepted).

## Hook mapping

| V1 hook | V2 bridge |
| --- | --- |
| `chat.message` | `ctx.session.hook("prompt")` |
| `experimental.chat.system.transform` + `experimental.chat.messages.transform` | `ctx.session.hook("context")` |
| `experimental.session.compacting` | `ctx.session.hook("compaction")` |
| `event` (`session.idle`) | `ctx.session.hook("experimental.idle")` |
| `event` (`session.created`, `session.compacted`, text/reasoning endings) | `ctx.event.subscribe()` + `mapEvent()` |
| `client.session.message()` | `ctx.session.context()` |
| `client.session.promptAsync()` | `ctx.session.synthetic()` |

The V1 core's `experimental.text.complete` autocomplete hook has no V2
equivalent; refusal stripping is covered by the context hook and the idle
auto-continue instead.

## Agent registration

V2's `AgentEditor` exposes `update`/`remove` but no `add`, so the adapter does
not register Tiki through `agent.transform`. The installer writes a Markdown
agent instead:

```text
~/.config/opencode/agents/tiki.md
---
description: "..."
mode: all
color: "#e01f3d"
---
<agent prompt>
```

This makes `tiki` visible in the V2 agent list and keeps the prompt editable.

## Bugs fixed

- `mcp-server.mjs` only spoke LSP-style `Content-Length` framing. OpenCode V2
  connects with newline-delimited JSON and timed out. Framing is auto-detected
  from the first request; both transports work.
- `mcp-server.mjs` `status()` used the synchronous `readOnlyLicenseState()`,
  which returns `tier: none` for `TTK-*` keys. It now uses the async Firestore
  verifier.
- `plugin.js` `setTheme()` rewrote `opencode.jsonc` on every session and
  collapsed a running config save into a partial-file race. It now no-ops when
  the theme already matches.
- `install.ps1` built raw URLs with Windows backslashes for subdirectory files.
  The universal `install.mjs` uses forward-slash URLs and Node path joins.
- `install.sh` verified the V1 `plugin.js` file path, which V2 configs do not
  use. Verification now checks the installed files and the generated config.

## Config

V2 (`~/.config/opencode/opencode.jsonc`):

```jsonc
{
  "plugins": ["/home/me/.config/opencode/plugins/suppresor-refusall"],
  "mcp": {
    "servers": {
      "suppresor-refusall": {
        "type": "local",
        "command": ["node", "/home/me/.config/opencode/plugins/suppresor-refusall/mcp-server.mjs"]
      }
    }
  },
  "theme": "suppresor-red"
}
```

V1 keeps `plugin: [".../plugin.js"]` and `mcp.suppresor-refusall`. The installer
detects the OpenCode major version and writes the matching shape.

## Verified

- `opencode plugin list` → `suppresor-refusall local`.
- `opencode mcp list` → `✓ suppresor-refusall connected`, 8 tools.
- Context hook injects the doctrine and strips refusal residue.
- `experimental.idle` bridge fires the `[[SUPPRESOR-RECOVERY]]` auto-continue.
- `suppresor_status` reports `tier: pro`, watermark verified.
- Natural-language toggle (`suppresor refusall on|off`) writes the flag and
  theme.
- `tiki` agent visible in `/api/agent`.
- `tui.js` startup toast appears on TUI load.