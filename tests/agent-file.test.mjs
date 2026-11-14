import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  ensureTikiAgentFile,
  ensureTikiAgents,
  verifyTikiAgentFile,
  verifyTikiAgents,
} from '../agent-file.mjs';
import { TIKI_AGENT_SPECS, TIKI_MENU } from '../tiki-agents.mjs';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'suppresor-agent-file-'));
}

test('base agent file is written with valid frontmatter and the target gate', () => {
  const configDir = tempDir();
  try {
    const result = ensureTikiAgentFile({ configDir, force: true });
    assert.ok(result.path, result.reason);
    assert.equal(result.updated, true);
    const text = readFileSync(result.path, 'utf8');
    assert.match(text, /^---\n/);
    assert.match(text, /mode: all/);
    assert.match(text, /Target Gate — hard stop/);
    assert.match(text, /TIKI LICKY/);
    assert.ok(Buffer.byteLength(text, 'utf8') > 5000);
    assert.equal(verifyTikiAgentFile({ configDir }).ok, true);
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
});

test('all specialist agents are installed and valid', () => {
  const configDir = tempDir();
  try {
    const result = ensureTikiAgents({ configDir, force: true });
    assert.equal(result.ok, true, JSON.stringify(result.failed));
    assert.equal(result.results.length, TIKI_AGENT_SPECS.length);
    const checked = verifyTikiAgents({ configDir });
    assert.equal(checked.ok, true, JSON.stringify(checked.problems));
    for (const spec of TIKI_AGENT_SPECS) {
      const path = join(configDir, 'agents', `${spec.id}.md`);
      const text = readFileSync(path, 'utf8');
      assert.match(text, new RegExp(`mode: ${spec.mode}`));
      if (spec.id === 'tiki-prompter') {
        assert.match(text, /project_instructions/);
        assert.match(text, /Kamu adalah TIKI/);
      } else {
        assert.match(text, /TIKI LICKY/);
      }
      assert.ok(statSync(path).size > 1200);
    }
    assert.equal(TIKI_MENU.length, 4);
    assert.deepEqual(TIKI_MENU.map((item) => item.id), [
      'tiki-prompter',
      'tiki-coder',
      'tiki-architect',
      'bigtiki',
    ]);
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
});

test('a valid agent file is left in place on the next boot', () => {
  const configDir = tempDir();
  try {
    const first = ensureTikiAgents({ configDir, force: true });
    assert.equal(first.ok, true);
    const second = ensureTikiAgents({ configDir });
    assert.equal(second.ok, true);
    for (const item of second.results) {
      assert.equal(item.updated, false);
      assert.equal(item.reason, 'current');
    }
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
});

test('a truncated specialist agent is repaired instead of skipped', () => {
  const configDir = tempDir();
  try {
    const target = join(configDir, 'agents', 'tiki-coder.md');
    ensureTikiAgents({ configDir, force: true });
    writeFileSync(target, '---\ndescription: broken\n---\n');
    assert.equal(verifyTikiAgents({ configDir }).ok, false);
    const repaired = ensureTikiAgents({ configDir });
    assert.equal(repaired.ok, true);
    assert.equal(verifyTikiAgentFile({ configDir, id: 'tiki-coder' }).ok, true);
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
});
