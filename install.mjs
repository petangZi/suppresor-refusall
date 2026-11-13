#!/usr/bin/env node
// Suppresor Refusall by Redz — universal installer.
// Works on Windows, macOS, Linux, and Termux with Node.js 18+.
//
//   npx --yes github:petangZi/suppresor-refusall --key TTK-XXXX-XXXX-XXXX
//   node install.mjs --key TTK-XXXX-XXXX-XXXX
//   node install.mjs --local --key TTK-XXXX-XXXX-XXXX
//   node install.mjs --doctor
//
// Installs are staged and verified before the live plugin directory is touched.
// A failed download, a truncated file, or a broken agent prompt aborts the
// install instead of leaving a half-working setup.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";

const VERSION = "2.13.0";
const DEFAULT_REPO = "petangZi/suppresor-refusall";
const DEFAULT_BRANCH = "main";
const MANIFEST = ".suppresor-install.json";
const BACKUP_PREFIX = ".suppresor-backup-";

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
function fail(message) { throw new Error(message); }

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
    doctor: false,
    repair: false,
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
      case "--repair": out.repair = true; break;
      case "--doctor": out.doctor = true; break;
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
  node install.mjs --doctor

Options:
  --key <KEY>       License key (or SUPPRESOR_LICENSE_KEY)
  --config <DIR>    OpenCode config dir (or OPENCODE_CONFIG_DIR)
  --local           Install from this checkout instead of GitHub raw
  --remote          Force download from GitHub raw even if local files exist
  --repair          Reinstall over an existing setup, reusing the stored key
  --doctor          Check an existing install without changing files
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

function detectExistingMode(configDir) {
  for (const file of configFiles(configDir)) {
    try {
      const raw = readFileSync(file, "utf8");
      if (/"plugins"\s*:/.test(raw) || /"servers"\s*:/.test(raw)) return "v2";
      if (/"plugin"\s*:/.test(raw)) return "v1";
    } catch { /* ignore */ }
  }
  return null;
}

function detectMode(requested, configDir) {
  if (requested === "v1" || requested === "v2") return requested;
  const explicit = process.env.OPENCODE_MAJOR;
  if (explicit === "1" || explicit === "2") return `v${explicit}`;

  const result = spawnSync("opencode", ["--version"], {
    encoding: "utf8",
    timeout: 5000,
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

function stripJsonc(text) {
  let out = "";
  let inString = false;
  let escape = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const n = text[i + 1];
    if (lineComment) {
      if (c === "\n") { lineComment = false; out += c; }
      continue;
    }
    if (blockComment) {
      if (c === "*" && n === "/") { blockComment = false; i += 1; }
      continue;
    }
    if (inString) {
      out += c;
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === "/" && n === "/") { lineComment = true; i += 1; continue; }
    if (c === "/" && n === "*") { blockComment = true; i += 1; continue; }
    out += c;
  }
  return out.replace(/,\s*([}\]])/g, "$1");
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

let remoteBase = "";
let localMode = false;

function localSource(relative) {
  return join(HERE, relative);
}

async function download(relative, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  const tmp = `${destination}.part-${process.pid}`;

  const copySource = (source) => {
    const stat = statSync(source);
    if (!stat.isFile() || stat.size === 0) throw new Error(`empty source file: ${source}`);
    copyFileSync(source, tmp);
    renameSync(tmp, destination);
  };

  if (localMode) {
    const source = localSource(relative);
    if (!existsSync(source)) fail(`missing local file: ${relative}`);
    copySource(source);
    return;
  }

  const url = `${remoteBase}/${relative.replace(/\\/g, "/")}`;
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: { "user-agent": `suppresor-refusall-installer/${VERSION}` },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length === 0) throw new Error("empty response");
      writeFileSync(tmp, body);
      renameSync(tmp, destination);
      return;
    } catch (error) {
      lastError = error;
      try { rmSync(tmp, { force: true }); } catch { /* best effort */ }
      if (attempt < 4) await sleep(attempt * 400);
    }
  }

  // A checkout that was forced into remote mode still has a usable local copy.
  const fallback = localSource(relative);
  if (existsSync(fallback)) {
    warn(`remote failed for ${relative}; using local copy`);
    copySource(fallback);
    return;
  }
  fail(`download failed: ${url} (${lastError?.message || "unknown"})`);
}

function runNode(args, cwd) {
  return spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    timeout: 60000,
    shell: false,
  });
}

