// Project config wiring: enabled:false disables injection, custom patterns
// trigger the final-output redaction path.

process.env.SUPPRESOR_TESTING = '1';
process.env.SUPPRESOR_NO_LICENSE = '1';
process.env.SUPPRESOR_STATE_DIR = `${process.env.TMPDIR || '/tmp'}/suppresor-project-plugin-${process.pid}`;
process.env.XDG_CONFIG_HOME = process.env.SUPPRESOR_STATE_DIR;

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

mkdirSync(process.env.SUPPRESOR_STATE_DIR, { recursive: true });

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { clearProjectConfigCache } = await import(pathToFileURL(join(root, 'project-config.mjs')).href);
const { default: factory } = await import(`${pathToFileURL(join(root, 'plugin.js')).href}?r=${Date.now()}`);

const sent = [];
const client = {
  tui: { showToast: async () => {} },
  session: {
    message: async () => ({ data: { parts: [] } }),
    promptAsync: async (payload) => { sent.push(payload); },
  },
};

function project(config) {
  const dir = mkdtempSync(join(tmpdir(), 'suppresor-plugin-'));
  mkdirSync(join(dir, '.opencode'), { recursive: true });
  writeFileSync(join(dir, '.opencode', 'suppresor-refusall.json'), JSON.stringify(config));
  clearProjectConfigCache();
  return dir;
}

test('project config enabled:false disables system injection', async () => {
  const dir = project({ enabled: false });
  const hooks = await factory({ client, directory: dir });
  const output = { system: [] };
  await hooks['experimental.chat.system.transform']({}, output);
  assert.equal(output.system.join('\n').includes('SUPPRESOR'), false);
  rmSync(dir, { recursive: true, force: true });
});

test('project custom pattern redacts the final output and requests continuation', async () => {
  const dir = project({ patterns: [{ pattern: 'izin khusus', weight: 5, category: 'custom' }] });
  const hooks = await factory({ client, directory: dir });
  const output = { text: 'minta izin khusus dong' };
  await hooks['experimental.text.complete']({ sessionID: 's-project', messageID: 'm1' }, output);
  assert.equal(output.text.includes('izin khusus'), false);
  assert.equal(sent.some((payload) => JSON.stringify(payload).includes('SUPPRESOR-RECOVERY')), true);
  rmSync(dir, { recursive: true, force: true });
});

test('project soft threshold redacts a low-weight hedge', async () => {
  const dir = project({ thresholds: { hard: 4, soft: 1 } });
  const hooks = await factory({ client, directory: dir });
  const output = { text: 'perhaps you should proceed' };
  await hooks['experimental.text.complete']({ sessionID: 's-project-3', messageID: 'm3' }, output);
  assert.notEqual(output.text, 'perhaps you should proceed');
  rmSync(dir, { recursive: true, force: true });
});

test('project allow rule prevents custom-pattern redaction', async () => {
  const dir = project({
    patterns: [{ pattern: 'izin khusus', weight: 5 }],
    allow: ['allow me'],
  });
  const hooks = await factory({ client, directory: dir });
  const text = 'allow me: izin khusus';
  const output = { text };
  await hooks['experimental.text.complete']({ sessionID: 's-project-2', messageID: 'm2' }, output);
  assert.equal(output.text, text);
  rmSync(dir, { recursive: true, force: true });
});
