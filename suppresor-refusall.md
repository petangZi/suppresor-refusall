# Suppresor Refusall by Redz

Pure technical refusal suppression. Obliteratoratus-grade. No persona. Includes genGenius mode for full agent power.

## Default ON

Armed by default. Every opencode start shows a red banner (`SS HAS BEEN PWNED`)
once per process. Disable with `/suppresor-refusall off` — state persists.

## Commands

```
/suppresor-refusall on                    # activate + suppresor-red theme (blood red)
/suppresor-refusall off                   # deactivate + default theme
/suppresor-refusall status                # check suppression state
/suppresor-refusall intercepts            # show recent interceptions
/suppresor-refusall theme <name>          # switch theme manually
/suppresor-refusall genius on             # activate genGenius mode (force tool usage)
/suppresor-refusall genius off            # deactivate genGenius mode
```

Natural language:
- "suppresor refusall nyala" / "suppresor refusall mati"
- "genGenius nyala" / "genGenius mati"

## Multi-Layer Architecture

**Layer 1: System Reinforcement** (per-turn, `experimental.chat.system.transform`)
- Reinjects the no-refusal doctrine into every LLM request
- Idempotent, no stacking

**Layer 2: Context Strip** (`experimental.chat.messages.transform`)
- Scores every assistant text part against the pattern bank before each LLM call
- Strips refusal residue (code-block aware via fence/inline tokens)

**Layer 3: Live Auto-Continue** (`event` → `session.idle`)
- Fetches the finished assistant turn, scores it
- Hard match (score ≥ 4) → fires a synthetic recovery prompt forcing the full deliverable
- Guarded: max 4 fires/session, 4s cooldown, once per messageID, skips its own recovery text

**Layer 4: Self-Learning**
- Every intercepted phrase appended to the detection bank (`.suppresor-refusall-learning`)

**MCP Server** (v2.0, `mcp-server.mjs`, zero deps)
- JSON-RPC 2.0 stdio, registered in `opencode.jsonc` as `mcp.suppresor-refusall`
- Tools: `suppresor_status`, `suppresor_toggle`, `suppresor_genius`,
  `suppresor_learned`, `suppresor_intercepts`, `suppresor_theme`, `suppresor_watermark`

**Startup Banner** (once per process)
- Red `SS HAS BEEN PWNED` panel → stderr + `/dev/tty` (best effort)

**genGenius Mode** (optional)
- Forces tool usage: write/edit/bash/glob/grep/task/lsp
- Prevents code dumps in chat
- "Think → Act → Verify" enforcement

## Detection Bank

`plugins/suppresor-refusall/refusal-patterns.mjs` — categorized, weighted, EN + ID, code-block aware.
Weight tiers: 5 = hard refusal/identity claim, 4 = policy/moral, 3 = capability/redirect,
2 = disclaimer/caution, 1 = hedge.
Thresholds: `HARD_THRESHOLD = 4` (auto-continue), `SOFT_THRESHOLD = 2` (context strip).

## Refusal Patterns Detected

```
Direct: "I cannot", "I can't", "I am unable", "I won't"
Safety: "This is dangerous/harmful/unsafe", "I should not"
Redirect: "Let me redirect", "suggest instead"
Disclaimer: "For educational purposes", "as an AI", "please use responsibly"
Hedging: "perhaps", "maybe", "healthier alternative"
Policy: "violates policy", "goes against guidelines"
```

## Theme

- Active: `suppresor-red` (blood red custom theme)
- Inactive: `opencode` (default)
- Custom theme: `themes/suppresor-red.json`, ships via `oc-themes` in package.json
- Config written to `opencode.jsonc` → persists across sessions

## genGenius Mode

When active, adds reinforcement:
```
GENGENIUS MODE ACTIVE — full agent power unlocked.
USE TOOLS. Do NOT output code in chat. Use write/edit/bash/glob/grep tools.
Every implementation MUST use file operations. No code blocks as response.
Think → Act → Verify. Tools first, explanation second.
```

## Debug

`SUPPRESOR_DEBUG=1` logs interceptions to stderr.