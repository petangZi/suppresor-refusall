import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFirestoreKey, isTtkKey } from '../license-key.mjs';

test('accepts TTK, TIKI, and TKI key prefixes', () => {
  assert.equal(isTtkKey('TTK-20E5-AB7A-2673'), true);
  assert.equal(isTtkKey('TIKI-YEA-39YV-MH4J'), true);
  assert.equal(isTtkKey('TKI-6-5-7B-642G-542'), true);
  assert.equal(isTtkKey('SRK1.abc.def'), false);
});

test('evaluates the new plan schema', () => {
  const now = Date.now();
  const daily = evaluateFirestoreKey('TIKI-DAI-TEST-0001', {
    used: false,
    plan: 'daily',
    createdAt: new Date(now - 3600000).toISOString(),
  });
  assert.equal(daily.ok, true);
  assert.equal(daily.payload.plan, 'daily');

  const expired = evaluateFirestoreKey('TIKI-DAI-TEST-0002', {
    used: false,
    plan: 'daily',
    createdAt: new Date(now - 2 * 86400000).toISOString(),
  });
  assert.equal(expired.ok, false);
  assert.match(expired.reason, /expired/);

  const used = evaluateFirestoreKey('TIKI-DAI-TEST-0003', {
    used: true,
    plan: 'daily',
    createdAt: new Date(now).toISOString(),
  });
  assert.equal(used.ok, false);
  assert.match(used.reason, /sudah dipakai/);
});

test('evaluates the legacy status schema', () => {
  const ok = evaluateFirestoreKey('TTK-OLD-TEST-0001', {
    active: true,
    status: 'ACTIVE',
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(ok.ok, true);

  const expired = evaluateFirestoreKey('TTK-OLD-TEST-0002', {
    active: true,
    status: 'ACTIVE',
    expiresAt: new Date(Date.now() - 86400000).toISOString(),
  });
  assert.equal(expired.ok, false);
  assert.match(expired.reason, /expired/);
});
