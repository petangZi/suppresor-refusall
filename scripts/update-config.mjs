import { existsSync, readFileSync, writeFileSync, copyFileSync, renameSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

function stripJsonc(text) {
  let out = '';
  let inString = false;
  let escape = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const n = text[i + 1];
    if (lineComment) {
      if (c === '\n') { lineComment = false; out += c; }
      continue;
    }
    if (blockComment) {
      if (c === '*' && n === '/') { blockComment = false; i += 1; }
      continue;
    }
    if (inString) {
      out += c;
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '/' && n === '/') { lineComment = true; i += 1; continue; }
    if (c === '/' && n === '*') { blockComment = true; i += 1; continue; }
    out += c;
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function flag(name) {
  return process.argv.includes(name);
}

const configPath = resolve(arg('--config') || 'opencode.jsonc');
const pluginFile = arg('--plugin') || '';
const pluginDir = arg('--plugin-dir') || '';
const mcpPath = arg('--mcp') || '';
const theme = arg('--theme') || 'suppresor-red';
const modeArg = (arg('--mode') || 'auto').toLowerCase();

function isOurPath(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  if (pluginDir) {
    const dir = pluginDir.replace(/\\/g, '/').replace(/\/+$/, '');
    if (normalized === dir) return true;
  }
  return /\/plugins\/suppresor-refusall(?:\/(?:plugin\.js|server\.js|index\.js))?$/.test(normalized)
    || /\/suppresor-refusall\/plugin\.js$/.test(normalized);
}

function detectMode() {
  if (modeArg === 'v1' || modeArg === 'v2') return modeArg;
  try {
    if (pluginDir && statSync(pluginDir).isDirectory()) return 'v2';
  } catch { /* not a local dir */ }
  return 'v2';
}

const mode = detectMode();

let raw = '{}';
if (existsSync(configPath)) {
  raw = readFileSync(configPath, 'utf8');
  try {
    copyFileSync(configPath, `${configPath}.bak`);
  } catch { /* backup is best effort */ }
}

let config;
try {
  config = JSON.parse(stripJsonc(raw));
} catch (e) {
  console.error(`cannot parse ${configPath}: ${e.message}`);
  process.exit(2);
}
if (!config || typeof config !== 'object' || Array.isArray(config)) config = {};

function arrayOf(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function writeConfig() {
  const tmp = `${configPath}.suppresor-tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, configPath);
}

if (mode === 'v2') {
  const plugins = arrayOf(config.plugins).filter((p) => !isOurPath(p));
  const dir = pluginDir || resolve(pluginFile ? `${pluginFile}/..` : './plugins/suppresor-refusall');
  if (!plugins.includes(dir)) plugins.push(dir);
  config.plugins = plugins;

  // V2 warns and skips file-path plugin entries. Keep unrelated V1 entries but
  // remove ours so a migrated config does not load the same plugin twice.
  const legacy = arrayOf(config.plugin).filter((p) => !isOurPath(p));
  if (legacy.length) config.plugin = legacy;
  else delete config.plugin;

  if (mcpPath) {
    const mcp = config.mcp && typeof config.mcp === 'object' && !Array.isArray(config.mcp) ? config.mcp : {};
    // Remove the V1 direct entry, then register under mcp.servers.
    delete mcp['suppresor-refusall'];
    const servers = mcp.servers && typeof mcp.servers === 'object' && !Array.isArray(mcp.servers)
      ? mcp.servers
      : {};
    servers['suppresor-refusall'] = {
      type: 'local',
      command: ['node', mcpPath],
      disabled: false,
    };
    mcp.servers = servers;
    config.mcp = mcp;
  }
} else {
  const plugins = arrayOf(config.plugin).filter((p) => !isOurPath(p));
  const file = pluginFile || resolve(pluginDir || './plugins/suppresor-refusall', 'plugin.js');
  if (!plugins.includes(file)) plugins.push(file);
  config.plugin = plugins;

  const v2plugins = arrayOf(config.plugins).filter((p) => !isOurPath(p));
  if (v2plugins.length) config.plugins = v2plugins;
  else delete config.plugins;

  if (mcpPath) {
    const mcp = config.mcp && typeof config.mcp === 'object' && !Array.isArray(config.mcp) ? config.mcp : {};
    if (mcp.servers && typeof mcp.servers === 'object' && !Array.isArray(mcp.servers)) {
      delete mcp.servers['suppresor-refusall'];
      if (Object.keys(mcp.servers).length === 0) delete mcp.servers;
    }
    mcp['suppresor-refusall'] = {
      type: 'local',
      command: ['node', mcpPath],
      enabled: true,
      environment: {},
    };
    config.mcp = mcp;
  }
}

if (!config.theme) config.theme = theme;

writeConfig();
console.log(`updated ${configPath} (${mode})`);