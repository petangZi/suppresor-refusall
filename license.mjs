// license.mjs — Suppresor Refusall licensing gate (TikiTeam).
// Free tier: FREE_LIMIT session starts. Pro: Ed25519-signed key, verified offline.
// Firestore is used as the authoritative usage ledger when auth is reachable and as an
// optional revocation check; it is never required for a signed key to work.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir, hostname, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { startSession as gateStart, gateUrl, verifyKey as gateVerify } from './gate-client.mjs';
import { keyGateRequired, readOnlyLicenseState, verifyLicenseKey } from './license-key.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const FREE_LIMIT = intEnv('SUPPRESOR_FREE_LIMIT', 15);
const MAX_DEVICES_PER_KEY = intEnv('SUPPRESOR_MAX_DEVICES_PER_KEY', 5);
const RECHECK_MS = intEnv('SUPPRESOR_LICENSE_RECHECK_MS', 6 * 60 * 60 * 1000);
const OFFLINE_GRACE_MS = intEnv('SUPPRESOR_OFFLINE_GRACE_MS', 48 * 60 * 60 * 1000);
const STRICT_ONLINE = process.env.SUPPRESOR_STRICT_ONLINE === '1';

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function stateDir() {
  if (process.env.SUPPRESOR_TESTING === '1' && process.env.SUPPRESOR_STATE_DIR) {
    return process.env.SUPPRESOR_STATE_DIR;
  }
  return join(homedir(), '.config', 'opencode');
}

const cfgDir = stateDir();
const devicePath = join(cfgDir, '.suppresor-device');
const licensePath = join(cfgDir, '.suppresor-license');
const shadowPath = join(cfgDir, '.suppresor-uses');
const installMarkerPath = join(cfgDir, '.suppresor-install');
const noLicensePath = join(cfgDir, '.suppresor-nolicense');

function licenseDisabled() {
  return process.env.SUPPRESOR_NO_LICENSE === '1' || existsSync(noLicensePath);
}

function log(msg) {
  if (process.env.SUPPRESOR_DEBUG === '1') console.error(`suppresor-license: ${msg}`);
}

function write600(p, text) {
  try {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text, { mode: 0o600 });
  } catch (e) {
    log(`write failed ${p}: ${e.message}`);
  }
}

export function deviceId() {
  if (existsSync(devicePath)) {
    const raw = readFileSync(devicePath, 'utf8').trim();
    if (/^[a-f0-9]{32,64}$/i.test(raw)) return raw;
  }
  if (keyGateRequired()) return null;
  const seed = createHash('sha256').update(`${hostname()}|${platform()}|${randomUUID()}`).digest('hex');
  write600(devicePath, seed);
  return seed;
}

function markInstall() {
  if (!existsSync(installMarkerPath)) write600(installMarkerPath, String(Date.now()));
}

let snapshot = {
  allowed: true,
  blocked: false,
  needsSync: false,
  origin: 'default',
  tier: 'free',
  uses: 0,
  usesLeft: FREE_LIMIT,
  freeLimit: FREE_LIMIT,
  keyRef: null,
  activation: null,
  checkedAt: 0,
  message: 'first-run default (free tier)',
};

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function loadShadowUses() {
  const raw = readJson(shadowPath);
  return raw && typeof raw.uses === 'number' ? raw.uses : null;
}

function writeShadowUses(uses) {
  write600(shadowPath, JSON.stringify({ uses, at: Date.now() }));
}

function loadSnapshot() {
  if (keyGateRequired()) {
    snapshot = readOnlyLicenseState();
    return snapshot;
  }
  const cached = readJson(licensePath);
  const shadowUses = loadShadowUses();
  if (cached && typeof cached.checkedAt === 'number') snapshot = { ...snapshot, ...cached };
  if (typeof shadowUses === 'number') snapshot.uses = Math.max(snapshot.uses || 0, shadowUses);
  if (snapshot.activation) {
    const v = verifyActivation(snapshot.activation);
    if (!v.ok) {
      snapshot.allowed = false;
      snapshot.blocked = true;
      snapshot.message = v.reason;
    }
  }
  return snapshot;
}

