// firestore-client.ts — Suppresor Refusall (TikiTeam) plug-and-play Firestore module, typed.
// Zero dependencies. Node >= 18. Standalone: copy into any src/ or lib/.
// The database is a named Firestore database — the database id must appear in every
// REST path and in getFirestore(app, databaseId). Do not fall back to the default database.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface FirestoreAccess {
  firebaseConfig: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
    databaseId: string;
  };
  restEndpoints: {
    documentsRoot: string;
    collections: Record<string, string>;
    auth: { apiKey: string; signUp: string; refresh: string };
    storage: string;
    token: string;
  };
  metadata: Record<string, string>;
}

export type RawValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { arrayValue: { values?: RawValue[] } }
  | { mapValue: { fields: Record<string, RawValue> } };

export interface DocSnapshot { id: string; data: Record<string, unknown>; }
export interface FilterSpec { field: string; op: string; value: unknown; }

const here = dirname(fileURLToPath(import.meta.url));

function loadAccess(): FirestoreAccess {
  for (const f of [join(here, 'firestore-access.json'), join(process.cwd(), 'firestore-access.json')]) {
    try { return JSON.parse(readFileSync(f, 'utf8')) as FirestoreAccess; } catch { /* try next */ }
  }
  throw new Error('firestore-access.json not found next to firestore-client.ts or in cwd');
}

const ACCESS = loadAccess();
export const FIREBASE_CONFIG = ACCESS.firebaseConfig;
export const REST = ACCESS.restEndpoints;
const ROOT = REST.documentsRoot;

export function encodeValue(v: unknown): RawValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  if (typeof v === 'object') {
    const ov = v as Record<string, unknown>;
    if (ov.__timestamp) return { timestampValue: ov.__timestamp as string };
    return { mapValue: { fields: encodeFields(ov) } };
  }
  throw new Error(`unsupported Firestore value type: ${typeof v}`);
}

