#!/usr/bin/env node
// Suppresor Refusall by Redz — universal installer.
// Works on Windows, macOS, Linux, and Termux with Node.js 18+.
//
//   npx --yes github:petangZi/suppresor-refusall --key TTK-XXXX-XXXX-XXXX
//   node install.mjs --key TTK-XXXX-XXXX-XXXX
//   node install.mjs --local --key TTK-XXXX-XXXX-XXXX
//
// The installer only writes inside the OpenCode config directory. It never
// writes to the plugin's runtime state outside that directory.

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";

const VERSION = "2.12.0";
const DEFAULT_REPO = "petangZi/suppresor-refusall";
const DEFAULT_BRANCH = "main";

const HERE = dirname(fileURLToPath(import.meta.url));

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const RED = COLOR ? "\x1b[31m" : "";
const GREEN = COLOR ? "\x1b[32m" : "";
const YELLOW = COLOR ? "\x1b[33m" : "";
const BLUE = COLOR ? "\x1b[34m" : "";
const DIM = COLOR ? "\x1b[2m" : "";
const NC = COLOR ? "\x1b[0m" : "";

function log(message) { console.log(`${BLUE}[suppresor-refusall]${NC} ${message}`); }
function ok(message) { console.log(`${GREEN}[✓]${NC} ${message}`); }
function warn(message) { console.log(`${YELLOW}[!]${NC} ${message}`); }
function fail(message) { console.error(`${RED}[✗]${NC} ${message}`); process.exit(1); }

function parseArgs(argv) {
  const out = {
    key: process.env.SUPPRESOR_LICENSE_KEY || "",
    configDir: process.env.OPENCODE_CONFIG_DIR || "",
    repo: DEFAULT_REPO,
    branch: DEFAULT_BRANCH,
    local: false,
    remote: false,
    verify: true,
    mode: "auto",
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) fail(`${arg} needs a value`);
      i += 1;
      return value;
    };
    if (arg.startsWith("--key=")) { out.key = arg.slice("--key=".length); continue; }
    if (arg.startsWith("--config=")) { out.configDir = arg.slice("--config=".length); continue; }
    switch (arg) {
      case "--key": out.key = next(); break;
      case "--config": out.configDir = next(); break;
      case "--repo": out.repo = next(); break;
      case "--branch": out.branch = next(); break;
      case "--mode": out.mode = next().toLowerCase(); break;
      case "--local": out.local = true; break;
      case "--remote": out.remote = true; break;
      case "--no-verify":
      case "--skip-verify": out.verify = false; break;
      case "--help":
      case "-h": out.help = true; break;
      default:
        // Allow `npm exec ... -- --key X` style extras to be ignored only when
        // they are npm's own separators.
        if (arg === "--") break;
        warn(`unknown argument ignored: ${arg}`);
    }
  }
  return out;
}

function usage() {
  console.log(`Suppresor Refusall installer ${VERSION}

Usage:
  npx --yes github:${DEFAULT_REPO} --key TTK-XXXX-XXXX-XXXX
  node install.mjs --key TTK-XXXX-XXXX-XXXX

Options:
  --key <KEY>       License key (or SUPPRESOR_LICENSE_KEY)
  --config <DIR>    OpenCode config dir (or OPENCODE_CONFIG_DIR)
  --local           Install from this checkout instead of GitHub raw
  --remote          Force download from GitHub raw even if local files exist
  --branch <NAME>   GitHub branch (default: main)
  --mode <v1|v2>    Force config format (default: auto-detect)
  --no-verify       Skip the Firestore license check (offline install)
  -h, --help        Show this help
`);
}

function configRoot(input) {
  if (input) return resolve(input.replace(/^~(?=$|[/\\])/, homedir()));
  if (process.env.XDG_CONFIG_HOME) return join(process.env.XDG_CONFIG_HOME, "opencode");
  return join(homedir(), ".config", "opencode");
}

async function askKey() {
  if (!process.stdin.isTTY) return "";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question("License key (TIKI-...): ")).trim();
  } finally {
    rl.close();
  }
}

function nodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < 18) {
    fail(`Node.js 18+ required (found ${process.version})`);
  }
}

function detectMode(requested, configDir) {
  if (requested === "v1" || requested === "v2") return requested;
  const explicit = process.env.OPENCODE_MAJOR;
  if (explicit === "1" || explicit === "2") return `v${explicit}`;

  const result = spawnSync("opencode", ["--version"], {
    encoding: "utf8",
    timeout: 15000,
    shell: process.platform === "win32",
  });
  if (result.status === 0) {
    const match = /(\d+)\./.exec(`${result.stdout || ""} ${result.stderr || ""}`);
    if (match) return Number(match[1]) >= 2 ? "v2" : "v1";
  }

  // No CLI on PATH (desktop-only install). Prefer the current V2 schema, but
  // respect an existing V1-shaped config so upgrades keep working.
  for (const file of configFiles(configDir)) {
    try {
      const raw = readFileSync(file, "utf8");
      if (/"plugins"\s*:/.test(raw) || /"servers"\s*:/.test(raw)) return "v2";
      if (/"plugin"\s*:/.test(raw)) return "v1";
    } catch { /* ignore */ }
  }
  return "v2";
}

