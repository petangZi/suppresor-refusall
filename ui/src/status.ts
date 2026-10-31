import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const pluginDir = join(here, '..', '..');

export interface Activation {
  type?: string;
  key?: string;
  tier?: string;
  deviceId?: string;
  activatedAt?: number;
  exp?: number;
}

export interface Snapshot {
  activation?: Activation | null;
  tier?: string;
  allowed?: boolean;
  blocked?: boolean;
  origin?: string;
  uses?: number;
  usesLeft?: number;
  checkedAt?: number;
  needsSync?: boolean;
  message?: string;
}

export interface GateToken {
  tier?: string;
  exp?: number;
  uses?: number;
  limit?: number;
  sub?: string;
}

export interface GateHealth {
  ok: boolean;
  url: string | null;
  latencyMs?: number;
  ttl?: number;
  freeLimit?: number;
  error?: string;
}

export function stateDir(): string {
  if (process.env.SUPPRESOR_TESTING === '1' && process.env.SUPPRESOR_STATE_DIR) {
    return process.env.SUPPRESOR_STATE_DIR;
  }
  return join(homedir(), '.config', 'opencode');
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function readSnapshot(): Snapshot {
  return readJson<Snapshot>(join(stateDir(), '.suppresor-license')) ?? {};
}

export function readShadowUses(): number | null {
  const shadow = readJson<{ uses?: number }>(join(stateDir(), '.suppresor-uses'));
  return typeof shadow?.uses === 'number' ? shadow.uses : null;
}

export function readDeviceId(): string | null {
  try {
    const raw = readFileSync(join(stateDir(), '.suppresor-device'), 'utf8').trim();
    return /^[a-f0-9]{32,64}$/i.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function gateUrl(): string | null {
  if (process.env.SUPPRESOR_OFFLINE === '1') return null;
  const url = process.env.SUPPRESOR_GATE_URL;
  if (url === 'off' || url === '') return null;
  return (url || 'http://127.0.0.1:8787').replace(/\/+$/, '');
}

function decodeSegment(segment: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

export function readGateToken(): GateToken | null {
  const cached = readJson<{ token?: string }>(join(stateDir(), '.suppresor-gate-token.json'));
  if (!cached?.token) return null;
  const parts = cached.token.split('.');
  if (parts.length !== 3 || parts[0] !== 'GT1') return null;
  const payload = decodeSegment(parts[1]);
  if (!payload || typeof payload.exp !== 'number') return null;
  return payload as GateToken;
}

export function maskKey(activation?: Activation | null): string {
  if (!activation?.key) return 'no key';
  const parts = activation.key.split('.');
  if (parts[0] === 'SRK1' && parts[1]) {
    const payload = decodeSegment(parts[1]);
    const id = typeof payload?.id === 'string' ? payload.id : '';
    return id ? `${id.slice(0, 4)}…${id.slice(-4)}` : 'signed key';
  }
  const key = activation.key;
  return key.length > 12 ? `${key.slice(0, 8)}…${key.slice(-4)}` : key;
}

export function remainingLabel(exp?: number): string {
  if (!exp) return 'lifetime';
  const ms = exp * 1000 - Date.now();
  if (ms <= 0) return 'expired';
  const days = Math.floor(ms / 86400000);
  if (days >= 1) return `${days}d left`;
  const hours = Math.floor(ms / 3600000);
  if (hours >= 1) return `${hours}h left`;
  return `${Math.max(1, Math.floor(ms / 60000))}m left`;
}

export function ageLabel(timestamp?: number): string {
  if (!timestamp) return 'never';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export async function probeGate(): Promise<GateHealth> {
  const url = gateUrl();
  if (!url) return { ok: false, url: null, error: 'disabled' };
  const started = performance.now();
  try {
    const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2000) });
    const latencyMs = Math.round(performance.now() - started);
    if (!res.ok) return { ok: false, url, latencyMs, error: `http ${res.status}` };
    const body = (await res.json()) as { ttl?: number; freeLimit?: number };
    return { ok: true, url, latencyMs, ttl: body.ttl, freeLimit: body.freeLimit };
  } catch (error) {
    return { ok: false, url, error: error instanceof Error ? error.message : 'unreachable' };
  }
}

export async function activate(key: string): Promise<{ ok: boolean; tier?: string; message?: string }> {
  const mod = await import(pathToFileURL(join(pluginDir, 'license.mjs')).href);
  return mod.activateDevice(key);
}
