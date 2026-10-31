// Gate ↔ AI Studio bridge endpoints (/api/internal/bridge/keys...).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installTokenKeys } from './gate-fixtures.mjs';

installTokenKeys();
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let nextPort = 22000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const BRIDGE_KEY = 'master-bridge-key';
const DEVICE = (char) => char.repeat(40);

function createBridge(keys) {
  const calls = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      calls.push({ method: req.method, path: req.url, apiKey: req.headers['x-internal-api-key'] });
      if (req.headers['x-internal-api-key'] !== BRIDGE_KEY) return send(401, { success: false, error: 'INVALID_BRIDGE_KEY' });

      const keyMatch = req.url.match(/\/keys\/([^/]+)(\/uses)?$/);
      if (!keyMatch) return send(404, { success: false, error: 'NOT_FOUND' });
      const keyId = decodeURIComponent(keyMatch[1]);
      const record = keys.get(keyId);
      if (!record) return send(404, { success: false, error: 'KEY_NOT_FOUND' });

      if (req.method === 'POST' && keyMatch[2] === '/uses') {
        const body = JSON.parse(raw || '{}');
        record.uses += Number(body.count || 1);
        if (body.deviceId && !record.devices.includes(body.deviceId)) record.devices.push(body.deviceId);
        return send(200, { success: true, key: record });
      }
      if (req.method === 'GET') return send(200, { success: true, key: record });
      return send(405, { success: false, error: 'METHOD_NOT_ALLOWED' });
    });
  });
  return { server, calls, keys };
}

async function bootBridge(keys) {
  const bridge = createBridge(keys);
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
      SUPPRESOR_BRIDGE_URL: bridgeUrl,
      SUPPRESOR_BRIDGE_KEY: BRIDGE_KEY,
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

const payloadOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

function proKey(overrides = {}) {
  return {
    id: 'TTK-ROOT-0001',
    status: 'ACTIVE',
    tier: 'ROOT',
    permissions: ['ROOT', 'SUPER_ADMIN', 'ALL_PERMISSIONS'],
    maxDevices: 2,
    maxUses: 10,
    uses: 0,
    daysRemaining: -1,
    expiresAt: null,
    devices: [],
    ...overrides,
  };
}

test('root key is resolved through the bridge and usage is recorded', async () => {
  const keys = new Map([['TTK-ROOT-0001', proKey()]]);
  const bridge = await bootBridge(keys);
  const gate = await bootGate(`${bridge.url}/api/internal/bridge`);
  try {
    const res = await post(gate.url, '/v1/session', { deviceId: DEVICE('a'), licenseKey: 'TTK-ROOT-0001' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.tier, 'root');
    assert.equal(payloadOf(body.token).keyId, 'TTK-ROOT-0001');
    assert.equal(keys.get('TTK-ROOT-0001').uses, 1);
    assert.ok(bridge.calls.some((call) => call.method === 'POST' && call.path.endsWith('/keys/TTK-ROOT-0001/uses')));
    assert.ok(bridge.calls.every((call) => call.apiKey === BRIDGE_KEY));
  } finally {
    gate.close();
    bridge.server.close();
  }
});

test('license verify resolves without recording usage', async () => {
  const keys = new Map([['TTK-ROOT-0001', proKey()]]);
  const bridge = await bootBridge(keys);
  const gate = await bootGate(`${bridge.url}/api/internal/bridge`);
  try {
    const res = await post(gate.url, '/v1/license/verify', { key: 'TTK-ROOT-0001' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.tier, 'root');
    assert.equal(keys.get('TTK-ROOT-0001').uses, 0);
    assert.equal(bridge.calls.some((call) => call.method === 'POST'), false);
  } finally {
    await gate.close();
    bridge.server.close();
  }
});

test('unknown key from the bridge is rejected', async () => {
  const bridge = await bootBridge(new Map());
  const gate = await bootGate(`${bridge.url}/api/internal/bridge`);
  try {
    const res = await post(gate.url, '/v1/session', { deviceId: DEVICE('b'), licenseKey: 'TTK-NOPE-0001' });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, 'bad_license');
  } finally {
    gate.close();
    bridge.server.close();
  }
});

test('maxUses quota from the bridge blocks the session', async () => {
  const keys = new Map([['TTK-ROOT-0002', proKey({ id: 'TTK-ROOT-0002', maxUses: 2 })]]);
  const bridge = await bootBridge(keys);
  const gate = await bootGate(`${bridge.url}/api/internal/bridge`);
  try {
    const first = await post(gate.url, '/v1/session', { deviceId: DEVICE('c'), licenseKey: 'TTK-ROOT-0002' });
    const second = await post(gate.url, '/v1/session', { deviceId: DEVICE('c'), licenseKey: 'TTK-ROOT-0002' });
    const third = await post(gate.url, '/v1/session', { deviceId: DEVICE('c'), licenseKey: 'TTK-ROOT-0002' });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(third.status, 403);
    assert.equal((await third.json()).error, 'quota_exceeded');
  } finally {
    gate.close();
    bridge.server.close();
  }
});

test('revocation on the bridge surfaces in heartbeat', async () => {
  const keys = new Map([['TTK-ROOT-0003', proKey({ id: 'TTK-ROOT-0003' })]]);
  const bridge = await bootBridge(keys);
  const gate = await bootGate(`${bridge.url}/api/internal/bridge`);
  try {
    const issued = await post(gate.url, '/v1/session', { deviceId: DEVICE('d'), licenseKey: 'TTK-ROOT-0003' });
    const issuedBody = await issued.json();
    assert.equal(issued.status, 200, JSON.stringify(issuedBody));
    const token = issuedBody.token;
    assert.ok(token);
    keys.get('TTK-ROOT-0003').status = 'REVOKED';
    const beat = await post(gate.url, '/v1/heartbeat', { token });
    assert.equal(beat.status, 403);
    assert.equal((await beat.json()).error, 'revoked');
  } finally {
    gate.close();
    bridge.server.close();
  }
});
