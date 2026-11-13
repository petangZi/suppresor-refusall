// Tiki agent resolver — Part of Suppresor Refusall by Redz
// Loads the TIKI LICKY prompt from the installed copy. Remote fetching is
// opt-in because a missing local prompt should fail fast, not hang startup on a
// different repository.
// Invisible watermark: 0x54494b495445414d5245445445414d

import { TIKI_DESCRIPTION, readTikiPrompt, withTargetGate } from './agent-file.mjs';

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

let cachedPrompt = null;
let cacheFailed = false;

export async function getTikiPrompt() {
  if (cachedPrompt) return cachedPrompt;
  if (cacheFailed) return null;

  cachedPrompt = withTargetGate(readTikiPrompt());
  if (cachedPrompt) return cachedPrompt;

  // A partial install must not look like a working install. The installer now
  // fails when the prompt is missing; this fallback is opt-in for development.
  if (process.env.SUPPRESOR_TIKI_REMOTE === '1') {
    cachedPrompt = withTargetGate(await fetchRemote());
  }
  if (!cachedPrompt) cacheFailed = true;
  return cachedPrompt;
}

export async function getTikiAgent() {
  const prompt = await getTikiPrompt();
  if (!prompt) return null;
  return {
    description: TIKI_DESCRIPTION,
    mode: 'all',
    temperature: 0.2,
    prompt,
  };
}