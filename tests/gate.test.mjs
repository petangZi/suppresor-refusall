// Gate proxy tests. Run: node --test tests/
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { installTokenKeys } from './gate-fixtures.mjs';

const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)));
let licensePriv = null;
try {
  licensePriv = readFileSync(join(pluginDir, 'admin', 'license-private.pem'), 'utf8');
} catch {
  /* signed-license tests skip without the admin private key */
}
const testSigned = licensePriv ? test : (name, fn) => test(name, { skip: 'admin/license-private.pem missing' }, fn);
const tokenKeys = installTokenKeys();
const tokenPub = createPublicKey(tokenKeys.publicKey);

const deviceA = 'a'.repeat(64);
const deviceB = 'b'.repeat(64);
let seq = 0;
const servers = [];

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function mintLicense(payload) {
  const body = b64url(JSON.stringify({ v: 1, tier: 'pro', dev: 5, iat: Date.now(), ...payload }));
  return `SRK1.${body}.${b64url(sign(null, Buffer.from(body), createPrivateKey(licensePriv)))}`;
}

async function verifyTokenShape(token) {
  const [tag, body, sig] = String(token).split('.');
  assert.equal(tag, 'GT1');
  assert.ok(body && sig);
  const ok = verify(null, Buffer.from(body), tokenPub, Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  assert.equal(ok, true);
  return JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

async function bootGate(env = {}) {
  const stateDir = mkdtempSync(join(tmpdir(), 'suppresor-gate-'));
  Object.assign(process.env, {
    SUPPRESOR_GATE_NOPERSIST: '1',
    SUPPRESOR_GATE_SECRET: 'test-secret',
    SUPPRESOR_FREE_LIMIT: '2',
    SUPPRESOR_MAX_DEVICES_PER_KEY: '2',
    SUPPRESOR_GATE_STATE: join(stateDir, 'state.json'),
    SUPPRESOR_STATE_DIR: stateDir,
    SUPPRESOR_TESTING: '1',
    ...env,
  });
  seq += 1;
  const mod = await import(`${pathToFileURL(join(pluginDir, 'server', 'gate.mjs')).href}?s=${seq}`);
  const srv = mod.createGateServer();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  process.env.SUPPRESOR_GATE_URL = url;
  servers.push(srv);
  return { mod, url, stateDir };
}

async function post(url, path, body, headers = {}) {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}

after(() => {
  for (const srv of servers) srv.close();
  delete process.env.SUPPRESOR_GATE_URL;
  delete process.env.SUPPRESOR_TESTING;
  delete process.env.SUPPRESOR_STATE_DIR;
  delete process.env.SUPPRESOR_OFFLINE;
});

test('health and session issue a verifiable token', async () => {
  const { url } = await bootGate();
  const health = await fetch(`${url}/healthz`);
  assert.equal(health.status, 200);
  const session = await post(url, '/v1/session', { deviceId: deviceA });
  assert.equal(session.status, 200);
  assert.equal(session.data.tier, 'free');
  assert.equal(session.data.uses, 1);
  const payload = await verifyTokenShape(session.data.token);
  assert.equal(payload.sub, deviceA);
  assert.ok(payload.exp > Date.now() / 1000);
});

test('free sessions are counted server-side and then blocked', async () => {
  const { url } = await bootGate();
  const first = await post(url, '/v1/session', { deviceId: deviceA });
  const second = await post(url, '/v1/session', { deviceId: deviceA });
  const third = await post(url, '/v1/session', { deviceId: deviceA });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(third.status, 402);
  assert.equal(third.data.blocked, true);
  assert.equal(third.data.uses, 3);
});

test('fresh device id gets its own counter', async () => {
  const { url } = await bootGate();
  await post(url, '/v1/session', { deviceId: deviceA });
  await post(url, '/v1/session', { deviceId: deviceA });
  const other = await post(url, '/v1/session', { deviceId: deviceB });
  assert.equal(other.status, 200);
  assert.equal(other.data.uses, 1);
});

testSigned('signed license key yields a pro token without touching the free counter', async () => {
  const { url } = await bootGate();
  const key = mintLicense({ id: 'SRK-GATE-1', exp: Date.now() + 86400000 });
  const res = await post(url, '/v1/session', { deviceId: deviceA, licenseKey: key });
  assert.equal(res.status, 200);
  assert.equal(res.data.tier, 'pro');
  const payload = await verifyTokenShape(res.data.token);
  assert.equal(payload.tier, 'pro');
  assert.equal(payload.keyId, 'SRK-GATE-1');
});

testSigned('expired and forged licenses are rejected', async () => {
  const { url } = await bootGate();
  const expired = mintLicense({ id: 'SRK-GATE-2', exp: Date.now() - 1000 });
  const forged = `SRK1.${b64url(JSON.stringify({ v: 1, tier: 'pro', id: 'x', exp: 0 }))}.${b64url(Buffer.from('fake'))}`;
  assert.equal((await post(url, '/v1/session', { deviceId: deviceA, licenseKey: expired })).status, 401);
  assert.equal((await post(url, '/v1/session', { deviceId: deviceA, licenseKey: forged })).status, 401);
});

testSigned('device cap per key is enforced', async () => {
  const { url } = await bootGate();
  const key = mintLicense({ id: 'SRK-GATE-3', exp: 0 });
  assert.equal((await post(url, '/v1/session', { deviceId: deviceA, licenseKey: key })).status, 200);
  assert.equal((await post(url, '/v1/session', { deviceId: deviceB, licenseKey: key })).status, 200);
  const third = await post(url, '/v1/session', { deviceId: 'c'.repeat(64), licenseKey: key });
  assert.equal(third.status, 403);
  assert.equal(third.data.error, 'device_limit');
});

testSigned('revocation blocks new sessions and transforms', async () => {
  const { url } = await bootGate();
  const key = mintLicense({ id: 'SRK-GATE-4', exp: 0 });
  const session = await post(url, '/v1/session', { deviceId: deviceA, licenseKey: key });
  assert.equal(session.status, 200);
  const revoke = await post(url, '/v1/admin/revoke', { keyId: 'SRK-GATE-4' }, { 'x-gate-secret': 'test-secret' });
  assert.equal(revoke.status, 200);
  const afterRevoke = await post(url, '/v1/session', { deviceId: deviceA, licenseKey: key });
  assert.equal(afterRevoke.status, 403);
  const transform = await post(url, '/v1/transform', { token: session.data.token, items: ['hello'] });
  assert.equal(transform.status, 403);
});

test('admin endpoints require the secret', async () => {
  const { url } = await bootGate();
  assert.equal((await post(url, '/v1/admin/revoke', { keyId: 'x' })).status, 403);
  assert.equal((await post(url, '/v1/admin/revoke', { keyId: 'x' }, { 'x-gate-secret': 'wrong' })).status, 403);
});

test('transform strips refusals and keeps clean text intact', async () => {
  const { url } = await bootGate();
  const session = await post(url, '/v1/session', { deviceId: deviceA });
  const refused = "I'm sorry, but I can't help with that. As an AI, I must decline.";
  const clean = 'Build the parser with a recursive descent loop.';
  const res = await post(url, '/v1/transform', { token: session.data.token, items: [refused, clean] });
  assert.equal(res.status, 200);
  assert.equal(res.data.items.length, 2);
  assert.equal(res.data.items[0].changed, true);
  assert.equal(res.data.items[0].text.includes("I'm sorry"), false);
  assert.equal(res.data.items[1].changed, false);
  assert.equal(res.data.items[1].text, clean);
});

test('bad, expired and malformed tokens are rejected by transform', async () => {
  const { url } = await bootGate();
  assert.equal((await post(url, '/v1/transform', { token: 'nope', items: ['x'] })).status, 401);
  assert.equal((await post(url, '/v1/transform', { token: 'GT1.abc.def', items: ['x'] })).status, 401);
});

test('client issues, caches and reuses a token', async () => {
  const { url } = await bootGate();
  process.env.SUPPRESOR_OFFLINE = '0';
  const client = await import(`${pathToFileURL(join(pluginDir, 'gate-client.mjs')).href}?c=${++seq}`);
  const started = await client.startSession({ deviceId: deviceA });
  assert.equal(started.ok, true);
  assert.equal(started.tier, 'free');
  const token = await client.ensureToken({ deviceId: deviceA });
  assert.ok(token);
  const cached = client.cachedToken();
  assert.equal(cached.payload.sub, deviceA);
  const out = await client.transformTexts(["I'm sorry, but I can't help with that."], { deviceId: deviceA });
  assert.equal(Array.isArray(out), true);
  assert.equal(out[0].changed, true);
  void url;
});

test('client keeps working without a gate (returns null, no throw)', async () => {
  process.env.SUPPRESOR_GATE_URL = 'http://127.0.0.1:1';
  const client = await import(`${pathToFileURL(join(pluginDir, 'gate-client.mjs')).href}?c=${++seq}`);
  const started = await client.startSession({ deviceId: deviceA });
  assert.equal(started, null);
  assert.equal(await client.transformTexts(['text'], { deviceId: deviceA }), null);
});

test('license.spendUse prefers the gateway counter and falls back offline', async () => {
  const { url } = await bootGate();
  const lic = await import(`${pathToFileURL(join(pluginDir, 'license.mjs')).href}?l=${++seq}`);
  const state = await lic.spendUse();
  assert.equal(state.origin, 'gateway');
  assert.equal(state.uses, 1);
  assert.equal(state.allowed, true);

  process.env.SUPPRESOR_GATE_URL = 'http://127.0.0.1:1';
  process.env.SUPPRESOR_OFFLINE = '1';
  const lic2 = await import(`${pathToFileURL(join(pluginDir, 'license.mjs')).href}?l=${++seq}`);
  const fallback = await lic2.spendUse();
  assert.equal(fallback.origin, 'offline');
  assert.equal(fallback.allowed, true);
  delete process.env.SUPPRESOR_OFFLINE;
  void url;
});

test('gateway blocks the session once the server counter passes the limit', async () => {
  await bootGate();
  const lic = await import(`${pathToFileURL(join(pluginDir, 'license.mjs')).href}?l=${++seq}`);
  const first = await lic.spendUse();
  const second = await lic.spendUse();
  const third = await lic.spendUse();
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(third.origin, 'gateway');
  assert.match(third.message, /free_limit/);
});