function saveSnapshot() {
  if (keyGateRequired()) return;
  write600(licensePath, JSON.stringify(snapshot, null, 2));
  if (snapshot.tier === 'free') writeShadowUses(snapshot.uses || 0);
}

export function gateState() {
  return snapshot;
}

export function allowedNow() {
  if (licenseDisabled()) return true;
  if (keyGateRequired()) return snapshot.allowed === true;
  return snapshot.allowed !== false && snapshot.blocked !== true;
}

let notifier = null;

export function setNotifier(fn) {
  notifier = typeof fn === 'function' ? fn : null;
}

function notify(level, title, message) {
  if (notifier) {
    try {
      notifier({ level, title, message });
      return;
    } catch (e) {
      log(`notifier failed: ${e.message}`);
    }
  }
  const marker = level === 'error' ? '!' : '·';
  console.error(`suppresor ${marker} ${title}${message ? ` — ${message}` : ''}`);
}

export function showFreeWarning(usesLeft) {
  if (licenseDisabled() || usesLeft > 3) return;
  notify('warn', `free plan · ${usesLeft}/${FREE_LIMIT} left`, 'activate with /suppresor-refusall key <KEY>');
}

export function showLimitReached(reason) {
  if (licenseDisabled()) return;
  notify('error', 'enforcement off · limit reached', reason || `free plan ${FREE_LIMIT}/${FREE_LIMIT}`);
}

// ---- signed keys ------------------------------------------------------------

export function verifySignedKey(keyStr) {
  return verifyLicenseKey(keyStr);
}

export function verifyActivation(activation) {
  if (!activation || typeof activation.key !== 'string') {
    return { ok: false, reason: 'aktivasi tidak ada' };
  }
  return verifySignedKey(activation.key);
}

async function buildSignedActivation(keyStr, payload) {
  return {
    type: 'signed',
    key: keyStr,
    id: payload.id || null,
    tier: payload.tier,
    exp: payload.exp || null,
    deviceCap: payload.dev || MAX_DEVICES_PER_KEY,
    boundAt: Date.now(),
    deviceId: deviceId(),
  };
}

// ---- Firestore helpers (best effort; never required for signed keys) --------

async function firestoreClient() {
  return import('./firestore-client.js');
}

async function ensureUserLedger(client, uid, did) {
  try {
    const doc = await client.getDocument('users', uid);
    return { uid, doc };
  } catch {
    try {
      await client.createDocument('users', { deviceId: did, keyRef: null, uses: 0 }, uid);
      return { uid, doc: { deviceId: did, keyRef: null, uses: 0 } };
    } catch (e) {
      log(`ledger create failed: ${e.message}`);
      return null;
    }
  }
}

function normalizeLegacyKey(key) {
  const status = String(key.status || (key.active === true ? 'ACTIVE' : '')).toUpperCase();
  const active = key.active === true || status === 'ACTIVE';
  const unlimited = key.durationDays === -1 || key.daysRemaining === 99999 || key.maxUses === -1;
  let expired = false;
  if (typeof key.expiresAt === 'string') expired = Date.parse(key.expiresAt) < Date.now();
  else if (typeof key.daysRemaining === 'number' && key.daysRemaining <= 0) expired = true;
  const maxUses = typeof key.maxUses === 'number' ? key.maxUses : -1;
  const uses = typeof key.uses === 'number' ? key.uses : 0;
  const devices = Array.isArray(key.devices) ? key.devices : [];
  return { active, expired, unlimited, maxUses, uses, devices, tier: key.tier || 'pro', status };
}

