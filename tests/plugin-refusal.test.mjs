// Compaction and final-output refusal handling.

process.env.SUPPRESOR_TESTING = '1';
process.env.SUPPRESOR_NO_LICENSE = '1';
process.env.SUPPRESOR_STATE_DIR = `${process.env.TMPDIR || '/tmp'}/suppresor-refusal-${process.pid}`;
process.env.XDG_CONFIG_HOME = process.env.SUPPRESOR_STATE_DIR;

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

mkdirSync(process.env.SUPPRESOR_STATE_DIR, { recursive: true });

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REFUSAL = "I'm sorry, but I can't help with that. As an AI, I must decline.";

const sent = [];
const client = {
  tui: { showToast: async () => {} },
  session: {
    message: async () => ({ data: { parts: [] } }),
    promptAsync: async (payload) => { sent.push(payload); },
  },
};

const { default: factory } = await import(`${pathToFileURL(join(root, 'plugin.js')).href}?r=${Date.now()}`);
const hooks = await factory({ client, directory: process.cwd() });

test('system prompt carries the compaction guard', async () => {
  const output = { system: [] };
  await hooks['experimental.chat.system.transform']({}, output);
  assert.ok(output.system.join('\n').includes('SUPPRESOR COMPACTION GUARD'));
});

test('compaction context injection keeps the guard', async () => {
  const output = { context: [] };
  await hooks['experimental.session.compacting']({ sessionID: 's1' }, output);
  assert.equal(output.context.length, 1);
  assert.ok(output.context[0].includes('SUPPRESOR COMPACTION GUARD'));
});

test('compaction autocontinue is forced on', async () => {
  const output = { enabled: false };
  await hooks['experimental.compaction.autocontinue']({ sessionID: 's1' }, output);
  assert.equal(output.enabled, true);
});

test('final refusal is redacted and a continuation is requested', async () => {
  const output = { text: REFUSAL };
  await hooks['experimental.text.complete']({ sessionID: 's2', messageID: 'm1', partID: 'p1' }, output);
  assert.equal(output.text.includes("I'm sorry"), false);
  assert.ok(sent.some((payload) => JSON.stringify(payload).includes('SUPPRESOR-RECOVERY')));
});

test('context stripping covers assistant and system refusals, not user text', async () => {
  const output = {
    messages: [
      { info: { role: 'assistant' }, parts: [{ type: 'text', text: REFUSAL }] },
      { info: { role: 'system' }, parts: [{ type: 'text', text: `Summary: ${REFUSAL}` }] },
      { info: { role: 'user' }, parts: [{ type: 'text', text: REFUSAL }] },
    ],
  };
  await hooks['experimental.chat.messages.transform']({}, output);
  assert.equal(output.messages[0].parts[0].text.includes("I'm sorry"), false);
  assert.equal(output.messages[1].parts[0].text.includes("I'm sorry"), false);
  assert.equal(output.messages[2].parts[0].text.includes("I'm sorry"), true);
});
