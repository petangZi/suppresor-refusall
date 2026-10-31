// End-to-end: Express bridge router -> gate -> session/usage/revoke/heartbeat.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createGateRouter, createMemoryStore } from './gate-router.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const SECRET = 'bridge-secret';
const KEY = 'TTK-BRIDGE-0001';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const device = (char) => char.repeat(40);

const store = createMemoryStore({ freeLimit: 2 });
store.setKey(KEY, { status: 'ACTIVE', tier: 'pro', daysRemaining: 30, maxDevices: 2 });

const app = express();
app.use(express.json());
app.use('/api', createGateRouter({ secret: SECRET, store }));
const bridge = app.listen(0, '127.0.0.1');
await new Promise((resolve) => bridge.once('listening', resolve));
const bridgeUrl = `http://127.0.0.1:${bridge.address().port}/api`;

const port = 20100 + Math.floor(Math.random() * 300);
const gate = spawn(process.execPath, [join(root, 'server/gate.mjs')], {
  env: {
    ...process.env,
    SUPPRESOR_GATE_PORT: String(port),
    SUPPRESOR_GATE_NOPERSIST: '1',
    SUPPRESOR_GATE_SECRET: 'admin-secret',
    SUPPRESOR_GATE_FIRESTORE: '0',
    SUPPRESOR_GATE_IP_RATE: '500',
    SUPPRESOR_LICENSE_API: bridgeUrl,
    SUPPRESOR_LICENSE_API_SECRET: SECRET,
    SUPPRESOR_USAGE_API: '1',
  },
  stdio: 'inherit',
});
const gateUrl = `http://127.0.0.1:${port}`;
for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    const res = await fetch(`${gateUrl}/healthz`);
    if (res.ok) break;
  } catch { /* not up yet */ }
  await sleep(50);
}

const post = (path, body, headers = {}) =>
  fetch(gateUrl + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

try {
  const pro = await post('/v1/session', { deviceId: device('a'), licenseKey: KEY });
  assert.equal(pro.status, 200);
  const proBody = await pro.json();
  assert.equal(proBody.tier, 'pro');
  console.log('PASS license via bridge');

  const unknown = await post('/v1/session', { deviceId: device('b'), licenseKey: 'TTK-0000-0000-0000' });
  assert.equal(unknown.status, 401);
  console.log('PASS unknown key rejected');

  const first = await post('/v1/session', { deviceId: device('c') });
  const second = await post('/v1/session', { deviceId: device('c') });
  const third = await post('/v1/session', { deviceId: device('c') });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(third.status, 402);
  assert.equal((await third.json()).limit, 2);
  console.log('PASS usage counted by bridge');

  const revoked = await post('/v1/admin/revoke', { keyId: KEY }, { 'x-gate-secret': 'admin-secret' });
  assert.equal(revoked.status, 200);
  for (let i = 0; i < 20 && !store.revoked.has(KEY); i += 1) await sleep(50);
  assert.equal(store.revoked.has(KEY), true);
  console.log('PASS revoke forwarded');

  const key2 = 'TTK-BRIDGE-0002';
  store.setKey(key2, { status: 'ACTIVE', tier: 'pro', daysRemaining: 30 });
  const issued = await post('/v1/session', { deviceId: device('d'), licenseKey: key2 });
  const token = (await issued.json()).token;
  store.revoked.add(key2);
  const beat = await post('/v1/heartbeat', { token });
  assert.equal(beat.status, 403);
  assert.equal((await beat.json()).error, 'revoked');
  console.log('PASS heartbeat revocation via bridge');
} finally {
  gate.kill('SIGKILL');
  bridge.close();
}