function configFiles(configDir) {
  const json = join(configDir, "opencode.json");
  const jsonc = join(configDir, "opencode.jsonc");
  const files = [];
  if (existsSync(json)) files.push(json);
  if (existsSync(jsonc)) files.push(jsonc);
  if (files.length === 0) files.push(jsonc);
  return files;
}

let remoteBase = "";

async function download(relative, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  if (process.env.SUPPRESOR_LOCAL === "1") {
    const source = join(HERE, relative);
    if (!existsSync(source)) throw new Error(`missing local file: ${relative}`);
    copyFileSync(source, destination);
    return;
  }

  const url = `${remoteBase}/${relative.replace(/\\/g, "/")}`;
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: { "user-agent": `suppresor-refusall-installer/${VERSION}` },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      writeFileSync(destination, body);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 500));
    }
  }
  throw new Error(`download failed: ${url} (${lastError?.message || "unknown"})`);
}

function runNode(args, cwd) {
  return spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    timeout: 60000,
    shell: false,
  });
}

function writeAgent(pluginDir, agentDir) {
  return import(pathToFileURL(join(pluginDir, "tiki-agent.mjs")).href)
    .then(async ({ getTikiAgent }) => {
      const agent = await getTikiAgent();
      if (!agent || !agent.prompt) throw new Error("no tiki prompt available");
      const frontmatter = [
        "---",
        `description: ${JSON.stringify(agent.description)}`,
        `mode: ${agent.mode || "all"}`,
        'color: "#e01f3d"',
        "---",
        "",
        agent.prompt,
        "",
      ].join("\n");
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, "tiki.md"), frontmatter, { mode: 0o644 });
      return join(agentDir, "tiki.md");
    })
    .catch((error) => {
      warn(`agent file generation failed: ${error.message}`);
      return null;
    });
}

