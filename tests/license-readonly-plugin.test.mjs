import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)));
const stateDir = mkdtempSync(join(tmpdir(), 'suppresor-readonly-plugin-'));
process.env.SUPPRESOR_TESTING = '1';
process.env.SUPPRESOR_STATE_DIR = stateDir;
process.env.SUPPRESOR_OFFLINE = '1';
process.env.SUPPRESOR_KEY_REQUIRED = '1';
delete process.env.SUPPRESOR_NO_LICENSE;

writeFileSync(join(stateDir, '.suppresor-key'), 'SRK1.invalid.signature');

const { default: factory } = await import(`${pathToFileURL(join(pluginDir, 'plugin.js')).href}?readonly=${Date.now()}`);

test('invalid read-only key blocks plugin entry', async () => {
  const hooks = await factory({ client: {}, directory: process.cwd() });
  assert.deepEqual(hooks, {});
  assert.equal(existsSync(join(stateDir, '.suppresor-license')), false);
  assert.equal(existsSync(join(stateDir, '.suppresor-device')), false);
});
