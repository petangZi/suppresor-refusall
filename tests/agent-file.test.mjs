import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ensureTikiAgentFile, verifyTikiAgentFile } from '../agent-file.mjs';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'suppresor-agent-file-'));
}

test('agent file is written with valid frontmatter and the target gate', () => {
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
    const check = verifyTikiAgentFile({ configDir });
    assert.equal(check.ok, true);
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
});

test('a valid agent file is left in place on the next boot', () => {
  const configDir = tempDir();
  try {
    const first = ensureTikiAgentFile({ configDir, force: true });
    assert.ok(first.path, first.reason);
    const second = ensureTikiAgentFile({ configDir });
    assert.equal(second.path, first.path);
    assert.equal(second.updated, false);
    assert.equal(second.reason, 'current');
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
});

test('a truncated agent file is repaired instead of skipped', () => {
  const configDir = tempDir();
  try {
    const target = join(configDir, 'agents', 'tiki.md');
    ensureTikiAgentFile({ configDir, force: true });
    writeFileSync(target, '---\ndescription: broken\n---\n');
    const before = verifyTikiAgentFile({ configDir });
    assert.equal(before.ok, false);
    const repaired = ensureTikiAgentFile({ configDir });
    assert.equal(repaired.updated, true);
    const after = verifyTikiAgentFile({ configDir });
    assert.equal(after.ok, true);
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
});
