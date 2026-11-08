// license-key.mjs — read-only license gate.
// TTK-* keys are read from Firestore accessKeys/{key}; SRK1 keys are verified
// offline. No device ids, usage counters, Firestore writes, or local snapshots.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verify as cryptoVerify } from 'node:crypto';

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAGkx88JNJtTHKv/MR5jJAq6yxU8mEqa3SEUxUy+7/3m4=
-----END PUBLIC KEY-----`;

function stateDir() {
  if (process.env.SUPPRESOR_TESTING === '1' && process.env.SUPPRESOR_STATE_DIR) {
    return process.env.SUPPRESOR_STATE_DIR;
  }
  if (process.env.OPENCODE_CONFIG_DIR) return process.env.OPENCODE_CONFIG_DIR;
  return join(homedir(), '.config', 'opencode');
}

export function keyFilePath() {
  return join(stateDir(), '.suppresor-key');
}

export function keyRequiredFilePath() {
  return join(stateDir(), '.suppresor-key-required');
}

export function legacyStateFilePath() {
  return join(stateDir(), '.suppresor-license');
}

function b64urlDecode(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function verifyLicenseKey(keyStr) {
  const parts = String(keyStr || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'SRK1') {
    return { ok: false, reason: 'format key tidak dikenal' };
  }
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8'));
  } catch {
    return { ok: false, reason: 'payload key rusak' };
  }
  let sigOk = false;
  try {
    sigOk = cryptoVerify(null, Buffer.from(parts[1]), PUBLIC_KEY_PEM, b64urlDecode(parts[2]));
  } catch {
    sigOk = false;
  }
  if (!sigOk) return { ok: false, reason: 'signature key tidak valid' };
  if (typeof payload.exp === 'number' && payload.exp > 0 && payload.exp < Date.now()) {
    return { ok: false, reason: 'key expired' };
  }
  if (payload.tier !== 'pro') return { ok: false, reason: `tier tidak dikenal: ${payload.tier}` };
  return { ok: true, payload };
}

export function keyGateRequired() {
  if (process.env.SUPPRESOR_KEY_REQUIRED === '0') return false;
  if (process.env.SUPPRESOR_KEY_REQUIRED === '1') return true;
  if (typeof process.env.SUPPRESOR_LICENSE_KEY === 'string' && process.env.SUPPRESOR_LICENSE_KEY.trim()) return true;
  return existsSync(keyRequiredFilePath()) || existsSync(keyFilePath());
}

function readLegacyActivationKey() {
  try {
    const raw = JSON.parse(readFileSync(legacyStateFilePath(), 'utf8'));
    if (raw && raw.activation && typeof raw.activation.key === 'string') return raw.activation.key;
  } catch {
    /* no legacy activation */
  }
  return null;
}

export function readLicenseKey() {
  const env = process.env.SUPPRESOR_LICENSE_KEY;
  if (typeof env === 'string' && env.trim()) return env.trim();
  try {
    const raw = readFileSync(keyFilePath(), 'utf8').trim();
    if (raw) return raw;
  } catch {
    /* fall through */
  }
  return keyGateRequired() ? readLegacyActivationKey() : null;
}

export function isTtkKey(keyStr) {
  return /^(?:TTK|TIKI|TKI)-[A-Za-z0-9-]{4,80}$/i.test(String(keyStr || '').trim());
}

function stateFromResult(key, result) {
  const checkedAt = Date.now();
  if (!result.ok) {
    return {
      allowed: false,
      blocked: true,
      origin: 'readonly',
      tier: 'none',
      uses: 0,
      usesLeft: 0,
      freeLimit: 0,
      keyRef: key || null,
      activation: null,
      checkedAt,
      message: result.reason,
    };
  }
  const payload = result.payload || {};
  return {
    allowed: true,
    blocked: false,
    origin: 'readonly',
    tier: payload.tier || 'pro',
    uses: 0,
    usesLeft: 9999,
    freeLimit: 0,
    keyRef: payload.id || key || null,
    activation: {
      type: result.source === 'firestore' ? 'firestore' : 'signed',
      key,
      id: payload.id || key || null,
      tier: payload.tier || 'pro',
      exp: payload.exp || null,
    },
    checkedAt,
    message: result.source === 'firestore'
      ? `key valid — tier ${payload.tier || 'pro'} (Firestore read-only)`
      : `key valid — tier ${payload.tier || 'pro'} (read-only)`,
  };
}

const PLAN_DAYS = { daily: 1, weekly: 7, monthly: 30, yearly: 365 };

export async function verifyFirestoreKey(keyStr) {
  const key = String(keyStr || '').trim();
  if (!isTtkKey(key)) return { ok: false, reason: 'format key Firestore tidak valid' };
  process.env.SUPPRESOR_NO_TOKEN_CACHE = '1';
  let doc;
  try {
    const client = await import('./firestore-client.js');
    try {
      doc = await client.getDocumentPublic('accessKeys', key);
    } catch {
      try {
        doc = await client.getDocument('accessKeys', key);
      } catch (e) {
        if (/not found|NOT_FOUND|404/i.test(String(e.message))) {
          return { ok: false, reason: `key tidak ditemukan di Firestore accessKeys: ${key}` };
        }
        return { ok: false, reason: `Firestore tidak bisa dibaca: ${e.message}` };
      }
    }
  } catch (e) {
    return { ok: false, reason: `Firestore client gagal: ${e.message}` };
  }
  if (!doc) return { ok: false, reason: `key tidak ditemukan di Firestore accessKeys: ${key}` };

  return evaluateFirestoreKey(key, doc);
}

export function evaluateFirestoreKey(key, doc) {
  if (!doc) return { ok: false, reason: `key tidak ditemukan di Firestore accessKeys: ${key}` };
  if (doc.used === true) return { ok: false, reason: 'key sudah dipakai' };
  const status = String(doc.status || (doc.active === true ? 'ACTIVE' : '')).toUpperCase();
  const hasLegacyStatus = doc.status !== undefined || doc.active !== undefined;
  const active = hasLegacyStatus ? (doc.active === true || status === 'ACTIVE') : true;
  const unlimited = doc.durationDays === -1 || doc.daysRemaining === 99999 || doc.maxUses === -1;
  const createdAt = Date.parse(doc.createdAt || '');
  const plan = String(doc.plan || '').toLowerCase();
  const planDays = PLAN_DAYS[plan] || 0;
  const planExpiry = Number.isFinite(createdAt) && planDays > 0 ? createdAt + planDays * 86400000 : NaN;
  const expiresAt = typeof doc.expiresAt === 'string' ? Date.parse(doc.expiresAt) : planExpiry;
  const expired = (Number.isFinite(expiresAt) && expiresAt < Date.now())
    || (!unlimited && typeof doc.daysRemaining === 'number' && doc.daysRemaining <= 0);
  const maxUses = typeof doc.maxUses === 'number' ? doc.maxUses : -1;
  const uses = typeof doc.uses === 'number' ? doc.uses : (typeof doc.usesCount === 'number' ? doc.usesCount : 0);
  if (!active) return { ok: false, reason: `key tidak aktif (${status || 'unknown'})` };
  if (expired) return { ok: false, reason: plan ? `key expired (${plan})` : 'key expired' };
  if (!unlimited && maxUses > 0 && uses >= maxUses) return { ok: false, reason: 'kuota key habis' };
  return {
    ok: true,
    source: 'firestore',
    payload: {
      id: key,
      tier: doc.tier || 'pro',
      plan: plan || null,
      exp: Number.isFinite(expiresAt) ? Math.floor(expiresAt / 1000) : null,
      unlimited,
      uses,
      maxUses,
    },
  };
}

export async function verifyAnyKey(keyStr) {
  const key = String(keyStr || '').trim();
  return isTtkKey(key) ? verifyFirestoreKey(key) : verifyLicenseKey(key);
}

export function readOnlyLicenseState() {
  const key = readLicenseKey();
  if (!key) return stateFromResult(null, { ok: false, reason: 'key belum dimasukkan — jalankan installer dengan --key atau SUPPRESOR_LICENSE_KEY' });
  if (isTtkKey(key)) {
    return {
      ...stateFromResult(key, { ok: false, reason: 'menunggu verifikasi Firestore' }),
      pending: true,
      message: 'menunggu verifikasi Firestore',
    };
  }
  return stateFromResult(key, verifyLicenseKey(key));
}

export async function readOnlyLicenseStateAsync() {
  const key = readLicenseKey();
  if (!key) return stateFromResult(null, { ok: false, reason: 'key belum dimasukkan — jalankan installer dengan --key atau SUPPRESOR_LICENSE_KEY' });
  const result = isTtkKey(key) ? await verifyFirestoreKey(key) : verifyLicenseKey(key);
  return stateFromResult(key, result);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain && process.argv[2] === '--verify') {
  const result = await verifyAnyKey(process.argv[3]);
  console.log(JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
}
