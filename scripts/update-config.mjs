import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
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

const configPath = resolve(arg('--config') || 'opencode.jsonc');
const pluginPath = arg('--plugin') || './plugins/suppresor-refusall/plugin.js';
const mcpPath = arg('--mcp') || '';
const theme = arg('--theme') || 'suppresor-red';

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

const plugins = Array.isArray(config.plugin) ? config.plugin : [];
if (!plugins.includes(pluginPath)) plugins.push(pluginPath);
config.plugin = plugins;

if (!config.theme) config.theme = theme;

if (mcpPath) {
  config.mcp = config.mcp && typeof config.mcp === 'object' ? config.mcp : {};
  config.mcp['suppresor-refusall'] = {
    type: 'local',
    command: ['node', mcpPath],
    enabled: true,
    environment: {},
  };
}

writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
console.log(`updated ${configPath}`);
