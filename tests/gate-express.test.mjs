// Gate mounted inside Express: same handlers, no second process.

process.env.SUPPRESOR_GATE_NOPERSIST = '1';
process.env.SUPPRESOR_GATE_SECRET = 'admin-secret';
process.env.SUPPRESOR_GATE_FIRESTORE = '0';
process.env.SUPPRESOR_FREE_LIMIT = '2';
process.env.SUPPRESOR_GATE_IP_RATE = '100';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { installTokenKeys } from './gate-fixtures.mjs';

installTokenKeys();
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { mountGate } = await import(pathToFileURL(join(root, 'server/gate-express.mjs')).href);

const app = express();
mountGate(app, '/api/gate');
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/api/gate`;

const post = (path, body, headers = {}) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const device = (char) => char.repeat(40);

test('health responds through Express', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test('free tier is counted and blocked at the limit', async () => {
  const first = await post('/v1/session', { deviceId: device('a') });
  const second = await post('/v1/session', { deviceId: device('a') });
  const third = await post('/v1/session', { deviceId: device('a') });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(third.status, 402);
  assert.equal((await third.json()).limit, 2);
});

test('oversized payload is rejected before parsing', async () => {
  const big = 'x'.repeat(1024 * 1024 + 512);
  const res = await post('/v1/session', JSON.stringify({ deviceId: device('b'), blob: big }));
  assert.equal(res.status, 413);
});

test('admin secret is required and compared safely', async () => {
  const wrong = await post('/v1/admin/revoke', { keyId: 'TTK-X' }, { 'x-gate-secret': 'nope' });
  const right = await post('/v1/admin/revoke', { keyId: 'TTK-X' }, { 'x-gate-secret': 'admin-secret' });
  assert.equal(wrong.status, 403);
  assert.equal(right.status, 200);
});

test.after(() => server.close());
