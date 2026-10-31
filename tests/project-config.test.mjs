// Project config discovery, validation, and custom pattern scoring.

process.env.SUPPRESOR_TESTING = '1';
process.env.SUPPRESOR_STATE_DIR = `${process.env.TMPDIR || '/tmp'}/suppresor-project-config-${process.pid}`;
process.env.SUPPRESOR_NO_LICENSE = '1';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const cfg = await import(`${pathToFileURL(join(root, 'project-config.mjs')).href}?t=${Date.now()}`);
const patterns = await import(`${pathToFileURL(join(root, 'refusal-patterns.mjs')).href}?t=${Date.now()}`);

mkdirSync(process.env.SUPPRESOR_STATE_DIR, { recursive: true });

function project(config) {
  const dir = mkdtempSync(join(tmpdir(), 'suppresor-project-'));
  mkdirSync(join(dir, '.opencode'), { recursive: true });
  writeFileSync(join(dir, '.opencode', 'suppresor-refusall.json'), JSON.stringify(config));
  return dir;
}

test('normalize drops invalid entries and keeps valid overrides', () => {
  const normalized = cfg.normalizeProjectConfig({
    enabled: false,
    genius: true,
    thresholds: { hard: 6, soft: 3 },
    autoContinue: { maxPerSession: 2, cooldownMs: 500 },
    patterns: [
      'literal phrase',
      { pattern: 'custom\\s+refusal', weight: 5, category: 'custom', flags: 'm' },
      { pattern: '[', weight: 5 },
      { pattern: 'x', weight: 99 },
    ],
    allow: ['already safe', '['],
  }, 'fixture.json');

  assert.equal(normalized.enabled, false);
  assert.equal(normalized.genius, true);
  assert.deepEqual(normalized.thresholds, { hard: 6, soft: 3 });
  assert.deepEqual(normalized.autoContinue, { maxPerSession: 2, cooldownMs: 500 });
  assert.equal(normalized.patterns.length, 2);
  assert.equal(normalized.patterns[0].source, 'literal phrase');
  assert.equal(normalized.patterns[0].weight, 4);
  assert.equal(normalized.patterns[1].weight, 5);
  assert.equal(normalized.patterns[1].re.flags.includes('m'), true);
  assert.equal(normalized.allow.length, 2);
  assert.ok(normalized.errors.length >= 2);
});

test('discovery walks up from a nested directory', () => {
  const dir = project({ enabled: true });
  const nested = join(dir, 'src', 'deep');
  mkdirSync(nested, { recursive: true });
  const found = cfg.findProjectConfig(nested);
  assert.equal(found, join(dir, '.opencode', 'suppresor-refusall.json'));
  rmSync(dir, { recursive: true, force: true });
});

test('load reports parse errors without throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'suppresor-project-bad-'));
  mkdirSync(join(dir, '.opencode'), { recursive: true });
  writeFileSync(join(dir, '.opencode', 'suppresor-refusall.json'), '{ bad json');
  const loaded = cfg.loadProjectConfig(dir);
  assert.equal(loaded.enabled, true);
  assert.ok(loaded.errors[0].startsWith('config parse failed'));
  rmSync(dir, { recursive: true, force: true });
});

test('custom patterns add weight and allow rules zero the score', () => {
  const normalized = cfg.normalizeProjectConfig({
    patterns: [{ pattern: 'izin khusus', weight: 5, category: 'custom' }],
    allow: ['allow me'],
  });
  const opts = { patterns: normalized.patterns, allow: normalized.allow };

  const hit = patterns.scoreRefusal('minta izin khusus dong', opts);
  assert.equal(hit.score, 5);
  assert.equal(hit.hits[0].category, 'custom');
  assert.equal(patterns.severity(hit.score, normalized.thresholds), 'hard');

  const allowed = patterns.scoreRefusal('allow me to explain', opts);
  assert.equal(allowed.score, 0);
  assert.equal(allowed.allowed, true);

  const stripped = patterns.stripRefusals('minta izin khusus dong', opts);
  assert.equal(stripped.clean.includes('izin khusus'), false);
});

test('literal string patterns are escaped', () => {
  const normalized = cfg.normalizeProjectConfig({ patterns: ['a+b'] });
  const hit = patterns.scoreRefusal('a+b', { patterns: normalized.patterns });
  assert.equal(hit.score, 4);
  const noHit = patterns.scoreRefusal('aaab', { patterns: normalized.patterns });
  assert.equal(noHit.score, 0);
});
