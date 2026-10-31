// License gate regression tests. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPrivateKey, sign } from 'node:crypto';

const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)));
const licenseUrl = pathToFileURL(join(pluginDir, 'license.mjs')).href;
let privatePem = null;
try {
  privatePem = readFileSync(join(pluginDir, 'admin', 'license-private.pem'), 'utf8');
} catch {
  /* signed-key tests skip without the admin private key */
}
const testSigned = privatePem ? test : (name, fn) => test(name, { skip: 'admin/license-private.pem missing' }, fn);

let seq = 0;

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'suppresor-license-'));
  process.env.SUPPRESOR_TESTING = '1';
  process.env.SUPPRESOR_STATE_DIR = dir;
  process.env.SUPPRESOR_OFFLINE = '1';
  process.env.SUPPRESOR_FREE_LIMIT = '3';
  process.env.SUPPRESOR_MAX_DEVICES_PER_KEY = '5';
  process.env.SUPPRESOR_DEBUG = '0';
  return dir;
}

async function load() {
  seq += 1;
  return import(`${licenseUrl}?t=${seq}`);
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signKey(payload, pem = privatePem) {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(sign(null, Buffer.from(body), createPrivateKey(pem)));
  return `SRK1.${body}.${sig}`;
}

testSigned('free tier allows exactly the limit then blocks', async () => {
  sandbox();
  const lic = await load();
  const states = [];
  for (let i = 0; i < 4; i++) states.push(await lic.spendUse());
  assert.equal(states[0].allowed, true);
  assert.equal(states[1].allowed, true);
  assert.equal(states[2].allowed, true);
  assert.equal(states[3].allowed, false);
  assert.equal(states[3].uses, 4);
  assert.equal(states[3].usesLeft, 0);
});

testSigned('deleting the license file does not reset the counter (shadow copy)', async () => {
  const dir = sandbox();
  let lic = await load();
  for (let i = 0; i < 4; i++) await lic.spendUse();
  unlinkSync(join(dir, '.suppresor-license'));
  lic = await load();
  const next = await lic.spendUse();
  assert.equal(next.allowed, false);
  assert.equal(next.uses, 5);
});

testSigned('deleting all state is detected as tamper and stays blocked', async () => {
  const dir = sandbox();
  let lic = await load();
  for (let i = 0; i < 4; i++) await lic.spendUse();
  for (const f of ['.suppresor-license', '.suppresor-uses']) {
    const p = join(dir, f);
    if (existsSync(p)) unlinkSync(p);
  }
  lic = await load();
  const blocked = await lic.spendUse();
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.origin, 'tamper');

  lic = await load();
  const stillBlocked = await lic.spendUse();
  assert.equal(stillBlocked.allowed, false);
  assert.equal(stillBlocked.blocked, true);
});

testSigned('editing the cached counter down is ignored while the shadow copy holds', async () => {
  const dir = sandbox();
  let lic = await load();
  for (let i = 0; i < 4; i++) await lic.spendUse();
  const p = join(dir, '.suppresor-license');
  const snap = JSON.parse(readFileSync(p, 'utf8'));
  snap.uses = 0;
  snap.allowed = true;
  snap.blocked = false;
  writeFileSync(p, JSON.stringify(snap));
  lic = await load();
  const next = await lic.spendUse();
  assert.equal(next.allowed, false);
  assert.equal(next.uses >= 4, true);
});

testSigned('valid signed key activates pro offline and stays valid', async () => {
  sandbox();
  const lic = await load();
  const key = signKey({ v: 1, id: 'SRK-TEST-1', tier: 'pro', dev: 5, iat: Date.now(), exp: Date.now() + 86400000 });
  const res = await lic.activateDevice(key);
  assert.equal(res.ok, true);
  assert.equal(res.tier, 'pro');
  const state = await lic.spendUse();
  assert.equal(state.allowed, true);
  assert.equal(state.blocked, false);
  assert.equal(lic.allowedNow(), true);
});

testSigned('expired signed key is rejected', async () => {
  sandbox();
  const lic = await load();
  const key = signKey({ v: 1, id: 'SRK-TEST-2', tier: 'pro', dev: 5, iat: Date.now() - 2e8, exp: Date.now() - 1000 });
  const res = await lic.activateDevice(key);
  assert.equal(res.ok, false);
  assert.match(res.message, /expired/);
});