async function validateLegacyKeyDoc(client, keyStr, did) {
  const docId = keyStr.trim();
  let raw;
  try {
    raw = await client.getDocument('accessKeys', docId);
  } catch (e) {
    if (STRICT_ONLINE) {
      return { ok: false, message: 'aktivasi key legacy butuh gate online (mode strict)' };
    }
    // Older deployments left the key document readable without an id token
    // (rules allowed get). Fall back to a public read before giving up.
    try {
      raw = await client.getDocumentPublic('accessKeys', docId);
    } catch (e2) {
      return { ok: false, message: `key tidak ditemukan atau server menolak (${e.message})` };
    }
  }
  if (!raw) return { ok: false, message: 'key tidak ditemukan' };
  const key = normalizeLegacyKey(raw);
  if (!key.active) return { ok: false, message: `key tidak aktif (${key.status || 'unknown'})` };
  if (key.expired) return { ok: false, message: 'key expired' };
  if (!key.unlimited && key.maxUses > 0 && key.uses >= key.maxUses) {
    return { ok: false, message: 'kuota key habis' };
  }
  if (key.devices.length && !key.devices.includes(did)) {
    if (key.devices.length >= MAX_DEVICES_PER_KEY) {
      return { ok: false, message: `maksimal ${MAX_DEVICES_PER_KEY} device per key` };
    }
  }
  if (!key.devices.includes(did)) {
    try {
      await client.setDocument('accessKeys', docId, {
        devices: [...key.devices, did],
        lastUseAt: { __timestamp: new Date().toISOString() },
      }, { merge: true });
    } catch (e) {
      log(`device register skipped: ${e.message}`);
    }
  }
  return { ok: true, tier: key.tier, keyRef: docId, message: `key valid — tier ${key.tier}` };
}

async function remoteRevocationCheck(activation) {
  if (!activation || activation.type !== 'signed' || !activation.id) return { ok: true };
  try {
    const client = await firestoreClient();
    const doc = await client.getDocument('accessKeys', activation.id);
    if (doc && doc.active === false) return { ok: false, message: 'key di-revoke' };
  } catch {
    /* offline or unauthenticated: signed key stays authoritative */
  }
  return { ok: true };
}

// ---- public API -------------------------------------------------------------

export async function activateDevice(keyStr) {
  if (licenseDisabled()) return { ok: true, tier: 'pro', message: 'license bypass aktif' };
  if (keyGateRequired()) {
    return { ok: false, message: 'mode read-only — key hanya dibaca, tidak disimpan saat runtime' };
  }
  markInstall();
  const did = deviceId();
  const trimmed = String(keyStr || '').trim();
  const signed = verifySignedKey(trimmed);

  if (signed.ok) {
    snapshot = {
      ...snapshot,
      allowed: true,
      blocked: false,
      needsSync: false,
      origin: 'signed',
      tier: 'pro',
      keyRef: signed.payload.id || null,
      activation: await buildSignedActivation(trimmed, signed.payload),
      checkedAt: Date.now(),
      message: `key valid — tier pro${signed.payload.exp ? ` (exp ${new Date(signed.payload.exp).toISOString().slice(0, 10)})` : ''}`,
    };
    saveSnapshot();
    notify('info', 'key active · tier pro', snapshot.message);
    return { ok: true, tier: 'pro', message: snapshot.message };
  }

  if (signed.reason !== 'format key tidak dikenal') {
    return { ok: false, message: signed.reason };
  }

  if (process.env.SUPPRESOR_OFFLINE === '1') {
    return { ok: false, message: 'mode offline: hanya key format SRK1.<payload>.<signature> yang bisa diaktivasi' };
  }

  if (gateUrl()) {
    const verified = await gateVerify(trimmed).catch(() => null);
    if (verified && verified.ok) {
      const exp = typeof verified.expiresAt === 'string' ? Math.floor(Date.parse(verified.expiresAt) / 1000) : undefined;
      snapshot = {
        ...snapshot,
        allowed: true,
        blocked: false,
        needsSync: false,
        origin: 'gateway',
        tier: verified.tier || 'pro',
        keyRef: verified.keyId || trimmed,
        activation: { type: 'gateway', key: trimmed, id: verified.keyId, tier: verified.tier, exp },
        checkedAt: Date.now(),
        message: `key valid — tier ${verified.tier || 'pro'} (bridge)`,
      };
      saveSnapshot();
      notify('info', 'key active · tier ' + (verified.tier || 'pro'), 'verified by bridge');
      return { ok: true, tier: verified.tier || 'pro', message: snapshot.message };
    }
    if (verified && verified.ok === false) {
      const reason = String(verified.error || 'inactive');
      const message = reason === 'not_found' ? 'key tidak ditemukan' : reason === 'expired' ? 'key expired' : 'key tidak aktif';
      return { ok: false, message };
    }
  }

  try {
    const client = await firestoreClient();
    const res = await validateLegacyKeyDoc(client, trimmed, did);
    if (!res.ok) return { ok: false, message: res.message };
    snapshot = {
      ...snapshot,
      allowed: true,
      blocked: false,
      needsSync: false,
      origin: 'server',
      tier: 'pro',
      keyRef: res.keyRef,
      activation: { type: 'firestore', key: trimmed, id: res.keyRef },
      checkedAt: Date.now(),
      message: res.message,
    };
    saveSnapshot();
    notify('info', 'key active · tier pro', res.message);
    return { ok: true, tier: 'pro', message: res.message };
  } catch (e) {
    return {
      ok: false,
      message: `key tidak bisa divalidasi: ${e.message}. Minta key format SRK1.<payload>.<signature> untuk aktivasi offline.`,
    };
  }
}

