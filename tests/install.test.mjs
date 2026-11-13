import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const installer = join(root, 'install.mjs');

function tempConfig() {
  return mkdtempSync(join(tmpdir(), 'suppresor-install-test-'));
}

function run(configDir, args) {
  return spawnSync(process.execPath, [installer, '--config', configDir, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, OPENCODE_MAJOR: '2', NO_COLOR: '1' },
  });
}

test('installer stages a complete V2 install with agent and manifest', () => {
  const cfg = tempConfig();
  try {
    const result = run(cfg, ['--local', '--no-verify', '--key', 'TTK-TEST-0000']);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const pluginDir = join(cfg, 'plugins', 'suppresor-refusall');
    for (const file of ['plugin.js', 'server.js', 'tui.js', 'agent-file.mjs', 'mcp-server.mjs', 'agent-tiki.md']) {
      assert.ok(existsSync(join(pluginDir, file)), `${file} missing`);
      assert.ok(statSync(join(pluginDir, file)).size > 100, `${file} truncated`);
    }
    assert.ok(existsSync(join(pluginDir, '.suppresor-install.json')));
    assert.ok(existsSync(join(cfg, 'agents', 'tiki.md')));
    assert.ok(statSync(join(cfg, 'agents', 'tiki.md')).size > 5000);
    assert.ok(existsSync(join(cfg, 'commands', 'suppresor-refusall.md')));
    assert.ok(existsSync(join(cfg, 'skills', 'suppresor-refusall', 'SKILL.md')));
    assert.ok(existsSync(join(cfg, 'themes', 'suppresor-red.json')));

    const config = JSON.parse(readFileSync(join(cfg, 'opencode.jsonc'), 'utf8'));
    assert.deepEqual(config.plugins, [pluginDir]);
    assert.ok(config.mcp.servers['suppresor-refusall'].command.includes(join(pluginDir, 'mcp-server.mjs')));
    assert.equal(readFileSync(join(cfg, '.suppresor-key'), 'utf8'), 'TTK-TEST-0000');

    for (const entry of readdirSync(cfg)) {
      assert.equal(entry.startsWith('.suppresor-stage-'), false, `staging dir left: ${entry}`);
    }
  } finally {
    rmSync(cfg, { recursive: true, force: true });
  }
});

test('doctor detects a truncated tiki agent and repair restores it', () => {
  const cfg = tempConfig();
  try {
    assert.equal(run(cfg, ['--local', '--no-verify', '--key', 'TTK-TEST-0000']).status, 0);
    const agent = join(cfg, 'agents', 'tiki.md');
    writeFileSync(agent, '---\ndescription: broken\n---\n');

    const doctor = run(cfg, ['--doctor']);
    assert.notEqual(doctor.status, 0);
    assert.match(`${doctor.stdout}${doctor.stderr}`, /agents\/tiki\.md/);

    const repaired = run(cfg, ['--repair', '--local', '--no-verify']);
    assert.equal(repaired.status, 0, repaired.stderr || repaired.stdout);
    assert.ok(statSync(agent).size > 5000);
    assert.equal(run(cfg, ['--doctor']).status, 0);
  } finally {
    rmSync(cfg, { recursive: true, force: true });
  }
});

test('custom config keys and unrelated entries survive a repair', () => {
  const cfg = tempConfig();
  writeFileSync(join(cfg, 'opencode.jsonc'), JSON.stringify({
    model: 'my/provider',
    theme: 'my-theme',
    plugin: ['/other/plugin.js'],
    provider: { custom: { models: { m: {} } } },
  }));
  try {
    const first = run(cfg, ['--local', '--no-verify', '--key', 'TTK-TEST-0000']);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const second = run(cfg, ['--repair', '--local', '--no-verify']);
    assert.equal(second.status, 0, second.stderr || second.stdout);

    const config = JSON.parse(readFileSync(join(cfg, 'opencode.jsonc'), 'utf8'));
    assert.equal(config.model, 'my/provider');
    assert.equal(config.provider.custom.models.m !== undefined, true);
    assert.ok(config.plugin.includes('/other/plugin.js'));
    assert.ok(config.plugins.includes(join(cfg, 'plugins', 'suppresor-refusall')));
  } finally {
    rmSync(cfg, { recursive: true, force: true });
  }
});
