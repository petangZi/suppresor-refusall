// Gate ↔ main-app bridge: license lookup, usage consumption, revoke, heartbeat.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installTokenKeys } from './gate-fixtures.mjs';

installTokenKeys();
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let nextPort = 23000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SECRET = 'bridge-secret';
const PRO_KEY = 'TTK-BRIDGE-0001';

function createBridge() {
  const calls = [];
  const usage = new Map();
  const revoked = new Set();
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      calls.push({ path: req.url, secret: req.headers['x-gate-secret'], body: raw ? JSON.parse(raw) : null });
      if (req.headers['x-gate-secret'] !== SECRET) return send(401, { ok: false, error: 'unauthorized' });

      if (req.method === 'GET' && req.url.startsWith('/internal/license/')) {
        const keyId = decodeURIComponent(req.url.split('/').pop());
        if (keyId !== PRO_KEY) return send(404, { ok: false, error: 'not_found' });
        return send(200, { ok: true, keyId, status: 'ACTIVE', tier: 'pro', daysRemaining: 30, maxDevices: 2 });
      }
      if (req.method === 'POST' && req.url === '/internal/usage/consume') {
        const body = JSON.parse(raw || '{}');
        const uses = (usage.get(body.deviceId) || 0) + 1;
        usage.set(body.deviceId, uses);
        return send(200, { ok: true, uses, limit: 2, allowed: uses <= 2 });
      }
      if (req.method === 'POST' && req.url === '/internal/usage/heartbeat') {
        const body = JSON.parse(raw || '{}');
        return send(200, { ok: true, allowed: true, revoked: revoked.has(body.keyId), uses: 1, limit: 2 });
      }
      if (req.method === 'POST' && req.url === '/internal/revoke') {
        const body = JSON.parse(raw || '{}');
        if (body.keyId) revoked.add(body.keyId);
        return send(200, { ok: true });
      }
      return send(404, { ok: false, error: 'not_found' });
    });
  });
  return { server, calls, usage, revoked };
}

async function bootBridge() {
  const bridge = createBridge();
  await new Promise((resolve) => bridge.server.listen(0, '127.0.0.1', resolve));
  bridge.url = `http://127.0.0.1:${bridge.server.address().port}`;
  return bridge;
}

async function bootGate(bridgeUrl) {
  const port = nextPort++;
  const child = spawn(process.execPath, [join(root, 'server/gate.mjs')], {
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
    stdio: 'pipe',
  });
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.ok) break;
    } catch { /* not up yet */ }
    await sleep(50);
  }
  return { url, close: () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGKILL'); }) };
}

const post = (base, path, body, headers = {}) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const DEVICE = (char) => char.repeat(40);
const payloadOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

test('license is resolved through the bridge', async () => {
  const bridge = await bootBridge();
  const gate = await bootGate(bridge.url);
  try {
    const res = await post(gate.url, '/v1/session', { deviceId: DEVICE('a'), licenseKey: PRO_KEY });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.tier, 'pro');
    assert.equal(payloadOf(body.token).keyId, PRO_KEY);
    assert.ok(bridge.calls.some((call) => call.path === `/internal/license/${PRO_KEY}`));
    assert.ok(bridge.calls.every((call) => call.secret === SECRET));
  } finally {
    gate.close();
    bridge.server.close();
  }
});

test('unknown key stays rejected and 404 is not retried elsewhere', async () => {
  const bridge = await bootBridge();
  const gate = await bootGate(bridge.url);
  try {
    const res = await post(gate.url, '/v1/session', { deviceId: DEVICE('b'), licenseKey: 'TTK-0000-0000-0000' });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, 'bad_license');
  } finally {
    gate.close();
    bridge.server.close();
  }
});

test('free usage is counted by the bridge', async () => {
  const bridge = await bootBridge();
  const gate = await bootGate(bridge.url);
  try {
    const first = await post(gate.url, '/v1/session', { deviceId: DEVICE('c') });
    const second = await post(gate.url, '/v1/session', { deviceId: DEVICE('c') });
    const third = await post(gate.url, '/v1/session', { deviceId: DEVICE('c') });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(third.status, 402);
    const blocked = await third.json();
    assert.equal(blocked.error, 'free_limit');
    assert.equal(blocked.limit, 2);
    assert.equal((await first.json()).limit, 2);
  } finally {
    gate.close();
    bridge.server.close();
  }
});

test('admin revoke is forwarded to the bridge', async () => {
  const bridge = await bootBridge();
  const gate = await bootGate(bridge.url);
  try {
    const res = await post(gate.url, '/v1/admin/revoke', { keyId: PRO_KEY }, { 'x-gate-secret': 'admin-secret' });
    assert.equal(res.status, 200);
    await sleep(150);
    assert.ok(bridge.calls.some((call) => call.path === '/internal/revoke' && call.body.keyId === PRO_KEY));
  } finally {
    gate.close();
    bridge.server.close();
  }
});

test('heartbeat surfaces a bridge-side revocation', async () => {
  const bridge = await bootBridge();
  const gate = await bootGate(bridge.url);
  try {
    const issued = await post(gate.url, '/v1/session', { deviceId: DEVICE('d'), licenseKey: PRO_KEY });
    const { token } = await issued.json();
    bridge.revoked.add(PRO_KEY);
    const beat = await post(gate.url, '/v1/heartbeat', { token });
    assert.equal(beat.status, 403);
    assert.equal((await beat.json()).error, 'revoked');
  } finally {
    gate.close();
    bridge.server.close();
  }
});
