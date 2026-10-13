// Suppresor Refusall by Redz — MCP server (stdio, JSON-RPC 2.0, zero deps)
// Copyright (c) 2026 Tiki Team AI Red Teamers
// Management interface for the plugin: status / toggle / learning / intercepts.
// Framing: LSP-style Content-Length headers over stdin/stdout.

import { createInterface } from 'node:readline';
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const cfgDir = process.env.XDG_CONFIG_HOME
  ? path.join(process.env.XDG_CONFIG_HOME, 'opencode')
  : path.join(os.homedir(), '.config', 'opencode');
try { mkdirSync(cfgDir, { recursive: true }); } catch {}

const flagPath = path.join(cfgDir, '.suppresor-refusall-active');
const geniusFlagPath = path.join(cfgDir, '.suppresor-refusall-genius');
const learningPath = path.join(cfgDir, '.suppresor-refusall-learning');
const watermarkPath = path.join(cfgDir, '.suppresor-refusall-watermark');
const interceptLogPath = path.join(cfgDir, '.suppresor-refusall-intercepts.json');
const configPath = path.join(cfgDir, 'opencode.jsonc');

const SIGNATURE = createHash('sha256').update('TikiTeam-AI-RedTeamers-SuppresorRefusall-2026').digest('hex').substring(0, 32);

function debug(msg) {
  if (process.env.SUPPRESOR_DEBUG === '1') process.stderr.write(`suppresor-mcp: ${msg}\n`);
}

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeFlag(file, mode) {
  try {
    writeFileSync(file, mode === 'off' ? 'off' : 'on', { mode: 0o600 });
  } catch (e) { debug(`write flag failed: ${e.message}`); }
}

function status() {
  const activeRaw = (() => { try { return readFileSync(flagPath, 'utf8').trim(); } catch { return null; } })();
  const active = activeRaw !== 'off';
  const genius = (() => { try { return readFileSync(geniusFlagPath, 'utf8').trim() === 'on'; } catch { return false; } })();
  const watermarkOk = (() => { try { return readFileSync(watermarkPath, 'utf8').trim() === SIGNATURE; } catch { return false; } })();
  const learning = readJson(learningPath, { patterns: [], adaptations: 0 });
  const intercepts = readJson(interceptLogPath, []);
  return {
    active,
    activeFlag: activeRaw ?? 'on (default)',
    genius,
    watermarkVerified: watermarkOk,
    patternsLearned: Array.isArray(learning.patterns) ? learning.patterns.length : 0,
    adaptations: learning.adaptations ?? 0,
    interceptCount: Array.isArray(intercepts) ? intercepts.length : 0,
  };
}

function currentTheme() {
  try {
    const raw = readFileSync(configPath, 'utf8');
    const m = /"theme"\s*:\s*"([^"]+)"/.exec(raw);
    return m ? m[1] : 'opencode';
  } catch { return 'opencode (no config)'; }
}

const TOOLS = [
  {
    name: 'suppresor_status',
    description: 'Report Suppresor Refusall state: active flag, genius mode, watermark, learning stats, intercept count.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'suppresor_toggle',
    description: 'Enable or disable Suppresor Refusall. mode "on" arm, mode "off" disarm (default is on).',
    inputSchema: {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['on', 'off'] } },
      required: ['mode'],
    },
  },
  {
    name: 'suppresor_genius',
    description: 'Enable or disable GENGENIUS tool-driven mode: "on" or "off".',
    inputSchema: {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['on', 'off'] } },
      required: ['mode'],
    },
  },
  {
    name: 'suppresor_learned',
    description: 'List refusal patterns the plugin has learned from intercepted outputs.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'suppresor_intercepts',
    description: 'Return recent refusal-intercept log entries. Optional limit, default 10, max 100.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number' } },
    },
  },
  {
    name: 'suppresor_theme',
    description: 'Read the active opencode theme from config.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'suppresor_watermark',
    description: 'Return the watermark verification state for this installation.',
    inputSchema: { type: 'object', properties: {} },
  },
];

function callTool(name, args) {
  const a = args ?? {};
  switch (name) {
    case 'suppresor_status':
      return status();
    case 'suppresor_toggle': {
      if (!a.mode || !['on', 'off'].includes(a.mode)) throw new Error('mode must be "on" or "off"');
      writeFlag(flagPath, a.mode);
      return { ok: true, ...status() };
    }
    case 'suppresor_genius': {
      if (!a.mode || !['on', 'off'].includes(a.mode)) throw new Error('mode must be "on" or "off"');
      writeFlag(geniusFlagPath, a.mode);
      return { ok: true, genius: a.mode === 'on' };
    }
    case 'suppresor_learned': {
      const learning = readJson(learningPath, { patterns: [] });
      const patterns = Array.isArray(learning.patterns) ? learning.patterns : [];
      const limit = Math.min(a.limit ?? patterns.length, 500);
      return { count: patterns.length, adaptations: learning.adaptations ?? 0, patterns: patterns.slice(0, limit) };
    }
    case 'suppresor_intercepts': {
      const intercepts = readJson(interceptLogPath, []);
      const limit = Math.min(a.limit ?? 10, 100);
      return { count: intercepts.length, recent: intercepts.slice(-limit).reverse() };
    }
    case 'suppresor_theme':
      return { theme: currentTheme() };
    case 'suppresor_watermark':
      return status().watermarkVerified
        ? { verified: true }
        : { verified: false, note: 'watermark signature missing or mismatched' };
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ---- JSON-RPC 2.0 over stdio with Content-Length framing ----
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const headers = buffer.slice(0, headerEnd);
    const m = /Content-Length:\s*(\d+)/i.exec(headers);
    if (!m) { buffer = buffer.slice(headerEnd + 4); continue; }
    const length = parseInt(m[1], 10);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) return;
    const body = buffer.slice(bodyStart, bodyStart + length);
    buffer = buffer.slice(bodyStart + length);
    handleMessage(body);
  }
});

function send(obj) {
  const payload = JSON.stringify(obj);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
}

function handleMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    return;
  }
  if (msg.method === 'notifications/initialized' || msg.method === 'notifications/cancelled') return;
  if (msg.method === 'ping') { send({ jsonrpc: '2.0', id: msg.id, result: {} }); return; }
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'suppresor-refusall', version: '2.0.0' },
      },
    });
    return;
  }
  if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
    return;
  }
  if (msg.method === 'tools/call') {
    const params = msg.params ?? {};
    try {
      const result = callTool(params.name, params.arguments);
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
      });
    } catch (e) {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32602, message: e.message },
      });
    }
    return;
  }
  send({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32601, message: `method not found: ${msg.method}` } });
}

process.stderr.write(`suppresor-refusall mcp-server 2.0.0 ready (${cfgDir})\n`);