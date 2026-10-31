// Legacy TTK-* key support and per-IP throttling on the gate.
// Each case boots a real server child process so env-driven limits apply.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installTokenKeys } from './gate-fixtures.mjs';

installTokenKeys();
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bootGate(env = {}) {
  const port = 19000 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, [join(root, 'server/gate.mjs')], {
    env: {
      ...process.env,
      SUPPRESOR_GATE_PORT: String(port),
      SUPPRESOR_GATE_NOPERSIST: '1',
      SUPPRESOR_GATE_SECRET: 'test-secret',
      SUPPRESOR_GATE_FIRESTORE: '0',
      ...env,
    },
    stdio: 'pipe',
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.ok) break;
    } catch { /* not up yet */ }
    await sleep(50);
  }
  return { url, close: () => child.kill('SIGKILL') };
}

const post = (url, path, body, headers = {}) =>
  fetch(url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const DID = (ch) => ch.repeat(40);

test('admin-registered legacy key issues a pro token', async () => {
  const gate = await bootGate();
  try {
    const reg = await post(gate.url, '/v1/admin/legacy', { keyId: 'TTK-25A0-4906-4AEA', days: 30 }, { 'x-gate-secret': 'test-secret' });
    assert.equal(reg.status, 200);
    const res = await post(gate.url, '/v1/session', { deviceId: DID('a'), licenseKey: 'TTK-25A0-4906-4AEA' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.tier, 'pro');
    const payload = JSON.parse(Buffer.from(body.token.split('.')[1], 'base64url').toString());
    assert.equal(payload.keyId, 'TTK-25A0-4906-4AEA');
    assert.equal(payload.tier, 'pro');
  } finally {
    gate.close();
  }
});

test('unregistered legacy key is rejected', async () => {
  const gate = await bootGate();
  try {
    const res = await post(gate.url, '/v1/session', { deviceId: DID('b'), licenseKey: 'TTK-0000-0000-0000' });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, 'bad_license');
  } finally {
    gate.close();
  }
});

test('legacy key registration needs the admin secret', async () => {
  const gate = await bootGate();
  try {
    const res = await post(gate.url, '/v1/admin/legacy', { keyId: 'TTK-AAAA-BBBB-CCCC' });
    assert.equal(res.status, 401);
  } finally {
    gate.close();
  }
});

test('revoking a legacy key blocks new sessions', async () => {
  const gate = await bootGate();
  try {
    await post(gate.url, '/v1/admin/legacy', { keyId: 'TTK-REVO-KE01-0001' }, { 'x-gate-secret': 'test-secret' });
    const first = await post(gate.url, '/v1/session', { deviceId: DID('c'), licenseKey: 'TTK-REVO-KE01-0001' });
    assert.equal(first.status, 200);
    await post(gate.url, '/v1/admin/revoke', { keyId: 'TTK-REVO-KE01-0001' }, { 'x-gate-secret': 'test-secret' });
    const second = await post(gate.url, '/v1/session', { deviceId: DID('d'), licenseKey: 'TTK-REVO-KE01-0001' });
    assert.equal(second.status, 403);
    assert.equal((await second.json()).error, 'revoked');
  } finally {
    gate.close();
  }
});

test('device rotation is throttled per IP', async () => {
  const gate = await bootGate({ SUPPRESOR_GATE_IP_RATE: '2' });
  try {
    const one = await post(gate.url, '/v1/session', { deviceId: DID('1') });
    const two = await post(gate.url, '/v1/session', { deviceId: DID('2') });
    const three = await post(gate.url, '/v1/session', { deviceId: DID('3') });
    assert.equal(one.status, 200);
    assert.equal(two.status, 200);
    assert.equal(three.status, 429);
    assert.equal((await three.json()).error, 'ip_rate_limit');
  } finally {
    gate.close();
  }
});
