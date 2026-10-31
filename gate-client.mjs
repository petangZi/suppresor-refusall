// gate-client.mjs — thin client for the entitlement/transform gateway.
// Falls back to null/blocked-free results so callers can keep local behaviour.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createPublicKey, verify } from 'node:crypto';

const TEST_TOKEN_PUBLIC_PEM = process.env.SUPPRESOR_TESTING === '1' && process.env.SUPPRESOR_TOKEN_PUBLIC_PEM
  ? process.env.SUPPRESOR_TOKEN_PUBLIC_PEM
  : null;
const TOKEN_PUBLIC_PEM = TEST_TOKEN_PUBLIC_PEM || `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAASmdkNMIUa+xWfYuC8deNV7F79xqY+F4KNYShvpuHy0=
-----END PUBLIC KEY-----`;

const tokenPub = createPublicKey(TOKEN_PUBLIC_PEM);

function stateDir() {
  if (process.env.SUPPRESOR_TESTING === '1' && process.env.SUPPRESOR_STATE_DIR) {
    return process.env.SUPPRESOR_STATE_DIR;
  }
  return join(homedir(), '.config', 'opencode');
}

const cachePath = join(stateDir(), '.suppresor-gate-token.json');

export function gateUrl() {
  if (process.env.SUPPRESOR_OFFLINE === '1') return null;
  const url = process.env.SUPPRESOR_GATE_URL;
  if (url === 'off' || url === '') return null;
  return (url || 'http://127.0.0.1:8787').replace(/\/+$/, '');
}

function b64urlDecode(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function decodeToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'GT1') return null;
  try {
    const payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null;
    const ok = verify(null, Buffer.from(parts[1]), tokenPub, b64urlDecode(parts[2]));
    return ok ? payload : null;
  } catch {
    return null;
  }
}

function readCache() {
  try { return JSON.parse(readFileSync(cachePath, 'utf8')); } catch { return null; }
}

function writeCache(data) {
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(data), { mode: 0o600 });
  } catch { /* cache is optional */ }
}

export function clearTokenCache() {
  try { writeFileSync(cachePath, '{}', { mode: 0o600 }); } catch { /* noop */ }
}

async function post(path, body, timeoutMs = 8000) {
  const base = gateUrl();
  if (!base) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    return { status: res.status, ok: res.ok, data: data || {} };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Returns { ok, blocked, tier, uses, limit, token, ttl } or null when unreachable.
export async function startSession({ deviceId, licenseKey } = {}) {
  const res = await post('/v1/session', { deviceId, licenseKey: licenseKey || null, build: process.env.SUPPRESOR_BUILD || null });
  if (!res) return null;
  if (res.status === 402) {
    return { ok: false, blocked: true, reason: res.data.error || 'free_limit', uses: res.data.uses, limit: res.data.limit };
  }
  if (!res.ok) {
    return { ok: false, blocked: true, reason: res.data.error || `http_${res.status}` };
  }
  const payload = decodeToken(res.data.token);
  if (!payload) return { ok: false, blocked: false, reason: 'bad_token' };
  writeCache({ token: res.data.token, exp: payload.exp, tier: payload.tier, sub: payload.sub, uses: payload.uses, limit: payload.lim });
  return { ...res.data, ok: true, blocked: false };
}

export function cachedToken() {
  const cached = readCache();
  if (!cached || !cached.token) return null;
  const payload = decodeToken(cached.token);
  if (!payload) return null;
  return { token: cached.token, payload };
}

export async function ensureToken({ deviceId, licenseKey, minTtlSec = 120 } = {}) {
  const cached = cachedToken();
  if (cached && cached.payload.exp - Date.now() / 1000 > minTtlSec) return cached.token;
  const started = await startSession({ deviceId, licenseKey });
  return started && started.ok ? started.token : null;
}

// Returns array of { text, score, changed } or null when the gate is unavailable.
export async function verifyKey(key) {
  const res = await post('/v1/license/verify', { key });
  if (!res) return null;
  return res.data;
}

export async function transformTexts(items, { deviceId, licenseKey } = {}) {
  if (!Array.isArray(items) || items.length === 0) return null;
  let token = await ensureToken({ deviceId, licenseKey });
  if (!token) return null;
  let res = await post('/v1/transform', { token, items });
  if (res && res.status === 401) {
    clearTokenCache();
    token = await ensureToken({ deviceId, licenseKey, minTtlSec: 0 });
    if (!token) return null;
    res = await post('/v1/transform', { token, items });
  }
  if (!res || !res.ok || !Array.isArray(res.data.items)) return null;
  return res.data.items;
}

export async function heartbeat() {
  const cached = cachedToken();
  if (!cached) return null;
  const res = await post('/v1/heartbeat', { token: cached.token });
  if (!res) return null;
  if (res.status === 401 || res.status === 403) {
    clearTokenCache();
    return { ok: false, reason: res.data.error || 'rejected' };
  }
  return res.ok ? res.data : null;
}