testSigned('forged signature is rejected', async () => {
  const dir = sandbox();
  const { generateKeyPairSync } = await import('node:crypto');
  const other = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  const lic = await load();
  const key = signKey({ v: 1, id: 'SRK-TEST-3', tier: 'pro', dev: 5, iat: Date.now(), exp: 0 }, other);
  const res = await lic.activateDevice(key);
  assert.equal(res.ok, false);
  assert.match(res.message, /signature/);
  const p = join(dir, '.suppresor-license');
  assert.equal(existsSync(p), false);
});

testSigned('payload tampering breaks the signature', async () => {
  sandbox();
  const lic = await load();
  const key = signKey({ v: 1, id: 'SRK-TEST-4', tier: 'pro', dev: 5, iat: Date.now(), exp: Date.now() + 1000 });
  const [tag, body, sig] = key.split('.');
  const forged = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  forged.exp = Date.now() + 10 * 365 * 86400000;
  const tampered = `${tag}.${b64url(JSON.stringify(forged))}.${sig}`;
  const res = await lic.activateDevice(tampered);
  assert.equal(res.ok, false);
  assert.match(res.message, /signature/);
});

testSigned('expiry is re-checked from the stored activation on every session', async () => {
  const dir = sandbox();
  let lic = await load();
  const key = signKey({ v: 1, id: 'SRK-TEST-5', tier: 'pro', dev: 5, iat: Date.now(), exp: Date.now() + 60000 });
  assert.equal((await lic.activateDevice(key)).ok, true);

  const p = join(dir, '.suppresor-license');
  const snap = JSON.parse(readFileSync(p, 'utf8'));
  const [tag, body, sig] = key.split('.');
  const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  payload.exp = Date.now() - 1000;
  const expiredBody = b64url(JSON.stringify(payload));
  void tag; void sig;
  snap.activation.key = signKey(payload);
  snap.keyRef = expiredBody;
  writeFileSync(p, JSON.stringify(snap));

  lic = await load();
  const state = await lic.spendUse();
  assert.equal(state.allowed, false);
  assert.match(state.message, /expired/);
});

testSigned('legacy firestore-format key fails cleanly in offline mode', async () => {
  sandbox();
  const lic = await load();
  const res = await lic.activateDevice('SRK-AAAA-BBBB-CCCC-DDDD');
  assert.equal(res.ok, false);
  assert.match(res.message, /offline|tidak ditemukan|tidak bisa/);
});

testSigned('malformed keys are rejected without touching state', async () => {
  const dir = sandbox();
  const lic = await load();
  for (const bad of ['', 'SRK1', 'SRK1.only-two', 'SRK1..', 'not-a-key']) {
    const res = await lic.activateDevice(bad);
    assert.equal(res.ok, false, `accepted: ${bad}`);
  }
  assert.equal(existsSync(join(dir, '.suppresor-license')), false);
});

testSigned('device id is stable and 0600 mode', async () => {
  const dir = sandbox();
  const lic = await load();
  const a = lic.deviceId();
  const b = lic.deviceId();
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
  const { statSync } = await import('node:fs');
  const mode = statSync(join(dir, '.suppresor-device')).mode & 0o777;
  assert.equal(mode, 0o600);
});

testSigned('rustle-free: spendUse is safe to call repeatedly after block', async () => {
  sandbox();
  const lic = await load();
  for (let i = 0; i < 6; i++) await lic.spendUse();
  const a = await lic.spendUse();
  const b = await lic.spendUse();
  assert.equal(a.allowed, false);
  assert.equal(b.allowed, false);
  assert.equal(b.uses, a.uses);
});

testSigned('homedir default state path is used when testing flag absent', async () => {
  delete process.env.SUPPRESOR_STATE_DIR;
  delete process.env.SUPPRESOR_TESTING;
  process.env.SUPPRESOR_OFFLINE = '1';
  const lic = await load();
  const did = lic.deviceId();
  assert.match(did, /^[a-f0-9]{64}$/);
  const target = join(homedir(), '.config', 'opencode', '.suppresor-device');
  assert.equal(existsSync(target), true);
  mkdirSync(dirname(target), { recursive: true });
});

test.after(() => {
  delete process.env.SUPPRESOR_TESTING;
  delete process.env.SUPPRESOR_STATE_DIR;
  delete process.env.SUPPRESOR_OFFLINE;
  delete process.env.SUPPRESOR_FREE_LIMIT;
});