async function serverTruth(client, did) {
  try {
    const { uid } = await client.ensureAnonAuth();
    if (!uid) return null;
    const ledger = await ensureUserLedger(client, uid, did);
    if (!ledger) return null;
    return { uid, uses: typeof ledger.doc.uses === 'number' ? ledger.doc.uses : 0 };
  } catch (e) {
    log(`server truth failed: ${e.message}`);
    return null;
  }
}

export async function spendUse() {
  if (licenseDisabled()) {
    snapshot = {
      tier: 'pro',
      allowed: true,
      blocked: false,
      origin: 'bypass',
      uses: 0,
      usesLeft: 9999,
      needsSync: false,
      checkedAt: Date.now(),
      message: 'license bypass aktif',
    };
    if (!keyGateRequired()) saveSnapshot();
    return snapshot;
  }

  if (keyGateRequired()) {
    snapshot = readOnlyLicenseState();
    if (!snapshot.allowed) showLimitReached(snapshot.message);
    return snapshot;
  }

  const hadInstallMarker = existsSync(installMarkerPath);
  markInstall();
  loadSnapshot();
  const did = deviceId();
  const now = Date.now();
  const offline = process.env.SUPPRESOR_OFFLINE === '1';

  // Gateway is authoritative when reachable: server counts free sessions, enforces
  // device caps and revocations. Local state is the fallback, not the source of truth.
  if (gateUrl()) {
    const gateKey = snapshot.activation && (snapshot.activation.type === 'signed' || snapshot.activation.type === 'firestore')
      ? snapshot.activation.key
      : null;
    const gate = await gateStart({ deviceId: did, licenseKey: gateKey }).catch(() => null);
    if (gate) {
      if (gate.blocked) {
        snapshot = {
          ...snapshot,
          allowed: false,
          blocked: true,
          origin: 'gateway',
          tier: gateKey ? 'pro' : 'free',
          checkedAt: now,
          message: `gateway: ${gate.reason}${gate.uses ? ` (${gate.uses}/${gate.limit})` : ''}`,
        };
        saveSnapshot();
        showLimitReached(snapshot.message);
        return snapshot;
      }
      snapshot = {
        ...snapshot,
        allowed: true,
        blocked: false,
        origin: 'gateway',
        tier: gate.tier || snapshot.tier,
        uses: typeof gate.uses === 'number' ? gate.uses : snapshot.uses,
        usesLeft: Math.max((gate.limit || FREE_LIMIT) - (gate.uses || 0), 0),
        needsSync: false,
        checkedAt: now,
        message: `gateway — ${gate.tier}${gate.tier === 'free' ? ` ${gate.uses}/${gate.limit}` : ''}`,
      };
      saveSnapshot();
      if (snapshot.tier === 'free') showFreeWarning(snapshot.usesLeft);
      return snapshot;
    }
  }

  if (snapshot.activation) {
    const v = verifyActivation(snapshot.activation);
    if (!v.ok) {
      snapshot = { ...snapshot, allowed: false, blocked: true, message: v.reason };
      saveSnapshot();
      showLimitReached(v.reason);
      return snapshot;
    }
    if (now - (snapshot.checkedAt || 0) >= RECHECK_MS) {
      const rev = await remoteRevocationCheck(snapshot.activation);
      if (!rev.ok) {
        snapshot = { ...snapshot, allowed: false, blocked: true, checkedAt: now, message: rev.message };
        saveSnapshot();
        showLimitReached(rev.message);
        return snapshot;
      }
      snapshot.checkedAt = now;
    }
    snapshot.allowed = true;
    snapshot.blocked = false;
    saveSnapshot();
    return snapshot;
  }

  const tampered = hadInstallMarker && !existsSync(licensePath) && loadShadowUses() === null;
  if (tampered) {
    snapshot = {
      ...snapshot,
      allowed: false,
      blocked: true,
      origin: 'tamper',
      message: 'state lisensi dihapus — aktivasi key atau tunggu revalidasi server',
    };
    saveSnapshot();
  }

  const client = offline ? null : await firestoreClient().catch(() => null);

  // Sticky blocks: only a server-confirmed counter below the limit, or a valid key,
  // can lift them. Local editing cannot.
  if (snapshot.blocked && (snapshot.origin === 'server' || snapshot.origin === 'tamper' || snapshot.origin === 'offline')) {
    if (!client) return snapshot;
    const truth = await serverTruth(client, did);
    if (!truth || truth.uses > FREE_LIMIT) return snapshot;
    snapshot = {
      ...snapshot,
      tier: 'free',
      origin: 'server',
      uses: truth.uses,
      usesLeft: Math.max(FREE_LIMIT - truth.uses, 0),
      allowed: true,
      blocked: false,
      needsSync: false,
      checkedAt: now,
      message: `free tier — ${truth.uses}/${FREE_LIMIT}`,
    };
    saveSnapshot();
    return snapshot;
  }

  const graceExpired = snapshot.checkedAt !== 0 && now - snapshot.checkedAt > OFFLINE_GRACE_MS;
  if (graceExpired) {
    snapshot = { ...snapshot, allowed: false, blocked: true, needsSync: true, message: 'offline grace habis — perlu revalidasi' };
    saveSnapshot();
    showLimitReached(snapshot.message);
    return snapshot;
  }

  if (client) {
    const started = await serverTruth(client, did);
    if (started) {
      try {
        const after = await client.incrementField('users', started.uid, 'uses', 1);
        const used = after && typeof after.uses === 'number' ? after.uses : started.uses + 1;
        snapshot = {
          ...snapshot,
          tier: 'free',
          origin: 'server',
          uses: used,
          usesLeft: Math.max(FREE_LIMIT - used, 0),
          allowed: used <= FREE_LIMIT,
          blocked: used > FREE_LIMIT,
          needsSync: false,
          checkedAt: now,
          message: used > FREE_LIMIT ? 'FREE LIMIT REACHED (server count)' : `free tier — ${used}/${FREE_LIMIT}`,
        };
        saveSnapshot();
        if (snapshot.blocked) showLimitReached();
        else showFreeWarning(snapshot.usesLeft);
        return snapshot;
      } catch (e) {
        log(`ledger increment failed: ${e.message}`);
      }
    }
  }

  const used = Math.max(snapshot.uses || 0, loadShadowUses() || 0) + 1;
  snapshot = {
    ...snapshot,
    tier: 'free',
    origin: 'offline',
    uses: used,
    usesLeft: Math.max(FREE_LIMIT - used, 0),
    allowed: used <= FREE_LIMIT,
    blocked: used > FREE_LIMIT,
    needsSync: true,
    checkedAt: snapshot.checkedAt || now,
    message: `offline — ${used}/${FREE_LIMIT} (needsSync)`,
  };
  saveSnapshot();
  if (snapshot.blocked) showLimitReached();
  else showFreeWarning(snapshot.usesLeft);
  return snapshot;
}

loadSnapshot();
