// Tiki agent resolver — Part of Suppresor Refusall by Redz
// Loads the TIKI LICKY prompts from the installed copy. Remote fetching is
// opt-in because a missing local prompt should fail fast, not hang startup on a
// different repository.
// Invisible watermark: 0x54494b495445414d5245445445414d

import { readTikiPrompt, withTargetGate } from './agent-file.mjs';
import { TIKI_AGENT_SPECS, tikiAgentSpec } from './tiki-agents.mjs';

const RAW_URL = 'https://raw.githubusercontent.com/petangZi/BigBug/main/Agent.md';

async function fetchRemote() {
  try {
    const res = await fetch(RAW_URL, { redirect: 'follow', signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const text = await res.text();
    if (text && text.includes('TIKI LICKY') && text.includes('Selesai')) return text;
  } catch {
    // offline or blocked — no agent prompt available
  }
  return null;
}

const cache = new Map();
let remoteFailed = false;

export async function getTikiPrompt(id = 'tiki') {
  const spec = tikiAgentSpec(id);
  if (!spec) return null;
  if (cache.has(id)) return cache.get(id);

  let prompt = readTikiPrompt(undefined, spec.file, id === 'tiki' ? 5000 : 1200);
  // A partial install must not look like a working install. The installer now
  // fails when the prompt is missing; this fallback is opt-in for development.
  if (!prompt && id === 'tiki' && !remoteFailed && process.env.SUPPRESOR_TIKI_REMOTE === '1') {
    prompt = await fetchRemote();
    if (!prompt) remoteFailed = true;
  }
  const result = prompt ? withTargetGate(prompt) : null;
  cache.set(id, result);
  return result;
}

export async function getTikiAgent(id = 'tiki') {
  const spec = tikiAgentSpec(id);
  if (!spec) return null;
  const prompt = await getTikiPrompt(id);
  if (!prompt) return null;
  return {
    description: spec.description,
    mode: spec.mode,
    temperature: 0.2,
    prompt,
  };
}

export async function getTikiAgents() {
  const out = {};
  for (const spec of TIKI_AGENT_SPECS) {
    const agent = await getTikiAgent(spec.id);
    if (agent) out[spec.id] = agent;
  }
  return out;
}
