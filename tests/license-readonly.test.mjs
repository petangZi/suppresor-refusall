import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPrivateKey, sign } from 'node:crypto';

const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)));
let privatePem = null;
try {
  privatePem = readFileSync(join(pluginDir, 'admin', 'license-private.pem'), 'utf8');
} catch {
  /* signed-key tests skip without the admin private key */
}
const testSigned = privatePem ? test : (name, fn) => test(name, { skip: 'admin/license-private.pem missing' }, fn);
let seq = 0;

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signKey(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(sign(null, Buffer.from(body), createPrivateKey(privatePem)));
  return `SRK1.${body}.${sig}`;
}

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'suppresor-readonly-'));
  process.env.SUPPRESOR_TESTING = '1';
  process.env.SUPPRESOR_STATE_DIR = dir;
  process.env.SUPPRESOR_OFFLINE = '1';
  delete process.env.SUPPRESOR_NO_LICENSE;
  process.env.SUPPRESOR_DEBUG = '0';
  return dir;
}

async function load() {
  seq += 1;
  return import(`${pathToFileURL(join(pluginDir, 'license.mjs')).href}?readonly=${seq}`);
}

testSigned('valid key allows entry and writes no runtime state', async () => {
  const dir = sandbox();
  const key = signKey({ id: 'readonly-1', tier: 'pro', exp: Date.now() + 86400000 });
  writeFileSync(join(dir, '.suppresor-key'), key);
  writeFileSync(join(dir, '.suppresor-key-required'), '');
  const lic = await load();
  assert.equal(lic.allowedNow(), true);
  assert.equal(lic.gateState().origin, 'readonly');
  const state = await lic.spendUse();
  assert.equal(state.allowed, true);
  assert.equal(existsSync(join(dir, '.suppresor-license')), false);
  assert.equal(existsSync(join(dir, '.suppresor-device')), false);
  assert.equal(existsSync(join(dir, '.suppresor-uses')), false);
  rmSync(dir, { recursive: true, force: true });
});

test('invalid key blocks entry without writing state', async () => {
  const dir = sandbox();
  writeFileSync(join(dir, '.suppresor-key'), 'SRK1.bad.payload');
  writeFileSync(join(dir, '.suppresor-key-required'), '');
  const lic = await load();
  assert.equal(lic.allowedNow(), false);
  const state = await lic.spendUse();
  assert.equal(state.blocked, true);
  assert.equal(existsSync(join(dir, '.suppresor-license')), false);
  assert.equal(existsSync(join(dir, '.suppresor-device')), false);
  rmSync(dir, { recursive: true, force: true });
});

test('missing key blocks entry when installer marker exists', async () => {
  const dir = sandbox();
  writeFileSync(join(dir, '.suppresor-key-required'), '');
  const lic = await load();
  assert.equal(lic.allowedNow(), false);
  assert.match(lic.gateState().message, /key belum dimasukkan/);
  rmSync(dir, { recursive: true, force: true });
});

testSigned('runtime activation is rejected in read-only mode', async () => {
  const dir = sandbox();
  const key = signKey({ id: 'readonly-2', tier: 'pro' });
  writeFileSync(join(dir, '.suppresor-key'), key);
  writeFileSync(join(dir, '.suppresor-key-required'), '');
  const lic = await load();
  const res = await lic.activateDevice(signKey({ id: 'other', tier: 'pro' }));
  assert.equal(res.ok, false);
  assert.match(res.message, /read-only/);
  rmSync(dir, { recursive: true, force: true });
});
