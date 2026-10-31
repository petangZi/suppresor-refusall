// license-key.mjs — read-only Ed25519 license gate.
// The installer writes the key once. Runtime reads it and verifies locally;
// this module never writes device ids, snapshots, counters, or server state.

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

export function readOnlyLicenseState() {
  const key = readLicenseKey();
  const checkedAt = Date.now();
  if (!key) {
    return {
      allowed: false,
      blocked: true,
      origin: 'readonly',
      tier: 'none',
      uses: 0,
      usesLeft: 0,
      freeLimit: 0,
      keyRef: null,
      activation: null,
      checkedAt,
      message: 'key belum dimasukkan — jalankan installer dengan --key atau SUPPRESOR_LICENSE_KEY',
    };
  }
  const result = verifyLicenseKey(key);
  if (!result.ok) {
    return {
      allowed: false,
      blocked: true,
      origin: 'readonly',
      tier: 'none',
      uses: 0,
      usesLeft: 0,
      freeLimit: 0,
      keyRef: null,
      activation: null,
      checkedAt,
      message: result.reason,
    };
  }
  return {
    allowed: true,
    blocked: false,
    origin: 'readonly',
    tier: result.payload.tier,
    uses: 0,
    usesLeft: 9999,
    freeLimit: 0,
    keyRef: result.payload.id || null,
    activation: { type: 'signed', key, id: result.payload.id || null, tier: result.payload.tier, exp: result.payload.exp || null },
    checkedAt,
    message: `key valid — tier ${result.payload.tier} (read-only)`,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain && process.argv[2] === '--verify') {
  const result = verifyLicenseKey(process.argv[3]);
  console.log(JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
}
