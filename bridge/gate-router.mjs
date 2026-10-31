// Drop-in Express router that exposes the gate bridge contract.
// Mount it at /api so the paths become /api/internal/*.

import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';

function secretMatches(header, secret) {
  const given = Buffer.from(String(header || ''));
  const expected = Buffer.from(String(secret || ''));
  if (!expected.length || given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

function normalizeKey(keyId, raw) {
  const data = raw && typeof raw.data === 'function' ? raw.data() : raw;
  if (!data) return null;
  const status = String(data.status || (data.active === true ? 'ACTIVE' : '')).toUpperCase();
  const expiresRaw = data.expiresAt;
  const expiresAt = expiresRaw?.toDate
    ? expiresRaw.toDate().toISOString()
    : typeof expiresRaw === 'string'
      ? expiresRaw
      : null;
  const daysRemaining = typeof data.daysRemaining === 'number' ? data.daysRemaining : undefined;
  return {
    ok: status === 'ACTIVE',
    keyId,
    status: status || 'UNKNOWN',
    tier: data.tier || 'pro',
    expiresAt,
    daysRemaining,
    maxDevices: Number(data.maxDevices) || 5,
    displayName: data.displayName || undefined,
  };
}

export function createGateRouter({ secret, store, allowCors = false } = {}) {
  const router = Router();

  router.use((req, res, next) => {
    if (!secret) return res.status(503).json({ ok: false, error: 'bridge_disabled' });
    if (!secretMatches(req.get('x-gate-secret'), secret)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    if (allowCors) {
      res.set('access-control-allow-origin', '*');
      res.set('access-control-allow-headers', 'content-type,x-gate-secret,idempotency-key');
    }
    next();
  });

  router.get('/internal/license/:keyId', async (req, res) => {
    try {
      const doc = await store.getKey(req.params.keyId);
      if (!doc) return res.status(404).json({ ok: false, error: 'not_found' });
      const normalized = normalizeKey(req.params.keyId, doc);
      if (!normalized) return res.status(404).json({ ok: false, error: 'not_found' });
      if (!normalized.ok) {
        return res.status(200).json({ ok: false, error: 'inactive', status: normalized.status });
      }
      if (normalized.expiresAt && Date.parse(normalized.expiresAt) < Date.now()) {
        return res.status(200).json({ ok: false, error: 'expired', status: normalized.status });
      }
      if (normalized.daysRemaining !== undefined && normalized.daysRemaining <= 0) {
        return res.status(200).json({ ok: false, error: 'expired', status: normalized.status });
      }
      return res.status(200).json(normalized);
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'store_error', detail: error.message });
    }
  });

  router.post('/internal/usage/consume', async (req, res) => {
    const deviceId = String(req.body?.deviceId || '');
    if (!/^[a-f0-9]{32,64}$/i.test(deviceId)) return res.status(400).json({ ok: false, error: 'bad_device' });
    try {
      const result = await store.consume({ deviceId, idempotencyKey: req.get('idempotency-key') || null });
      if (!result) return res.status(500).json({ ok: false, error: 'store_error' });
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'store_error', detail: error.message });
    }
  });

  router.post('/internal/usage/heartbeat', async (req, res) => {
    const deviceId = String(req.body?.deviceId || '');
    if (!/^[a-f0-9]{32,64}$/i.test(deviceId)) return res.status(400).json({ ok: false, error: 'bad_device' });
    try {
      const result = await store.heartbeat({ deviceId, keyId: req.body?.keyId || null });
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'store_error', detail: error.message });
    }
  });

  router.post('/internal/revoke', async (req, res) => {
    try {
      await store.revoke({ keyId: req.body?.keyId || null, deviceId: req.body?.deviceId || null });
      return res.status(200).json({ ok: true });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'store_error', detail: error.message });
    }
  });

  return router;
}

export function createMemoryStore({ freeLimit = 15 } = {}) {
  const keys = new Map();
  const usage = new Map();
  const revoked = new Set();
  return {
    keys,
    usage,
    revoked,
    setKey(keyId, value) { keys.set(keyId, value); },
    async getKey(keyId) { return keys.get(keyId) ?? null; },
    async consume({ deviceId }) {
      const entry = usage.get(deviceId) || { uses: 0 };
      entry.uses += 1;
      usage.set(deviceId, entry);
      return { uses: entry.uses, limit: freeLimit, allowed: entry.uses <= freeLimit };
    },
    async heartbeat({ deviceId, keyId }) {
      const entry = usage.get(deviceId) || { uses: 0 };
      return { allowed: !(keyId && revoked.has(keyId)), revoked: keyId ? revoked.has(keyId) : false, uses: entry.uses, limit: freeLimit };
    },
    async revoke({ keyId }) { if (keyId) revoked.add(keyId); },
  };
}
