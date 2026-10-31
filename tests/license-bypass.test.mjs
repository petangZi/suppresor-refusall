// SUPPRESOR_NO_LICENSE bypasses entitlement without touching counters.

process.env.SUPPRESOR_TESTING = '1';
process.env.SUPPRESOR_NO_LICENSE = '1';
process.env.SUPPRESOR_STATE_DIR = `${process.env.TMPDIR || '/tmp'}/suppresor-bypass-${process.pid}`;

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

mkdirSync(process.env.SUPPRESOR_STATE_DIR, { recursive: true });
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lic = await import(`${pathToFileURL(join(root, 'license.mjs')).href}?b=${Date.now()}`);

test('spendUse allows everything without counting', async () => {
  for (let i = 0; i < 5; i += 1) {
    const state = await lic.spendUse();
    assert.equal(state.allowed, true);
    assert.equal(state.origin, 'bypass');
    assert.equal(state.uses, 0);
  }
  assert.equal(existsSync(join(process.env.SUPPRESOR_STATE_DIR, '.suppresor-uses')), false);
});

test('activation is a no-op success', async () => {
  const result = await lic.activateDevice('TTK-ANY-KEY');
  assert.equal(result.ok, true);
  assert.equal(result.tier, 'pro');
});
