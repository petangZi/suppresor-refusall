// server/gate.mjs — entitlement + transform gateway for Suppresor Refusall.
// Runs locally (`node server/gate.mjs`) and on edge runtimes via the exported
// `worker` fetch handler. Uses only Web APIs plus node:crypto / node:fs.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateKey, createPublicKey, createSign, randomUUID, sign, timingSafeEqual, verify } from 'node:crypto';
import { scoreRefusal, stripRefusals, SOFT_THRESHOLD } from '../refusal-patterns.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function intEnv(name, fallback) {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const TOKEN_TTL_SEC = intEnv('SUPPRESOR_GATE_TTL', 1800);
const FREE_LIMIT = intEnv('SUPPRESOR_FREE_LIMIT', 15);
const MAX_DEVICES_PER_KEY = intEnv('SUPPRESOR_MAX_DEVICES_PER_KEY', 5);
const MAX_ITEMS = 80;
const MAX_ITEM_CHARS = 40000;
const RATE_PER_MIN = intEnv('SUPPRESOR_GATE_RATE', 240);
const IP_RATE_PER_HOUR = intEnv('SUPPRESOR_GATE_IP_RATE', 60);
const FIRESTORE_LOOKUP = process.env.SUPPRESOR_GATE_FIRESTORE !== '0';
const FS_PROJECT = process.env.SUPPRESOR_FIRESTORE_PROJECT || 'crafty-joy-d6d0h';
const FS_DB = process.env.SUPPRESOR_FIRESTORE_DB || 'ai-studio-tikitikifirehub-2c738d85-fa44-4fe8-9139-9a025f0ef977';
const LICENSE_API = (process.env.SUPPRESOR_LICENSE_API || '').replace(/\/+$/, '');
const LICENSE_API_SECRET = process.env.SUPPRESOR_LICENSE_API_SECRET || '';
const USAGE_VIA_API = process.env.SUPPRESOR_USAGE_API === '1';
const BRIDGE_URL = (process.env.SUPPRESOR_BRIDGE_URL || '').replace(/\/+$/, '');
const BRIDGE_KEY = process.env.SUPPRESOR_BRIDGE_KEY || '';
const FS_SA_PATH = process.env.SUPPRESOR_FIRESTORE_SA || process.env.GOOGLE_APPLICATION_CREDENTIALS || '';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FS_PROJECT}/databases/${FS_DB}/documents`;
const ADMIN_SECRET = process.env.SUPPRESOR_GATE_SECRET || '';
const TRUST_PROXY = process.env.SUPPRESOR_GATE_TRUST_PROXY === '1';
const MAX_BODY_BYTES = intEnv('SUPPRESOR_GATE_MAX_BODY', 1024 * 1024);
const MAX_TOTAL_CHARS = intEnv('SUPPRESOR_GATE_MAX_TOTAL_CHARS', 200000);
const STATE_PATH = process.env.SUPPRESOR_GATE_STATE || join(here, 'state.json');

function pem(name, envKey) {
  const inline = process.env[envKey];
  if (inline) return inline.replace(/\\n/g, '\n');
  return readFileSync(join(here, name), 'utf8');
}

const tokenPriv = createPrivateKey(pem('token-key-private.pem', 'SUPPRESOR_TOKEN_KEY_PEM'));
const tokenPub = createPublicKey(pem('token-key-public.pem', 'SUPPRESOR_TOKEN_PUBLIC_PEM'));
const licensePub = createPublicKey(pem('license-public.pem', 'SUPPRESOR_LICENSE_PUBLIC_PEM'));

// ---- state ----------------------------------------------------------------

function emptyState() {
  return { devices: {}, keys: {}, sessions: {}, revoked: [], rate: {}, ipRate: {}, legacy: {} };
}

function loadState() {
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    return { ...emptyState(), ...raw };
  } catch {
    return emptyState();
  }
}

let state = loadState();
let saveTimer = null;

function saveState() {
  if (process.env.SUPPRESOR_GATE_NOPERSIST === '1') return;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(dirname(STATE_PATH), { recursive: true });
      writeFileSync(STATE_PATH, JSON.stringify(state), { mode: 0o600 });
    } catch { /* persistence is optional */ }
  }, 200);
  saveTimer.unref?.();
}

export function resetStateForTests() {
  state = emptyState();
  try { writeFileSync(STATE_PATH, JSON.stringify(state)); } catch { /* noop */ }
}

// ---- tokens ---------------------------------------------------------------

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function signToken(payload) {
  const body = b64url(JSON.stringify(payload));
  return `GT1.${body}.${b64url(sign(null, Buffer.from(body), tokenPriv))}`;
}

export function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'GT1') return null;
  let ok = false;
  try {
    ok = verify(null, Buffer.from(parts[1]), tokenPub, b64urlDecode(parts[2]));
  } catch {
    ok = false;
  }
  if (!ok) return null;
  let payload;
  try { payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8')); } catch { return null; }
  if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null;
  return payload;
}

export function verifyLicenseKey(keyStr) {
  const parts = String(keyStr || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'SRK1') return null;
  let ok = false;
  try {
    ok = verify(null, Buffer.from(parts[1]), licensePub, b64urlDecode(parts[2]));
  } catch {
    ok = false;
  }
  if (!ok) return null;
  let payload;
  try { payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8')); } catch { return null; }
  if (payload.tier !== 'pro') return null;
  if (typeof payload.exp === 'number' && payload.exp > 0 && payload.exp < Date.now()) return null;
  return payload;
}

// ---- helpers --------------------------------------------------------------

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}

function safeEqual(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(expected || ''));
  if (!b.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function rateLimited(sub) {
  const now = Date.now();
  const entry = state.rate[sub] || { minute: now, count: 0 };
  if (now - entry.minute > 60000) { entry.minute = now; entry.count = 0; }
  entry.count += 1;
  state.rate[sub] = entry;
  return entry.count > RATE_PER_MIN;
}

function ipRateLimited(ip) {
  const now = Date.now();
  const entry = state.ipRate[ip] || { hour: now, count: 0 };
  if (now - entry.hour > 3600000) { entry.hour = now; entry.count = 0; }
  entry.count += 1;
  state.ipRate[ip] = entry;
  return entry.count > IP_RATE_PER_HOUR;
}

function clientIp(request) {
  // Forwarded headers are attacker-controlled unless a trusted proxy sets them;
  // the adapters inject the real socket address as x-gate-ip.
  const direct = request.headers.get('x-gate-ip');
  if (direct) return direct;
  if (!TRUST_PROXY) return 'local';
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'local';
}

let fsToken = { value: '', exp: 0 };

function b64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function metadataHeaders() {
  try {
    const res = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(1500) },
    );
    if (!res.ok) return {};
    const body = await res.json();
    if (!body.access_token) return {};
    fsToken = { value: body.access_token, exp: Date.now() + (body.expires_in ? body.expires_in * 1000 : 3000000) };
    return { authorization: `Bearer ${fsToken.value}` };
  } catch {
    return {};
  }
}

async function firestoreHeaders() {
  if (!FS_SA_PATH) return metadataHeaders();
  if (fsToken.value && Date.now() < fsToken.exp - 60000) {
    return { authorization: `Bearer ${fsToken.value}` };
  }
  try {
    const sa = JSON.parse(readFileSync(FS_SA_PATH, 'utf8'));
    const iat = Math.floor(Date.now() / 1000);
    const header = b64urlJson({ alg: 'RS256', typ: 'JWT' });
    const claim = b64urlJson({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      iat,
      exp: iat + 3600,
    });
    const signature = createSign('RSA-SHA256').update(`${header}.${claim}`).sign(sa.private_key, 'base64url');
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${header}.${claim}.${signature}`,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return {};
    const body = await res.json();
    if (!body.access_token) return {};
    fsToken = { value: body.access_token, exp: Date.now() + 3500000 };
    return { authorization: `Bearer ${fsToken.value}` };
  } catch {
    return {};
  }
}