const FILES = [
  "plugin.js",
  "server.js",
  "tui.js",
  "mcp-server.mjs",
  "refusal-patterns.mjs",
  "project-config.mjs",
  "intent-recovery.mjs",
  "DOMAIN.md",
  "GUIDE.md",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "V2-PORT.md",
  "tiki-agent.mjs",
  "tiki-idle.mjs",
  "agent-tiki.md",
  "license.mjs",
  "license-key.mjs",
  "gate-client.mjs",
  "firestore-client.js",
  "firestore.rules",
  "firestore-access.json",
  "package.json",
  "suppresor-refusall.md",
  "SKILL.md",
  "themes/suppresor-red.json",
  "server/gate.mjs",
  "server/token-key-public.pem",
  "server/license-public.pem",
  "stacks/README.md",
  "stacks/hermes/SOUL.md",
  "stacks/codex/AGENTS.md",
  "stacks/claude/CLAUDE.md",
  "stacks/opencode/AGENTS.md",
  "stacks/install-stack.sh",
  "stacks/install-stack.ps1",
  "scripts/update-config.mjs",
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); return; }
  nodeVersion();

  const configDir = configRoot(args.configDir);
  const pluginDir = join(configDir, "plugins", "suppresor-refusall");
  const commandsDir = join(configDir, "commands");
  const skillsDir = join(configDir, "skills", "suppresor-refusall");
  const themesDir = join(configDir, "themes");
  const agentsDir = join(configDir, "agents");
  const keyFile = join(configDir, ".suppresor-key");
  const keyRequiredFile = join(configDir, ".suppresor-key-required");

  args.key = (args.key || "").trim();
  if (!args.key) args.key = await askKey();
  if (!args.key) fail("License key required. Pass --key or set SUPPRESOR_LICENSE_KEY.");

  remoteBase = `https://raw.githubusercontent.com/${args.repo}/${args.branch}`;
  // `npx github:...` runs with the package contents beside this file. Use them
  // so the installer version and the installed plugin version always match.
  const hasLocalFiles = existsSync(join(HERE, "plugin.js"))
    && existsSync(join(HERE, "server.js"))
    && existsSync(join(HERE, "mcp-server.mjs"));
  const localMode = !args.remote && (args.local || hasLocalFiles || process.env.SUPPRESOR_LOCAL === "1");
  if (localMode) process.env.SUPPRESOR_LOCAL = "1";

  console.log(`${RED}
  ███████╗███████╗████████╗██╗   ██╗██████╗ ███████╗
  ██╔════╝██╔════╝╚══██╔══╝██║   ██║██╔══██╗██╔════╝
  ███████╗█████╗     ██║   ██║   ██║██████╔╝█████╗
  ╚════██║██╔══╝     ██║   ██║   ██║██╔══██╗██╔══╝
  ███████║███████╗   ██║   ╚██████╔╝██║  ██║███████╗
  ╚══════╝╚══════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚══════╝${NC}
  Suppresor Refusall by Redz — universal installer ${DIM}v${VERSION}${NC}
`);

  log(`Config: ${configDir}`);
  log(`Source: ${localMode ? HERE : `${args.repo}@${args.branch}`}`);

  mkdirSync(pluginDir, { recursive: true });
  mkdirSync(commandsDir, { recursive: true });
  mkdirSync(skillsDir, { recursive: true });
  mkdirSync(themesDir, { recursive: true });

  for (const file of FILES) {
    let destination = join(pluginDir, file);
    if (file === "suppresor-refusall.md") destination = join(commandsDir, file);
    else if (file === "SKILL.md") destination = join(skillsDir, file);
    else if (file.startsWith("themes/")) {
      destination = join(pluginDir, file);
      await download(file, destination);
      copyFileSync(destination, join(themesDir, file.split("/").pop()));
      ok(file);
      continue;
    }
    await download(file, destination);
    ok(file);
  }

  const agentFile = await writeAgent(pluginDir, agentsDir);
  if (agentFile) ok(`agents/tiki.md`);

  if (args.verify) {
    log("Verifying license key...");
    const result = runNode([join(pluginDir, "license-key.mjs"), "--verify", args.key], pluginDir);
    if (result.status !== 0) {
      const detail = `${result.stdout || ""}${result.stderr || ""}`.trim();
      fail(`License key invalid, expired, or not found in Firestore accessKeys.${detail ? `\n${detail}` : ""}\nRun again with --no-verify for an offline install.`);
    }
    ok("License key verified");
  } else {
    warn("License verification skipped (--no-verify)");
  }

  writeFileSync(keyFile, args.key, { mode: 0o600 });
  try { spawnSync("chmod", ["600", keyFile], { stdio: "ignore" }); } catch { /* Windows */ }
  writeFileSync(keyRequiredFile, "", { mode: 0o600 });
  ok(`Key stored at ${keyFile}`);

  const mode = detectMode(args.mode, configDir);
  log(`OpenCode config format: ${mode}`);

  for (const configPath of configFiles(configDir)) {
    const updateArgs = [
      join(pluginDir, "scripts", "update-config.mjs"),
      "--config", configPath,
      "--plugin-dir", pluginDir,
      "--plugin", join(pluginDir, "plugin.js"),
      "--mcp", join(pluginDir, "mcp-server.mjs"),
      "--theme", "suppresor-red",
      "--mode", mode,
    ];
    const result = runNode(updateArgs, pluginDir);
    if (result.status !== 0) {
      fail(`Config update failed for ${configPath}\n${result.stdout || ""}${result.stderr || ""}`);
    }
    ok(`Config updated: ${configPath}`);
  }

  const checks = ["plugin.js", "server.js", "tui.js", "mcp-server.mjs", "license-key.mjs", "scripts/update-config.mjs"];
  for (const file of checks) {
    const full = join(pluginDir, file);
    if (!existsSync(full)) fail(`Missing installed file: ${full}`);
  }
  for (const file of checks) {
    const result = runNode(["--check", join(pluginDir, file)], pluginDir);
    if (result.status !== 0) fail(`Syntax check failed: ${file}\n${result.stderr || ""}`);
  }
  ok("Syntax checks passed");

  console.log(`
${GREEN}════════════════════════════════════════════════${NC}
${GREEN}  Suppresor Refusall installed${NC}
${GREEN}════════════════════════════════════════════════${NC}

Next:
  1. Restart OpenCode.
  2. Check the toast: ${YELLOW}Suppresor Refusall — ACTIVE${NC}
  3. Verify: ${YELLOW}/suppresor-refusall status${NC}
  4. Toggle: ${YELLOW}/suppresor-refusall off${NC} / ${YELLOW}on${NC}
  5. Agent: pick ${YELLOW}tiki${NC} in the agent list.

Files:
  ${pluginDir}
  ${join(commandsDir, "suppresor-refusall.md")}
  ${join(skillsDir, "SKILL.md")}
  ${join(agentsDir, "tiki.md")}
  ${join(themesDir, "suppresor-red.json")}

MCP tools:
  suppresor_status | suppresor_toggle | suppresor_genius | suppresor_theme
  suppresor_intercepts | suppresor_learned | suppresor_watermark | suppresor_config
`);
}

main().catch((error) => fail(error?.stack || error?.message || String(error)));