export function encodeFields(obj: Record<string, unknown>): Record<string, RawValue> {
  const fields: Record<string, RawValue> = {};
  for (const [k, v] of Object.entries(obj || {})) fields[k] = encodeValue(v);
  return fields;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function decodeValue(v: any): unknown {
  if (!v || typeof v !== 'object') return v;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return v;
}

export function decodeFields(fields: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = decodeValue(v);
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

interface AuthResponse { idToken: string; refreshToken: string; expiresIn: string; localId: string }
interface RefreshWire { id_token: string; refresh_token: string; expires_in: string; user_id: string }
interface TokenState { idToken: string; refreshToken: string; uid: string; expiresAt: number }

let tokenState: TokenState | null = null;

function tokenCachePath(): string {
  return process.env.SUPPRESOR_TOKEN_CACHE || join(here, '.firestore-client-token.json');
}

function readTokenCache(): { refreshToken: string; uid: string } | null {
  try { return JSON.parse(readFileSync(tokenCachePath(), 'utf8')); } catch { return null; }
}

async function refresh(refreshToken: string): Promise<RefreshWire> {
  const res = await fetch(REST.auth.refresh, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
  return res.json();
}

export async function ensureAnonAuth(): Promise<{ idToken: string; uid: string }> {
  const now = Date.now();
  if (tokenState && tokenState.expiresAt > now + 60_000) return { idToken: tokenState.idToken, uid: tokenState.uid };

  let st: TokenState | null = null;
  const cached = tokenState || readTokenCache();
  if (cached?.refreshToken) {
    try {
      const r = await refresh(cached.refreshToken);
      st = { idToken: r.id_token, refreshToken: r.refresh_token, uid: r.user_id, expiresAt: now + (parseInt(r.expires_in, 10) || 3600) * 1000 };
    } catch { /* fall through to signup */ }
  }
  if (!st) {
    const res = await fetch(REST.auth.signUp, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
    });
    if (!res.ok) throw new Error(`anon signUp failed: ${res.status}`);
    const s = (await res.json()) as AuthResponse;
    st = { idToken: s.idToken, refreshToken: s.refreshToken, uid: s.localId, expiresAt: now + (parseInt(s.expiresIn, 10) || 3600) * 1000 };
  }
  tokenState = st;
  try { writeFileSync(tokenCachePath(), JSON.stringify({ refreshToken: st.refreshToken, uid: st.uid }), { mode: 0o600 }); } catch { /* cache optional */ }
  return { idToken: st.idToken, uid: st.uid };
}

function authHeaders(idToken?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (idToken) h.Authorization = `Bearer ${idToken}`;
  return h;
}

function docBase(): string {
  return /\/documents$/.test(ROOT) ? ROOT : `${ROOT}/documents`;
}

function resourceName(collection: string, docId: string): string {
  return `projects/${FIREBASE_CONFIG.projectId}/databases/${FIREBASE_CONFIG.databaseId}/documents/${collection}/${docId}`;
}

function docPath(collection: string, docId?: string): string {
  const base = docBase();
  return docId ? `${base}/${collection}/${encodeURIComponent(docId)}` : `${base}/${collection}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function restJson<T = any>(url: string, init: { method?: string; headers: Record<string, string>; body?: string }): Promise<T> {
  const res = await fetch(url, init as RequestInit);
  let body: any = null;
  try { body = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error(`Firestore REST ${init.method || 'GET'} ${url}: ${body?.error?.message || `HTTP ${res.status}`}`);
  return body as T;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function getDocument(collection: string, docId: string): Promise<Record<string, unknown>> {
  const { idToken } = await ensureAnonAuth();
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const body = await restJson<any>(docPath(collection, docId), { headers: authHeaders(idToken), method: 'GET' });
  return decodeFields(body.fields || {});
}

export async function documentExists(collection: string, docId: string): Promise<boolean> {
  try { await getDocument(collection, docId); return true; }
  catch (e) {
    if (/PERMISSION_DENIED|NOT_FOUND|404/i.test(String((e as Error).message))) return false;
    throw e;
  }
}

export async function setDocument(collection: string, docId: string, data: Record<string, unknown>, opts: { merge?: boolean } = {}): Promise<void> {
  const { idToken } = await ensureAnonAuth();
  const payload = JSON.stringify({ fields: encodeFields(data) });
  if (opts.merge !== false && Object.keys(data).length > 0) {
    const mask = Object.keys(data).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
    await restJson(`${docPath(collection, docId)}?${mask}`, { method: 'PATCH', headers: authHeaders(idToken), body: payload });
    return;
  }
  await restJson(docPath(collection, docId), { method: 'PATCH', headers: authHeaders(idToken), body: payload });
}

export async function createDocument(collection: string, data: Record<string, unknown>, docId?: string): Promise<string | null> {
  const { idToken } = await ensureAnonAuth();
  const url = docId ? `${docBase()}/${collection}?documentId=${encodeURIComponent(docId)}` : `${docBase()}/${collection}`;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const body = await restJson<any>(url, { method: 'POST', headers: authHeaders(idToken), body: JSON.stringify({ fields: encodeFields(data) }) });
  return body.name || null;
}

export async function getCollectionDocs(collection: string, opts: { pageSize?: number; pageToken?: string } = {}): Promise<{ docs: DocSnapshot[]; nextPageToken: string }> {
  const { idToken } = await ensureAnonAuth();
  let url = `${docBase()}/${collection}?pageSize=${opts.pageSize ?? 40}`;
  if (opts.pageToken) url += `&pageToken=${encodeURIComponent(opts.pageToken)}`;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const body = await restJson<any>(url, { headers: authHeaders(idToken), method: 'GET' });
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const docs = (body.documents || []).map((d: any) => ({ id: d.name.split('/').pop(), data: decodeFields(d.fields || {}) }));
  return { docs, nextPageToken: body.nextPageToken || '' };
}

const OP_MAP: Record<string, string> = {
  EQUAL: 'EQUAL', '==': 'EQUAL',
  GREATER: 'GREATER', '>': 'GREATER',
  GREATER_OR_EQUAL: 'GREATER_OR_EQUAL', '>=': 'GREATER_OR_EQUAL',
  LESS: 'LESS', '<': 'LESS',
  LESS_OR_EQUAL: 'LESS_OR_EQUAL', '<=': 'LESS_OR_EQUAL',
  ARRAY_CONTAINS: 'ARRAY_CONTAINS',
  IN: 'IN',
};

// runQuery paginates via read-time cursor entries; helper is single-page, chain by offset.
export async function queryDocs(collection: string, filters: FilterSpec[] = [], opts: { offset?: number; limit?: number } = {}): Promise<DocSnapshot[]> {
  const { idToken } = await ensureAnonAuth();
  const where = filters.map(f => ({ field: { fieldPath: f.field }, op: OP_MAP[f.op] || f.op, value: encodeValue(f.value) }));
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const q: Record<string, any> = { from: [{ collectionId: collection, allDescendants: false }], limit: opts.limit ?? 100, offset: opts.offset ?? 0 };
  if (where.length) q.where = { compositeFilter: { op: 'AND', filters: where } };
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const res = await restJson<any[]>(`${ROOT}/documents:runQuery`, { method: 'POST', headers: authHeaders(idToken), body: JSON.stringify({ structuredQuery: q }) }) || [];
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  return res.filter((e: any) => e.document).map((e: any) => ({ id: e.document.name.split('/').pop(), data: decodeFields(e.document.fields || {}) }));
}

export async function incrementField(collection: string, docId: string, field: string, by = 1, extraFields: Record<string, unknown> = {}): Promise<Record<string, unknown> | null> {
  const { idToken } = await ensureAnonAuth();
  const writes: unknown[] = [];
  const extraKeys = Object.keys(extraFields);
  if (extraKeys.length > 0) {
    writes.push({ update: { name: resourceName(collection, docId), fields: encodeFields(extraFields) }, updateMask: { fieldPaths: extraKeys } });
  }
  writes.push({
    transform: {
      document: resourceName(collection, docId),
      fieldTransforms: [
        { fieldPath: field, increment: encodeValue(by) },
        { fieldPath: 'lastUseAt', setToServerValue: 'REQUEST_TIME' },
      ],
    },
  });
  // Atomic server-side increment via commit fieldTransform (no decrement path by design).
  await restJson(`${ROOT}/documents:commit`, { method: 'POST', headers: authHeaders(idToken), body: JSON.stringify({ writes }) });
  return await getDocument(collection, docId);
}