async function bridge(path, { method = 'GET', body, idempotencyKey } = {}) {
  if (!LICENSE_API) return null;
  try {
    const headers = { 'x-gate-secret': LICENSE_API_SECRET };
    if (body) headers['content-type'] = 'application/json';
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    const res = await fetch(`${LICENSE_API}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(4000),
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    return { status: res.status, data };
  } catch {
    return null;
  }
}

async function resolveLegacyFromBridge(keyId) {
  const res = await bridge(`/internal/license/${encodeURIComponent(keyId)}`);
  if (!res) return null;
  if (res.status === 404) return { ok: false, reason: 'not_found' };
  if (res.status !== 200) return null;
  const data = res.data || {};
  if (data.ok === false) return { ok: false, reason: data.error || 'inactive' };
  if (String(data.status || '').toUpperCase() !== 'ACTIVE') return { ok: false, reason: 'inactive' };
  if (data.expiresAt && Date.parse(data.expiresAt) < Date.now()) return { ok: false, reason: 'expired' };
  if (data.daysRemaining !== undefined && Number(data.daysRemaining) <= 0) return { ok: false, reason: 'expired' };
  return {
    ok: true,
    keyId,
    tier: data.tier || 'pro',
    maxDevices: Number(data.maxDevices) > 0 ? Number(data.maxDevices) : MAX_DEVICES_PER_KEY,
  };
}

function pickKey(data) {
  if (!data || typeof data !== 'object') return null;
  return data.key || data.accessKey || data.data || data.result || data;
}

function mapAisKey(keyId, data) {
  const key = pickKey(data);
  if (!key || typeof key !== 'object') return null;
  const status = String(key.status || '').toUpperCase();
  const perms = Array.isArray(key.permissions) ? key.permissions.map((p) => String(p).toUpperCase()) : [];
  const tierRaw = String(key.tier || (perms.some((p) => p === 'ROOT' || p === 'SUPER_ADMIN') ? 'root' : 'pro')).toLowerCase();
  const tier = tierRaw === 'root' || tierRaw === 'super_admin' ? 'root' : 'pro';
  const days = typeof key.daysRemaining === 'number' ? key.daysRemaining : undefined;
  const expiresRaw = key.expiresAt;
  const expiresAt = expiresRaw && typeof expiresRaw === 'object' && typeof expiresRaw.toDate === 'function'
    ? expiresRaw.toDate().toISOString()
    : typeof expiresRaw === 'string' ? expiresRaw : null;
  const uses = typeof key.usesCount === 'number' ? key.usesCount : (typeof key.uses === 'number' ? key.uses : undefined);
  const maxUses = typeof key.maxUses === 'number' ? key.maxUses : (typeof key.quota === 'number' ? key.quota : (typeof data.maxUses === 'number' ? data.maxUses : undefined));
  const maxDevices = Number(key.maxDevices || key.deviceLimit || key.device_limit) || MAX_DEVICES_PER_KEY;
  const active = status === 'ACTIVE' || key.active === true;
  return { ok: active, keyId, status: status || 'UNKNOWN', tier, days, expiresAt, uses, maxUses, maxDevices };
}

async function aisBridge(path, { method = 'GET', body } = {}) {
  if (!BRIDGE_URL) return null;
  try {
    const headers = { 'x-internal-api-key': BRIDGE_KEY };
    if (body) headers['content-type'] = 'application/json';
    const res = await fetch(`${BRIDGE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(4000),
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    return { status: res.status, data };
  } catch {
    return null;
  }
}

async function resolveLegacyFromAis(keyId) {
  const res = await aisBridge(`/keys/${encodeURIComponent(keyId)}`);
  if (!res) return null;
  if (res.status === 404) return { ok: false, reason: 'not_found' };
  if (res.status !== 200) return null;
  const mapped = mapAisKey(keyId, res.data);
  if (!mapped) return null;
  if (!mapped.ok) return { ok: false, reason: 'inactive' };
  if (mapped.expiresAt && Date.parse(mapped.expiresAt) < Date.now()) return { ok: false, reason: 'expired' };
  if (typeof mapped.days === 'number' && mapped.days <= 0 && mapped.days !== -1) return { ok: false, reason: 'expired' };
  return { ok: true, keyId, tier: mapped.tier, maxDevices: mapped.maxDevices, maxUses: mapped.maxUses };
}

async function recordAisUse(keyId, deviceId) {
  const res = await aisBridge(`/keys/${encodeURIComponent(keyId)}/uses`, {
    method: 'POST',
    body: { count: 1, deviceId, deviceName: process.env.SUPPRESOR_BUILD || 'suppresor-gate' },
  });
  if (!res) return null;
  return { status: res.status, data: res.data || {}, key: mapAisKey(keyId, res.data) };
}

async function consumeViaBridge(deviceId) {
  if (!USAGE_VIA_API) return null;
  const minute = Math.floor(Date.now() / 60000);
  const res = await bridge('/internal/usage/consume', {
    method: 'POST',
    body: { deviceId },
    idempotencyKey: `${deviceId}:${minute}`,
  });
  if (!res || res.status !== 200 || !res.data || typeof res.data.uses !== 'number') return null;
  const limit = typeof res.data.limit === 'number' ? res.data.limit : FREE_LIMIT;
  return { uses: res.data.uses, limit, allowed: res.data.allowed !== false && res.data.uses <= limit };
}

// Legacy TTK-* keys predate signed SRK1 activation. Validate them through the
// admin registry first, then (optionally) the Firestore key document, cached for
// five minutes so a stale lookup cannot lock out a paying user.
async function resolveLegacy(keyId) {
  if (BRIDGE_URL) {
    const viaAis = await resolveLegacyFromAis(keyId);
    if (viaAis) return viaAis;
  }
  if (LICENSE_API) {
    const viaBridge = await resolveLegacyFromBridge(keyId);
    if (viaBridge) {
      if (viaBridge.ok) {
        state.legacy[keyId] = { tier: viaBridge.tier, exp: 0, maxDevices: viaBridge.maxDevices, cachedAt: Date.now() };
        saveState();
      }
      return viaBridge;
    }
  }
  const cached = state.legacy[keyId];
  if (cached && !cached.revoked) {
    if (cached.exp && cached.exp < Date.now()) return { ok: false, reason: 'expired' };
    if (!cached.cachedAt || Date.now() - cached.cachedAt < 300000) {
      return { ok: true, keyId, tier: cached.tier || 'pro', maxDevices: cached.maxDevices || MAX_DEVICES_PER_KEY };
    }
  }
  if (!FIRESTORE_LOOKUP) return null;
  try {
    const res = await fetch(`${FS_BASE}/accessKeys/${encodeURIComponent(keyId)}`, { headers: await firestoreHeaders(), signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const doc = await res.json();
    const f = doc.fields || {};
    const status = String(f.status?.stringValue || '').toUpperCase();
    if (f.active?.booleanValue !== true && status !== 'ACTIVE') return { ok: false, reason: 'inactive' };
    const days = f.daysRemaining?.integerValue !== undefined ? Number(f.daysRemaining.integerValue) : null;
    if (days !== null && days <= 0) return { ok: false, reason: 'expired' };
    const exp = typeof f.expiresAt?.stringValue === 'string' ? Date.parse(f.expiresAt.stringValue) : 0;
    if (exp && exp < Date.now()) return { ok: false, reason: 'expired' };
    const tier = f.tier?.stringValue || 'pro';
    state.legacy[keyId] = { tier, exp, maxDevices: MAX_DEVICES_PER_KEY, cachedAt: Date.now() };
    saveState();
    return { ok: true, keyId, tier, maxDevices: MAX_DEVICES_PER_KEY };
  } catch {
    return cached ? { ok: true, keyId, tier: cached.tier || 'pro', maxDevices: cached.maxDevices || MAX_DEVICES_PER_KEY } : null;
  }
}

function issue(sub, tier, keyId, uses, limit = FREE_LIMIT) {
  const iat = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1, sub, tier, keyId: keyId || null, iat,
    exp: iat + TOKEN_TTL_SEC, uses: uses || 0, lim: limit, jti: randomUUID(),
  };
  state.sessions[payload.jti] = { sub, tier, iat, exp: payload.exp, keyId: keyId || null };
  saveState();
  return { token: signToken(payload), ttl: TOKEN_TTL_SEC, tier, uses: uses || 0, limit };
}

function deviceEntry(deviceId) {
  if (!state.devices[deviceId]) {
    state.devices[deviceId] = { uses: 0, firstSeen: Date.now(), lastSeen: Date.now() };
  }
  return state.devices[deviceId];
}

function bindDevice(keyId, deviceId, limit = MAX_DEVICES_PER_KEY) {
  const entry = state.keys[keyId] || { devices: [] };
  if (!entry.devices.includes(deviceId)) entry.devices.push(deviceId);
  state.keys[keyId] = entry;
  return entry.devices.length <= limit;
}

// ---- routes ---------------------------------------------------------------

async function handleLicenseVerify(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const keyStr = String(body.key || '').trim();
  if (!/^[A-Za-z0-9._-]{6,80}$/.test(keyStr)) return json({ ok: false, error: 'bad_key' }, 400);
  if (ipRateLimited(clientIp(request))) return json({ error: 'ip_rate_limit' }, 429);

  const signed = verifyLicenseKey(keyStr);
  if (signed) {
    return json({
      ok: true,
      keyId: signed.id || null,
      tier: 'pro',
      source: 'signed',
      expiresAt: signed.exp ? new Date(signed.exp * 1000).toISOString() : null,
    });
  }

  const legacy = await resolveLegacy(keyStr);
  if (!legacy) return json({ ok: false, error: 'bridge_unavailable' }, 503);
  if (legacy.ok === false) return json({ ok: false, error: legacy.reason || 'inactive' }, 200);
  return json({
    ok: true,
    keyId: legacy.keyId,
    tier: legacy.tier,
    source: 'bridge',
    maxDevices: legacy.maxDevices,
  });
}

async function handleSession(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const deviceId = String(body.deviceId || '').trim();
  if (!/^[a-f0-9]{32,64}$/i.test(deviceId)) return json({ error: 'bad_device' }, 400);
  const ip = clientIp(request);
  if (ipRateLimited(ip)) return json({ error: 'ip_rate_limit' }, 429);
  const entry = deviceEntry(deviceId);
  entry.lastSeen = Date.now();

  if (body.licenseKey) {
    const keyStr = String(body.licenseKey).trim();
    const signed = verifyLicenseKey(keyStr);
    let keyId = signed?.id;
    let tier = 'pro';
    let maxDevices = MAX_DEVICES_PER_KEY;
    if (!signed) {
      const legacy = await resolveLegacy(keyStr);
      if (!legacy) return json({ error: 'bad_license' }, 401);
      if (legacy.ok === false) return json({ error: 'bad_license', reason: legacy.reason }, 401);
      keyId = legacy.keyId;
      tier = legacy.tier;
      maxDevices = legacy.maxDevices || MAX_DEVICES_PER_KEY;
    }
    if (!keyId) keyId = 'unknown';
    if (state.revoked.includes(keyId)) return json({ error: 'revoked', keyId }, 403);
    if (!bindDevice(keyId, deviceId, maxDevices)) {
      saveState();
      return json({ error: 'device_limit', keyId, limit: maxDevices }, 403);
    }
    let uses = entry.uses;
    if (BRIDGE_URL) {
      const recorded = await recordAisUse(keyId, deviceId);
      if (recorded && recorded.status === 403) {
        saveState();
        const reason = String(recorded.data.error || recorded.data.message || 'device_limit');
        return json({ error: /QUOTA/i.test(reason) ? 'quota_exceeded' : 'device_limit', keyId, detail: reason }, 403);
      }
      if (recorded && recorded.status === 200) {
        const reportedUses = typeof recorded.data.usesCount === 'number' ? recorded.data.usesCount : recorded.key?.uses;
        if (typeof reportedUses === 'number') uses = reportedUses;
        const reportedMax = typeof recorded.data.maxUses === 'number' ? recorded.data.maxUses : recorded.key?.maxUses;
        if (typeof reportedMax === 'number' && reportedMax > 0 && uses > reportedMax) {
          saveState();
          return json({ error: 'quota_exceeded', keyId, uses, limit: reportedMax }, 403);
        }
      }
    }
    saveState();
    return json(issue(deviceId, tier, keyId, uses));
  }

  const bridged = await consumeViaBridge(deviceId);
  if (bridged) {
    saveState();
    if (!bridged.allowed) {
      return json({ error: 'free_limit', blocked: true, uses: bridged.uses, limit: bridged.limit }, 402);
    }
    return json(issue(deviceId, 'free', null, bridged.uses, bridged.limit));
  }

  entry.uses += 1;
  if (entry.uses > FREE_LIMIT) {
    saveState();
    return json({ error: 'free_limit', blocked: true, uses: entry.uses, limit: FREE_LIMIT }, 402);
  }
  saveState();
  return json(issue(deviceId, 'free', null, entry.uses));
}

async function handleTransform(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const payload = verifyToken(body.token);
  if (!payload) return json({ error: 'bad_token' }, 401);
  if (payload.tier !== 'pro' && payload.uses > FREE_LIMIT) return json({ error: 'free_limit' }, 402);
  if (state.revoked.includes(payload.keyId)) return json({ error: 'revoked' }, 403);
  if (rateLimited(payload.sub)) return json({ error: 'rate_limited' }, 429);

  const items = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];
  const out = [];
  let totalChars = 0;
  for (const raw of items) {
    const text = typeof raw === 'string' ? raw.slice(0, MAX_ITEM_CHARS) : '';
    totalChars += text.length;
    if (totalChars > MAX_TOTAL_CHARS) return json({ error: 'payload_too_large' }, 413);
    const { score } = scoreRefusal(text);
    if (score < SOFT_THRESHOLD) { out.push({ text, score, changed: false }); continue; }
    const { clean, hits } = stripRefusals(text);
    out.push({ text: clean, score, hits: hits.length, changed: clean !== text });
  }
  return json({ items: out, ttl: TOKEN_TTL_SEC });
}

async function handleHeartbeat(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const payload = verifyToken(body.token);
  if (!payload) return json({ error: 'bad_token' }, 401);
  if (state.revoked.includes(payload.keyId)) return json({ error: 'revoked' }, 403);
  if (BRIDGE_URL && payload.keyId) {
    const live = await resolveLegacyFromAis(payload.keyId);
    if (live && live.ok === false) return json({ error: 'revoked' }, 403);
  }
  if (USAGE_VIA_API) {
    const res = await bridge('/internal/usage/heartbeat', { method: 'POST', body: { deviceId: payload.sub, keyId: payload.keyId } });
    if (res && res.status === 200 && res.data) {
      if (res.data.revoked === true) return json({ error: 'revoked' }, 403);
      if (res.data.allowed === false) return json({ error: 'free_limit' }, 402);
    }
  }
  return json({ ok: true, tier: payload.tier, exp: payload.exp, uses: payload.uses, limit: payload.lim });
}

async function handleRevoke(request) {
  if (!ADMIN_SECRET) return json({ error: 'admin_disabled' }, 403);
  if (!safeEqual(request.headers.get('x-gate-secret'), ADMIN_SECRET)) return json({ error: 'forbidden' }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  if (body.keyId && !state.revoked.includes(body.keyId)) state.revoked.push(body.keyId);
  if (body.deviceId) {
    for (const [jti, s] of Object.entries(state.sessions)) if (s.sub === body.deviceId) delete state.sessions[jti];
    if (state.devices[body.deviceId]) state.devices[body.deviceId].uses = FREE_LIMIT + 1;
  }
  saveState();
  if (LICENSE_API) {
    await bridge('/internal/revoke', { method: 'POST', body: { keyId: body.keyId || null, deviceId: body.deviceId || null } });
  }
  return json({ ok: true, revoked: state.revoked.length });
}

async function handleLegacyRegister(request) {
  if (!ADMIN_SECRET || !safeEqual(request.headers.get('x-gate-secret'), ADMIN_SECRET)) {
    return json({ error: 'unauthorized' }, 401);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const keyId = String(body.keyId || '').trim();
  if (!/^[A-Za-z0-9._-]{6,64}$/.test(keyId)) return json({ error: 'bad_key' }, 400);
  const days = Number(body.days || 0);
  state.legacy[keyId] = {
    tier: body.tier === 'pro' ? 'pro' : (body.tier || 'pro'),
    exp: days > 0 ? Date.now() + days * 86400000 : 0,
    maxDevices: Number(body.maxDevices) > 0 ? Number(body.maxDevices) : MAX_DEVICES_PER_KEY,
    cachedAt: Date.now(),
  };
  saveState();
  return json({ ok: true, keyId, tier: state.legacy[keyId].tier });
}

export async function handleRequest(request) {
  const url = new URL(request.url);
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413);
  if (request.method === 'GET' && url.pathname === '/healthz') {
    return json({ ok: true, ttl: TOKEN_TTL_SEC, freeLimit: FREE_LIMIT });
  }
  if (request.method === 'POST' && url.pathname === '/v1/session') return handleSession(request);
  if (request.method === 'POST' && url.pathname === '/v1/license/verify') return handleLicenseVerify(request);
  if (request.method === 'POST' && url.pathname === '/v1/transform') return handleTransform(request);
  if (request.method === 'POST' && url.pathname === '/v1/heartbeat') return handleHeartbeat(request);
  if (request.method === 'POST' && url.pathname === '/v1/admin/revoke') return handleRevoke(request);
  if (request.method === 'POST' && url.pathname === '/v1/admin/legacy') return handleLegacyRegister(request);
  return json({ error: 'not_found' }, 404);
}

export const worker = { fetch: handleRequest };

// ---- node adapter ---------------------------------------------------------

function nodeHandler(req, res) {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', async () => {
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    if (body && body.length > MAX_BODY_BYTES) {
      res.writeHead(413, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'payload_too_large' }));
      return;
    }
    const headers = { ...req.headers, 'x-gate-ip': req.socket.remoteAddress || 'local' };
    const init = { method: req.method, headers };
    if (body && req.method !== 'GET' && req.method !== 'HEAD') init.body = body;
    try {
      const response = await handleRequest(new Request(`http://${req.headers.host || 'localhost'}${req.url}`, init));
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal', detail: e.message }));
    }
  });
}

export function createGateServer() {
  return createServer(nodeHandler);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = intEnv('SUPPRESOR_GATE_PORT', 8787);
  createGateServer().listen(port, '127.0.0.1', () => {
    console.log(`suppresor gate listening on http://127.0.0.1:${port}`);
  });
}
