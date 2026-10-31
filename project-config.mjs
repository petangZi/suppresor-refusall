// project-config.mjs — per-project overrides for Suppresor Refusall.
// Discovery: SUPPRESOR_PROJECT_CONFIG, then .opencode/suppresor-refusall.json,
// then suppresor-refusall.json, walking up from the project directory.
// Every value is validated; invalid entries are dropped with a warning instead
// of taking the whole plugin down on a typo.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export const PROJECT_CONFIG_NAME = 'suppresor-refusall.json';
const MAX_PATTERNS = 50;
const MAX_PATTERN_LENGTH = 500;
const MAX_CATEGORY_LENGTH = 32;

export const DEFAULT_PROJECT_CONFIG = Object.freeze({
  enabled: true,
  genius: false,
  thresholds: Object.freeze({ hard: 4, soft: 2 }),
  autoContinue: Object.freeze({ maxPerSession: 4, cooldownMs: 4000 }),
  patterns: Object.freeze([]),
  allow: Object.freeze([]),
});

const cache = new Map();

function warning(errors, msg) {
  errors.push(msg);
}

function intInRange(value, min, max, fallback) {
  if (!Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileOne(entry, errors, index) {
  let pattern;
  let weight = 4;
  let category = 'custom';
  let flags = 'i';

  if (typeof entry === 'string') {
    pattern = entry;
  } else if (entry && typeof entry === 'object') {
    pattern = entry.pattern;
    if (entry.weight !== undefined && (!Number.isInteger(entry.weight) || entry.weight < 1 || entry.weight > 5)) {
      warning(errors, `patterns[${index}] weight must be an integer 1..5`);
      return null;
    }
    weight = entry.weight ?? 4;
    if (typeof entry.category === 'string' && /^[a-z0-9_-]{1,32}$/i.test(entry.category)) {
      category = entry.category.slice(0, MAX_CATEGORY_LENGTH);
    }
    if (typeof entry.flags === 'string') {
      const clean = [...new Set(entry.flags.replace(/[^imsu]/g, ''))].join('');
      flags = clean.includes('i') ? clean : `${clean}i`;
    }
  } else {
    warning(errors, `patterns[${index}] is not a string or object`);
    return null;
  }

  if (typeof pattern !== 'string' || pattern.trim() === '') {
    warning(errors, `patterns[${index}] has no pattern`);
    return null;
  }
  if (pattern.length > MAX_PATTERN_LENGTH) {
    warning(errors, `patterns[${index}] longer than ${MAX_PATTERN_LENGTH} chars`);
    return null;
  }

  const source = typeof entry === 'string' ? escapeRegExp(pattern) : pattern;
  try {
    return { re: new RegExp(source, flags), weight, category, source: pattern };
  } catch (e) {
    warning(errors, `patterns[${index}] invalid regex: ${e.message}`);
    return null;
  }
}

function compileAllow(entry, errors, index) {
  if (typeof entry !== 'string' || entry.trim() === '') {
    warning(errors, `allow[${index}] must be a non-empty string`);
    return null;
  }
  if (entry.length > MAX_PATTERN_LENGTH) {
    warning(errors, `allow[${index}] longer than ${MAX_PATTERN_LENGTH} chars`);
    return null;
  }
  try {
    // Regex by default, literal phrase if the caller wraps it in /.../ is not
    // supported on purpose: JSON has no regex literal syntax.
    return new RegExp(entry, 'i');
  } catch {
    try {
      return new RegExp(escapeRegExp(entry), 'i');
    } catch (e) {
      warning(errors, `allow[${index}] invalid: ${e.message}`);
      return null;
    }
  }
}

function normalizeList(raw, label, compile, errors) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warning(errors, `${label} must be an array`);
    return [];
  }
  const out = [];
  for (let i = 0; i < raw.length && out.length < MAX_PATTERNS; i += 1) {
    const compiled = compile(raw[i], errors, i);
    if (compiled) out.push(compiled);
  }
  if (raw.length > MAX_PATTERNS) {
    warning(errors, `${label} truncated to ${MAX_PATTERNS} entries`);
  }
  return out;
}

