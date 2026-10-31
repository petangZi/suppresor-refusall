// Forwarded headers must not create fresh rate-limit buckets.

process.env.SUPPRESOR_GATE_NOPERSIST = '1';
process.env.SUPPRESOR_GATE_SECRET = 'admin-secret';
process.env.SUPPRESOR_GATE_FIRESTORE = '0';
process.env.SUPPRESOR_FREE_LIMIT = '10';
process.env.SUPPRESOR_GATE_IP_RATE = '2';

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

const session = (deviceId, forwardedFor) =>
  fetch(`${base}/v1/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': forwardedFor },
    body: JSON.stringify({ deviceId }),
  });

test('spoofed x-forwarded-for does not bypass the IP limit', async () => {
  const device = 'c'.repeat(40);
  assert.equal((await session(device, '1.1.1.1')).status, 200);
  assert.equal((await session(device, '2.2.2.2')).status, 200);
  const third = await session(device, '3.3.3.3');
  assert.equal(third.status, 429);
  assert.equal((await third.json()).error, 'ip_rate_limit');
});

test.after(() => server.close());
