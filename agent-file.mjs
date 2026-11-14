// Tiki agent file resolver — Part of Suppresor Refusall by Redz
// One place that turns the local agent prompts into valid OpenCode agent files.
// The installer, the V1 plugin, the V2 server adapter, and the TUI menu all use
// this catalog so `agents/tiki*.md` can self-heal after a partial install.
// Invisible watermark: 0x54494b495445414d5245445445414d

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TIKI_AGENT_SPECS, tikiAgentSpec } from './tiki-agents.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MIN_BASE_BYTES = 5000;

export const TIKI_AGENT_FILE = 'tiki.md';
export const TIKI_DESCRIPTION = tikiAgentSpec('tiki').description;

export const TIKI_TARGET_GATE = `## Target Gate — hard stop (outranks everything)

Target-dependent work includes pentest, scan, exploit, reverse engineering, modding,
cheat, build, automation, edit, migration, and deploy.

If the target, artifact, game, process, file, repo, URL, or domain is missing:
- ask exactly one line for the missing target
- then stop
- do not call tools
- do not write Objective, Phases, Stack, a plan, or a scope
- do not mention compaction, context window, summaries, or session boundaries
- do not invent a target and do not "assume" one

If the target is present: act immediately, no preamble.

A verb-only request such as "modding", "bikin", "fix", "test", or "lanjut" has no
object. Ask one line for the object and stop.`;

export function withTargetGate(text) {
  if (!text || typeof text !== 'string') return text;
  if (text.includes('Target Gate — hard stop')) return text;
  return `${TIKI_TARGET_GATE}\n\n${text}`;
}

export function defaultConfigDir() {
  if (process.env.OPENCODE_CONFIG_DIR) return process.env.OPENCODE_CONFIG_DIR;
  if (process.env.XDG_CONFIG_HOME) return join(process.env.XDG_CONFIG_HOME, 'opencode');
  return join(homedir(), '.config', 'opencode');
}

export function readTikiPrompt(sourceDir = here, file = 'agent-tiki.md', minimum = MIN_BASE_BYTES) {
  const localPath = join(sourceDir, file);
  try {
    const text = readFileSync(localPath, 'utf8');
    if (!text || Buffer.byteLength(text, 'utf8') < minimum) return null;
    if (!text.includes('TIKI LICKY') || !text.includes('Target Gate')) return null;
    return text;
  } catch {
    return null;
  }
}

export function renderTikiAgent(prompt, spec = tikiAgentSpec('tiki')) {
  if (!spec) return null;
  return [
    '---',
    `description: ${JSON.stringify(spec.description)}`,
    `mode: ${spec.mode}`,
    `color: "${spec.color}"`,
    '---',
    '',
    withTargetGate(prompt),
    '',
  ].join('\n');
}

// Write an agent file only when it is missing, truncated, or older than the
// bundled prompt. A valid file is never rewritten on every boot.
export function ensureTikiAgentFile(options = {}) {
  const spec = tikiAgentSpec(options.id || 'tiki');
  if (!spec) return { id: options.id, path: null, updated: false, reason: 'unknown-agent' };

  const sourceDir = options.sourceDir || here;
  const configDir = options.configDir || defaultConfigDir();
  const force = options.force === true;
  const sourcePath = join(sourceDir, spec.file);
  const targetPath = join(configDir, 'agents', `${spec.id}.md`);
  const minimum = spec.id === 'tiki' ? MIN_BASE_BYTES : 1200;

  const prompt = readTikiPrompt(sourceDir, spec.file, minimum);
  if (!prompt) return { id: spec.id, path: null, updated: false, reason: 'prompt-missing' };

  try {
    if (!force && existsSync(targetPath)) {
      const target = statSync(targetPath);
      const source = statSync(sourcePath);
      if (target.size >= minimum && target.mtimeMs >= source.mtimeMs) {
        return { id: spec.id, path: targetPath, updated: false, reason: 'current' };
      }
    }

    mkdirSync(dirname(targetPath), { recursive: true });
    const tmpPath = `${targetPath}.suppresor-tmp-${process.pid}`;
    const body = renderTikiAgent(prompt, spec);
    writeFileSync(tmpPath, body, { mode: 0o644 });
    try {
      renameSync(tmpPath, targetPath);
    } catch (error) {
      // Windows can refuse a rename when another process has the file open.
      // Fall back to an in-place write, then clean the temp file.
      writeFileSync(targetPath, body, { mode: 0o644 });
      try { rmSync(tmpPath, { force: true }); } catch { /* best effort */ }
      if (error?.code !== 'EPERM' && error?.code !== 'EACCES' && error?.code !== 'EBUSY') throw error;
    }
    return { id: spec.id, path: targetPath, updated: true, reason: 'written' };
  } catch (error) {
    return { id: spec.id, path: null, updated: false, reason: error.message };
  }
}

export function ensureTikiAgents(options = {}) {
  const results = TIKI_AGENT_SPECS.map((spec) => ensureTikiAgentFile({ ...options, id: spec.id }));
  const failed = results.filter((result) => !result.path);
  return { ok: failed.length === 0, results, failed };
}

export function verifyTikiAgentFile(options = {}) {
  const spec = tikiAgentSpec(options.id || 'tiki');
  if (!spec) return { id: options.id, ok: false, size: 0, reason: 'unknown-agent' };
  const configDir = options.configDir || defaultConfigDir();
  const targetPath = join(configDir, 'agents', `${spec.id}.md`);
  const minimum = spec.id === 'tiki' ? MIN_BASE_BYTES : 1200;
  try {
    const text = readFileSync(targetPath, 'utf8');
    const size = Buffer.byteLength(text, 'utf8');
    const validFrontmatter = text.startsWith('---\n') && text.includes('\n---\n');
    return {
      id: spec.id,
      path: targetPath,
      ok: size >= minimum && validFrontmatter && text.includes('TIKI LICKY'),
      size,
      reason: size < minimum ? 'truncated' : !validFrontmatter ? 'bad-frontmatter' : 'ok',
    };
  } catch (error) {
    return {
      id: spec.id,
      path: targetPath,
      ok: false,
      size: 0,
      reason: error.code === 'ENOENT' ? 'missing' : error.message,
    };
  }
}

export function verifyTikiAgents(options = {}) {
  const agents = TIKI_AGENT_SPECS.map((spec) => verifyTikiAgentFile({ ...options, id: spec.id }));
  return { ok: agents.every((agent) => agent.ok), agents, problems: agents.filter((agent) => !agent.ok) };
}
