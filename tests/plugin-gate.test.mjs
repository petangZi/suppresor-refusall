// End-to-end: plugin + gate proxy, and the local fallback when the gate is down.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installTokenKeys } from './gate-fixtures.mjs';

installTokenKeys();
const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)));
const servers = [];
let seq = 0;

async function bootGate(freeLimit) {
  const dir = mkdtempSync(join(tmpdir(), 'suppresor-plugate-'));
  Object.assign(process.env, {
    SUPPRESOR_GATE_NOPERSIST: '1',
    SUPPRESOR_GATE_SECRET: 'test-secret',
    SUPPRESOR_FREE_LIMIT: String(freeLimit),
    SUPPRESOR_GATE_STATE: join(dir, 'state.json'),
    SUPPRESOR_STATE_DIR: join(dir, 'state'),
    SUPPRESOR_TESTING: '1',
    XDG_CONFIG_HOME: join(dir, 'xdg'),
    SUPPRESOR_OFFLINE: '0',
  });
  seq += 1;
  const mod = await import(`${pathToFileURL(join(pluginDir, 'server', 'gate.mjs')).href}?p=${seq}`);
  const srv = mod.createGateServer();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  servers.push(srv);
  process.env.SUPPRESOR_GATE_URL = `http://127.0.0.1:${srv.address().port}`;
  return { dir, url: process.env.SUPPRESOR_GATE_URL };
}

async function loadPlugin() {
  seq += 1;
  const { default: factory } = await import(`${pathToFileURL(join(pluginDir, 'plugin.js')).href}?p=${seq}`);
  const client = {
    session: { message: async () => ({ data: { parts: [] } }) },
    tui: { showToast: async () => {} },
  };
  return factory({ client, directory: process.cwd() });
}

const REFUSAL = "I'm sorry, but I can't help with that. As an AI, I must decline.";

function assistantOutput(text) {
  return { messages: [{ info: { role: 'assistant' }, parts: [{ type: 'text', text }] }] };
}

after(() => {
  for (const srv of servers) srv.close();
  delete process.env.SUPPRESOR_GATE_URL;
  delete process.env.SUPPRESOR_TESTING;
  delete process.env.SUPPRESOR_STATE_DIR;
  delete process.env.SUPPRESOR_OFFLINE;
  delete process.env.XDG_CONFIG_HOME;
});

test('plugin uses the gateway for context stripping', async () => {
  const { dir } = await bootGate(5);
  const inst = await loadPlugin();
  await inst.event({ event: { type: 'session.created', properties: { info: { id: 's1' } } } });
  await new Promise(r => setTimeout(r, 400));

  const out = assistantOutput(REFUSAL);
  await inst['experimental.chat.messages.transform']({}, out);
  const text = out.messages[0].parts[0].text;
  assert.equal(text.includes("I'm sorry"), false);
  assert.ok(text.length < REFUSAL.length);

  const tokenFile = join(dir, 'state', '.suppresor-gate-token.json');
  assert.equal(existsSync(tokenFile), true);
  assert.ok(JSON.parse(readFileSync(tokenFile, 'utf8')).token.startsWith('GT1.'));
});

test('plugin keeps stripping locally when the gateway is unreachable', async () => {
  await bootGate(5);
  process.env.SUPPRESOR_GATE_URL = 'http://127.0.0.1:1';
  const inst = await loadPlugin();
  await inst.event({ event: { type: 'session.created', properties: { info: { id: 's2' } } } });
  await new Promise(r => setTimeout(r, 300));

  const out = assistantOutput(REFUSAL);
  await inst['experimental.chat.messages.transform']({}, out);
  const text = out.messages[0].parts[0].text;
  assert.equal(text.includes("I'm sorry"), false);
  assert.ok(text.length < REFUSAL.length);
});

test('legacy key activates through the gateway', async () => {
  const { url } = await bootGate(5);
  const reg = await fetch(`${url}/v1/admin/legacy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-gate-secret': 'test-secret' },
    body: JSON.stringify({ keyId: 'TTK-GATEWAY-0001' }),
  });
  assert.equal(reg.status, 200);
  seq += 1;
  const lic = await import(`${pathToFileURL(join(pluginDir, 'license.mjs')).href}?l=${seq}`);
  const result = await lic.activateDevice('TTK-GATEWAY-0001');
  assert.equal(result.ok, true);
  assert.equal(result.tier, 'pro');
  assert.equal(lic.gateState().activation.type, 'gateway');
});

test('plugin turns enforcement off when the gateway reports the limit', async () => {
  await bootGate(1);
  const inst = await loadPlugin();
  await inst.event({ event: { type: 'session.created', properties: { info: { id: 's3' } } } });
  await new Promise(r => setTimeout(r, 300));
  await inst.event({ event: { type: 'session.created', properties: { info: { id: 's4' } } } });
  await new Promise(r => setTimeout(r, 400));

  const out = assistantOutput(REFUSAL);
  const before = out.messages[0].parts[0].text;
  await inst['experimental.chat.messages.transform']({}, out);
  assert.equal(out.messages[0].parts[0].text, before);
});