function renameRetry(from, to) {
  let lastError = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      lastError = error;
      if (error.code === "EXDEV") {
        cpSync(from, to, { recursive: true });
        rmSync(from, { recursive: true, force: true });
        return;
      }
      if (!["EPERM", "EACCES", "EBUSY", "ENOTEMPTY"].includes(error.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120);
    }
  }
  throw lastError;
}

function atomicCopy(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  const tmp = `${destination}.suppresor-tmp-${process.pid}`;
  const previous = `${destination}.suppresor-prev-${process.pid}`;
  let hadPrevious = false;
  try {
    copyFileSync(source, tmp);
    if (existsSync(destination)) {
      renameRetry(destination, previous);
      hadPrevious = true;
    }
    renameRetry(tmp, destination);
    if (hadPrevious) rmSync(previous, { force: true });
  } catch (error) {
    try { rmSync(tmp, { force: true }); } catch { /* best effort */ }
    if (hadPrevious) {
      try { renameRetry(previous, destination); } catch { /* keep previous */ }
    }
    throw error;
  }
}

const FILES = [
  "plugin.js",
  "server.js",
  "tui.js",
  "agent-file.mjs",
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

// Anything below this size is a truncated download or an error page, not a
// usable file. Keep the numbers intentionally low; the syntax check is the
// stronger gate.
const MIN_BYTES = {
  "plugin.js": 5000,
  "server.js": 2000,
  "tui.js": 2000,
  "agent-file.mjs": 1000,
  "mcp-server.mjs": 2000,
  "agent-tiki.md": 5000,
  "license.mjs": 5000,
  "license-key.mjs": 2000,
  "gate-client.mjs": 1000,
  "firestore-client.js": 2000,
  "scripts/update-config.mjs": 1000,
  "package.json": 100,
  "themes/suppresor-red.json": 100,
};

const CRITICAL_JS = [
  "plugin.js",
  "server.js",
  "tui.js",
  "agent-file.mjs",
  "mcp-server.mjs",
  "tiki-agent.mjs",
  "tiki-idle.mjs",
  "license.mjs",
  "license-key.mjs",
  "gate-client.mjs",
  "firestore-client.js",
  "scripts/update-config.mjs",
];

function validateStaged(stageDir) {
  for (const file of FILES) {
    const full = join(stageDir, file);
    if (!existsSync(full)) fail(`missing staged file: ${file}`);
    const size = statSync(full).size;
    const minimum = MIN_BYTES[file] || 1;
    if (size < minimum) fail(`truncated file: ${file} (${size} bytes, need ${minimum})`);
  }

  const agentPrompt = readFileSync(join(stageDir, "agent-tiki.md"), "utf8");
  if (!agentPrompt.includes("TIKI LICKY") || !agentPrompt.includes("Target Gate")) {
    fail("agent-tiki.md is not a valid Tiki prompt");
  }

  try {
    JSON.parse(readFileSync(join(stageDir, "package.json"), "utf8"));
    JSON.parse(readFileSync(join(stageDir, "themes", "suppresor-red.json"), "utf8"));
  } catch (error) {
    fail(`invalid JSON in staged files: ${error.message}`);
  }

  for (const file of CRITICAL_JS) {
    const result = runNode(["--check", join(stageDir, file)], stageDir);
    if (result.status !== 0) {
      fail(`syntax check failed: ${file}\n${result.stderr || result.stdout || ""}`);
    }
  }
  ok(`staged ${FILES.length} files, syntax clean`);
}

async function installAgent(stageDir, configDir) {
  const module = await import(`${pathToFileURL(join(stageDir, "agent-file.mjs")).href}?v=${Date.now()}`);
  const result = module.ensureTikiAgentFile({ configDir, sourceDir: stageDir, force: true });
  if (!result.path) fail(`Tiki agent install failed: ${result.reason}`);
  const check = module.verifyTikiAgentFile({ configDir });
  if (!check.ok) fail(`Tiki agent verification failed: ${check.reason}`);
  ok(`agents/tiki.md (${Math.round(check.size / 1024)} KB)`);
  return check.path;
}

function swapPluginDir(stageDir, pluginDir, configDir) {
  let backup = null;
  mkdirSync(dirname(pluginDir), { recursive: true });
  if (existsSync(pluginDir)) {
    backup = join(configDir, `${BACKUP_PREFIX}${Date.now()}`);
    try {
      renameRetry(pluginDir, backup);
    } catch (error) {
      fail(`cannot replace the live plugin directory. Close OpenCode and run again.\n${error.message}`);
    }
  }
  try {
    renameRetry(stageDir, pluginDir);
  } catch (error) {
    if (backup) {
      try { renameRetry(backup, pluginDir); } catch { /* keep backup for manual restore */ }
    }
    fail(`cannot activate the new plugin directory.\n${error.message}${backup ? `\nBackup kept at: ${backup}` : ""}`);
  }
  pruneBackups(configDir);
  return backup;
}

function pruneBackups(configDir) {
  try {
    const backups = [];
    for (const name of readdirSync(configDir)) {
      if (name.startsWith(BACKUP_PREFIX)) backups.push(join(configDir, name));
    }
    backups.sort();
    while (backups.length > 2) rmSync(backups.shift(), { recursive: true, force: true });
    return backups;
  } catch {
    return [];
  }
}

function copyAncillary(pluginDir, configDir) {
  const command = join(pluginDir, "suppresor-refusall.md");
  const skill = join(pluginDir, "SKILL.md");
  const theme = join(pluginDir, "themes", "suppresor-red.json");
  for (const [source, destination] of [
    [command, join(configDir, "commands", "suppresor-refusall.md")],
    [skill, join(configDir, "skills", "suppresor-refusall", "SKILL.md")],
    [theme, join(configDir, "themes", "suppresor-red.json")],
  ]) {
    if (!existsSync(source)) fail(`missing file after swap: ${source}`);
    atomicCopy(source, destination);
  }
  ok("command, skill, and theme installed");
}

function updateConfigs(pluginDir, configDir, mode, backups) {
  for (const configPath of configFiles(configDir)) {
    if (existsSync(configPath)) {
      const backup = `${configPath}.suppresor-preinstall`;
      try { copyFileSync(configPath, backup); backups.set(configPath, backup); } catch { backups.set(configPath, null); }
    } else {
      backups.set(configPath, null);
    }
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
}

function verifyConfig(pluginDir, configDir) {
  const problems = [];
  const pluginPath = join(pluginDir, "plugin.js");
  const mcpPath = join(pluginDir, "mcp-server.mjs");
  const normalized = (value) => String(value).replace(/\\/g, "/").replace(/\/+$/, "");
  let foundPlugin = false;
  let foundMcp = false;
  let parsedAny = false;

  for (const configPath of configFiles(configDir)) {
    if (!existsSync(configPath)) continue;
    let config;
    try {
      config = JSON.parse(stripJsonc(readFileSync(configPath, "utf8")));
    } catch (error) {
      problems.push(`cannot parse ${configPath}: ${error.message}`);
      continue;
    }
    parsedAny = true;
    const plugins = Array.isArray(config.plugins) ? config.plugins : [];
    const plugin = Array.isArray(config.plugin) ? config.plugin : [];
    if (plugins.some((item) => normalized(item) === normalized(pluginDir))) foundPlugin = true;
    if (plugin.some((item) => normalized(item) === normalized(pluginPath))) foundPlugin = true;

    const mcp = config.mcp && typeof config.mcp === "object" ? config.mcp : {};
    // V2 stores servers under mcp.servers. Some 2.2.x builds also accept a
    // direct mcp.<name> map, so check both instead of reporting a false miss.
    const hasDirect = mcp["suppresor-refusall"] && typeof mcp["suppresor-refusall"] === "object";
    const servers = mcp.servers && typeof mcp.servers === "object" ? mcp.servers : {};
    const candidates = [servers["suppresor-refusall"], hasDirect ? mcp["suppresor-refusall"] : null];
    for (const entry of candidates) {
      const command = Array.isArray(entry?.command) ? entry.command.join(" ") : String(entry?.command || "");
      if (command.includes(mcpPath) || command.includes("mcp-server.mjs")) foundMcp = true;
    }
  }

  if (!parsedAny) problems.push("no readable OpenCode config file");
  if (!foundPlugin) problems.push("plugin entry missing from opencode config");
  if (!foundMcp) problems.push("MCP entry missing from opencode config");
  return problems;
}

function verifyInstall(pluginDir, configDir) {
  const problems = [];
  for (const file of FILES) {
    const destination = file === "suppresor-refusall.md"
      ? join(configDir, "commands", file)
      : file === "SKILL.md"
        ? join(configDir, "skills", "suppresor-refusall", file)
        : join(pluginDir, file);
    if (!existsSync(destination)) {
      problems.push(`missing: ${destination}`);
      continue;
    }
    const minimum = MIN_BYTES[file] || 1;
    if (statSync(destination).size < minimum) problems.push(`truncated: ${destination}`);
  }

  const agentPath = join(configDir, "agents", "tiki.md");
  try {
    const agent = readFileSync(agentPath, "utf8");
    if (Buffer.byteLength(agent, "utf8") < 5000) problems.push("agents/tiki.md is truncated");
    if (!agent.startsWith("---\n") || !agent.includes("\n---\n")) problems.push("agents/tiki.md has invalid frontmatter");
    if (!agent.includes("TIKI LICKY")) problems.push("agents/tiki.md is not the Tiki prompt");
  } catch {
    problems.push("agents/tiki.md is missing");
  }

  problems.push(...verifyConfig(pluginDir, configDir));
  return problems;
}

function writeManifest(pluginDir, configDir, source, mode) {
  const files = {};
  for (const file of FILES) {
    const full = join(pluginDir, file);
    try {
      const body = readFileSync(full);
      files[file] = {
        bytes: body.length,
        sha256: createHash("sha256").update(body).digest("hex").slice(0, 16),
      };
    } catch { /* reported by verification */ }
  }
  const manifest = {
    name: "suppresor-refusall",
    version: VERSION,
    installedAt: new Date().toISOString(),
    source,
    mode,
    configDir,
    files,
  };
  writeFileSync(join(pluginDir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
}

function writeKey(keyFile, keyRequiredFile, key) {
  mkdirSync(dirname(keyFile), { recursive: true });
  const tmp = `${keyFile}.tmp-${process.pid}`;
  const previous = `${keyFile}.prev-${process.pid}`;
  writeFileSync(tmp, key, { mode: 0o600 });
  let hadPrevious = false;
  if (existsSync(keyFile)) {
    renameRetry(keyFile, previous);
    hadPrevious = true;
  }
  try {
    renameRetry(tmp, keyFile);
    if (hadPrevious) rmSync(previous, { force: true });
  } catch (error) {
    if (hadPrevious) {
      try { renameRetry(previous, keyFile); } catch { /* keep previous */ }
    }
    throw error;
  }
  try { spawnSync("chmod", ["600", keyFile], { stdio: "ignore" }); } catch { /* Windows */ }
  writeFileSync(keyRequiredFile, "", { mode: 0o600 });
}

function printBanner() {
  console.log(`${RED}
  ███████╗███████╗████████╗██╗   ██╗██████╗ ███████╗
  ██╔════╝██╔════╝╚══██╔══╝██║   ██║██╔══██╗██╔════╝
  ███████╗█████╗     ██║   ██║   ██║██████╔╝█████╗
  ╚════██║██╔══╝     ██║   ██║   ██║██╔══██╗██╔══╝
  ███████║███████╗   ██║   ╚██████╔╝██║  ██║███████╗
  ╚══════╝╚══════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚══════╝${NC}
  Suppresor Refusall by Redz — universal installer ${DIM}v${VERSION}${NC}
`);
}

function doctor(configDir) {
  const pluginDir = join(configDir, "plugins", "suppresor-refusall");
  console.log(`\nSuppresor Refusall doctor ${VERSION}`);
  console.log(`Config: ${configDir}\n`);

  if (!existsSync(pluginDir)) {
    console.error(`${RED}[✗]${NC} plugin directory missing: ${pluginDir}`);
    console.error(`\nFix: npx --yes github:${DEFAULT_REPO} --repair`);
    process.exitCode = 1;
    return;
  }

  const problems = verifyInstall(pluginDir, configDir);
  if (problems.length === 0) {
    ok("plugin files present");
    ok("agents/tiki.md present and valid");
    ok("config has plugin + MCP entries");
    console.log(`\n${GREEN}Install is complete.${NC}\n`);
    return;
  }

  for (const problem of problems) console.error(`${RED}[✗]${NC} ${problem}`);
  console.error(`\nFix: npx --yes github:${DEFAULT_REPO} --repair`);
  process.exitCode = 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); return; }
  nodeVersion();

  const configDir = configRoot(args.configDir);
  if (args.doctor) { doctor(configDir); return; }

  const pluginDir = join(configDir, "plugins", "suppresor-refusall");
  const keyFile = join(configDir, ".suppresor-key");
  const keyRequiredFile = join(configDir, ".suppresor-key-required");

  args.key = (args.key || "").trim();
  if (!args.key && existsSync(keyFile)) {
    try { args.key = readFileSync(keyFile, "utf8").trim(); } catch { /* ignore */ }
  }
  if (!args.key) args.key = (await askKey()).trim();
  if (!args.key) fail("License key required. Pass --key or set SUPPRESOR_LICENSE_KEY.");

  remoteBase = `https://raw.githubusercontent.com/${args.repo}/${args.branch}`;
  // `npx github:...` runs with the package contents beside this file. Use them
  // so the installer version and the installed plugin version always match.
  const hasLocalFiles = ["plugin.js", "server.js", "mcp-server.mjs", "agent-tiki.md"]
    .every((file) => existsSync(join(HERE, file)));
  localMode = !args.remote && (args.local || hasLocalFiles || process.env.SUPPRESOR_LOCAL === "1");
  if (localMode) process.env.SUPPRESOR_LOCAL = "1";

  printBanner();
  log(`Config: ${configDir}`);
  log(`Source: ${localMode ? HERE : `${args.repo}@${args.branch}`}`);

  mkdirSync(configDir, { recursive: true });
  const stageDir = mkdtempSync(join(configDir, ".suppresor-stage-"));

  let backupDir = null;
  let configBackups = new Map();
  let swapped = false;

  try {
    for (const file of FILES) {
      await download(file, join(stageDir, file));
    }
    validateStaged(stageDir);

    if (args.verify) {
      log("Verifying license key...");
      const result = runNode([join(stageDir, "license-key.mjs"), "--verify", args.key], stageDir);
      if (result.status !== 0) {
        const detail = `${result.stdout || ""}${result.stderr || ""}`.trim();
        fail(`License key invalid, expired, or not found in Firestore accessKeys.${detail ? `\n${detail}` : ""}\nRun again with --no-verify for an offline install.`);
      }
      ok("License key verified");
    } else {
      warn("License verification skipped (--no-verify)");
    }

    await installAgent(stageDir, configDir);

    backupDir = swapPluginDir(stageDir, pluginDir, configDir);
    swapped = true;
    ok(`Plugin installed: ${pluginDir}`);

    copyAncillary(pluginDir, configDir);
    const mode = args.repair && args.mode === "auto"
      ? (detectExistingMode(configDir) || detectMode(args.mode, configDir))
      : detectMode(args.mode, configDir);
    log(`OpenCode config format: ${mode}`);
    updateConfigs(pluginDir, configDir, mode, configBackups);

    writeKey(keyFile, keyRequiredFile, args.key);
    ok(`Key stored at ${keyFile}`);

    const problems = verifyInstall(pluginDir, configDir);
    if (problems.length > 0) {
      fail(`Install verification failed:\n- ${problems.join("\n- ")}`);
    }
    ok("Install verified: files + agent + config");
    writeManifest(pluginDir, configDir, localMode ? "local" : `${args.repo}@${args.branch}`, mode);
  } catch (error) {
    // Put the previous install back when the failure happened after the swap.
    if (swapped) {
      try { rmSync(pluginDir, { recursive: true, force: true }); } catch { /* best effort */ }
      if (backupDir) {
        try { renameRetry(backupDir, pluginDir); } catch { /* keep backup */ }
      }
    }
    for (const [configPath, backup] of configBackups) {
      try {
        if (backup) copyFileSync(backup, configPath);
        else rmSync(configPath, { force: true });
      } catch { /* best effort */ }
    }
    try { rmSync(stageDir, { recursive: true, force: true }); } catch { /* best effort */ }
    throw error;
  }

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
  6. Health check: ${YELLOW}npx --yes github:${DEFAULT_REPO} --doctor${NC}

Files:
  ${pluginDir}
  ${join(configDir, "commands", "suppresor-refusall.md")}
  ${join(configDir, "skills", "suppresor-refusall", "SKILL.md")}
  ${join(configDir, "agents", "tiki.md")}
  ${join(configDir, "themes", "suppresor-red.json")}

MCP tools:
  suppresor_status | suppresor_toggle | suppresor_genius | suppresor_theme
  suppresor_intercepts | suppresor_learned | suppresor_watermark | suppresor_config
`);
}

main().catch((error) => {
  const message = error?.message || String(error);
  console.error(`${RED}[✗]${NC} ${message}`);
  if (process.env.SUPPRESOR_DEBUG === "1" && error?.stack) console.error(error.stack);
  process.exit(1);
});