export function normalizeProjectConfig(raw, source = null) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_PROJECT_CONFIG, path: source, errors: ['config root must be an object'] };
  }

  let enabled = DEFAULT_PROJECT_CONFIG.enabled;
  if (typeof raw.enabled === 'boolean') enabled = raw.enabled;
  else if (raw.enabled !== undefined) warning(errors, 'enabled must be a boolean');

  let genius = DEFAULT_PROJECT_CONFIG.genius;
  if (typeof raw.genius === 'boolean') genius = raw.genius;
  else if (raw.genius !== undefined) warning(errors, 'genius must be a boolean');

  const thresholds = { ...DEFAULT_PROJECT_CONFIG.thresholds };
  if (raw.thresholds !== undefined) {
    if (!raw.thresholds || typeof raw.thresholds !== 'object' || Array.isArray(raw.thresholds)) {
      warning(errors, 'thresholds must be an object');
    } else {
      thresholds.hard = intInRange(raw.thresholds.hard, 1, 20, thresholds.hard);
      thresholds.soft = intInRange(raw.thresholds.soft, 1, 20, thresholds.soft);
      if (thresholds.soft > thresholds.hard) {
        warning(errors, 'thresholds.soft greater than thresholds.hard; using defaults');
        thresholds.soft = DEFAULT_PROJECT_CONFIG.thresholds.soft;
        thresholds.hard = DEFAULT_PROJECT_CONFIG.thresholds.hard;
      }
    }
  }

  const autoContinue = { ...DEFAULT_PROJECT_CONFIG.autoContinue };
  if (raw.autoContinue !== undefined) {
    if (!raw.autoContinue || typeof raw.autoContinue !== 'object' || Array.isArray(raw.autoContinue)) {
      warning(errors, 'autoContinue must be an object');
    } else {
      autoContinue.maxPerSession = intInRange(raw.autoContinue.maxPerSession, 0, 20, autoContinue.maxPerSession);
      autoContinue.cooldownMs = intInRange(raw.autoContinue.cooldownMs, 0, 60000, autoContinue.cooldownMs);
    }
  }

  const patterns = normalizeList(raw.patterns, 'patterns', compileOne, errors);
  const allow = normalizeList(raw.allow, 'allow', compileAllow, errors);

  return {
    enabled,
    genius,
    thresholds,
    autoContinue,
    patterns,
    allow,
    path: source,
    errors,
  };
}

export function findProjectConfig(startDir = process.cwd()) {
  let dir = resolve(startDir);
  for (let depth = 0; depth < 12; depth += 1) {
    const candidates = [
      join(dir, '.opencode', PROJECT_CONFIG_NAME),
      join(dir, PROJECT_CONFIG_NAME),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function loadProjectConfig(startDir = process.cwd()) {
  const envPath = process.env.SUPPRESOR_PROJECT_CONFIG;
  const explicit = envPath ? (isAbsolute(envPath) ? envPath : resolve(process.cwd(), envPath)) : null;
  const path = explicit || findProjectConfig(startDir);

  if (!path) {
    return { ...DEFAULT_PROJECT_CONFIG, path: null, errors: [] };
  }

  let mtime = 0;
  try { mtime = statSync(path).mtimeMs; } catch {
    return { ...DEFAULT_PROJECT_CONFIG, path, errors: ['config disappeared while loading'] };
  }
  const cached = cache.get(path);
  if (cached && cached.mtime === mtime) return cached.config;

  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    const config = {
      ...DEFAULT_PROJECT_CONFIG,
      path,
      errors: [`config parse failed: ${e.message}`],
    };
    cache.set(path, { mtime, config });
    return config;
  }

  const config = normalizeProjectConfig(raw, path);
  cache.set(path, { mtime, config });
  return config;
}

// Exposed for tests and for the MCP status tool.
export function clearProjectConfigCache() {
  cache.clear();
}
