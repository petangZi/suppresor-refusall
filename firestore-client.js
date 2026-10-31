// firestore-client.js — Suppresor Refusall (TikiTeam) plug-and-play Firestore module.
// Zero dependencies. Node >= 18 (global fetch). Standalone: copy into any src/ or lib/.
//
// Handles the named-database pitfall: `DATABASE_ID` is NOT the default "(default)"
// database, so the REST paths always include the named database id — the same
// mistake `getFirestore()` makes when given no second argument.
//
// Usage:
//   import { getDocument, setDocument, getCollectionDocs, queryDocs, ensureAnonAuth } from './firestore-client.js';
//   const doc = await getDocument('accessKeys', 'SRK-XXXX-XXXX-XXXX-XXXX');
//   await setDocument('users', uid, { deviceId: '...', uses: { __setNumber: 1 } });
//   const all = await getCollectionDocs('prompts', { pageSize: 50 });
//   const hits = await queryDocs('users', [{ field: 'deviceId', op: 'EQUAL', value: '...' }]);

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

function loadAccess() {
  for (const f of [join(here, 'firestore-access.json'), join(process.cwd(), 'firestore-access.json')]) {
    try { return JSON.parse(readFileSync(f, 'utf8')); } catch { /* try next */ }
  }
  throw new Error('firestore-access.json not found next to firestore-client.js or in cwd');
}

const access = loadAccess();
export const FIREBASE_CONFIG = access.firebaseConfig;
export const REST = access.restEndpoints;

const ROOT = REST.documentsRoot;
const AUTH = REST.auth;
const API_KEY = AUTH.apiKey;

// ---- Firestore value encoding ----

export function encodeValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return { integerValue: String(v) };
    return { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  if (typeof v === 'object') {
    if (v.__timestamp) return { timestampValue: v.__timestamp };
    if (v.__increment !== undefined) return { integerValue: v.__increment }; // only valid inside transforms
    return { mapValue: { fields: encodeFields(v) } };
  }
  throw new Error(`unsupported Firestore value type: ${typeof v}`);
}

export function encodeFields(obj) {
  const fields = {};
  if (obj) for (const [k, v] of Object.entries(obj)) fields[k] = encodeValue(v);
  return fields;
}

export function decodeValue(v) {
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

export function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = decodeValue(v);
  return out;
}

// ---- Anonymous auth (token cache + refresh) ----

let tokenState = null; // { idToken, refreshToken, expiresAt, uid }

function tokenDirCachePath() {
  if (process.env.SUPPRESOR_TOKEN_CACHE) return process.env.SUPPRESOR_TOKEN_CACHE;
  // Tests and alternate profiles must not share one anonymous identity, or the
  // server-side free counter leaks between them. Real installs keep the cache
  // next to the plugin so the uid survives restarts.
  const dir = process.env.SUPPRESOR_TESTING === '1' && process.env.SUPPRESOR_STATE_DIR
    ? process.env.SUPPRESOR_STATE_DIR
    : here;
  return join(dir, '.firestore-client-token.json');
}

function readTokenCache() {
  try { return JSON.parse(readFileSync(tokenDirCachePath(), 'utf8')); } catch { return null; }
}

async function anonSignUp() {
  const res = await fetch(AUTH.signUp, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  let body = null;
  try { body = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const detail = body?.error?.message || `HTTP ${res.status}`;
    throw new Error(`anon signUp failed: ${detail}`);
  }
  return body; // { idToken, refreshToken, expiresIn, localId }
}

async function refreshToken(refreshToken) {
  const res = await fetch(AUTH.refresh, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
  const data = await res.json();
  return { idToken: data.id_token, refreshToken: data.refresh_token, expiresIn: data.expires_in, uid: data.user_id };
}

// Returns { idToken, uid } for Authorization headers. Auto-signs-up once, then refreshes.
let authInFlight = null;

export async function ensureAnonAuth() {
  if (authInFlight) return authInFlight;
  authInFlight = ensureAnonAuthInner().finally(() => { authInFlight = null; });
  return authInFlight;
}

async function ensureAnonAuthInner() {
  const now = Date.now();
  if (tokenState && tokenState.expiresAt > now + 60000) {
    return { idToken: tokenState.idToken, uid: tokenState.uid };
  }
  let refreshed = null;
  const cached = tokenState || readTokenCache();
  if (cached && cached.refreshToken) {
    try { refreshed = await refreshToken(cached.refreshToken); } catch { /* fall through to signup */ }
  }
  if (refreshed) {
    tokenState = {
      idToken: refreshed.idToken,
      refreshToken: refreshed.refreshToken,
      uid: refreshed.uid,
      expiresAt: now + (parseInt(refreshed.expiresIn, 10) || 3600) * 1000,
    };
  } else {
    const s = await anonSignUp();
    tokenState = { idToken: s.idToken, refreshToken: s.refreshToken, uid: s.localId, expiresAt: now + (parseInt(s.expiresIn, 10) || 3600) * 1000 };
  }
  try {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(tokenDirCachePath(), JSON.stringify({ refreshToken: tokenState.refreshToken, uid: tokenState.uid }), { mode: 0o600 });
  } catch { /* cache is optional */ }
  return { idToken: tokenState.idToken, uid: tokenState.uid };
}

// ---- Core REST calls ----

function authHeaders(idToken) {
  return idToken ? { Authorization: `Bearer ${idToken}` } : {};
}

function docPath(collection, docId) {
  const base = /\/documents$/.test(ROOT) ? ROOT : `${ROOT}/documents`;
  return docId ? `${base}/${collection}/${encodeURIComponent(docId)}` : `${base}/${collection}`;
}

function resourceName(collection, docId) {
  return `projects/${FIREBASE_CONFIG.projectId}/databases/${FIREBASE_CONFIG.databaseId}/documents/${collection}/${docId}`;
}

async function restJson(url, init) {
  const res = await fetch(url, init);
  let body = null;
  try { body = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const msg = body?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Firestore REST ${init?.method || 'GET'} ${url}: ${msg}`);
  }
  return body;
}

export async function apiGet(url, idToken) {
  return restJson(url, { headers: authHeaders(idToken) });
}

export async function apiPost(url, data, idToken) {
  return restJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(idToken) },
    body: JSON.stringify(data),
  });
}

export async function apiPatch(url, data, idToken) {
  return restJson(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(idToken) },
    body: JSON.stringify(data),
  });
}

// ---- CRUD helpers ----

export async function getDocument(collection, docId) {
  const { idToken } = await ensureAnonAuth();
  const body = await apiGet(docPath(collection, docId), idToken);
  return decodeFields(body.fields || {});
}

export async function getDocumentPublic(collection, docId) {
  const body = await apiGet(docPath(collection, docId), null);
  return decodeFields(body.fields || {});
}

export async function documentExists(collection, docId) {
  try {
    await getDocument(collection, docId);
    return true;
  } catch (e) {
    if (/PERMISSION_DENIED|NOT_FOUND|404/i.test(String(e.message))) return false;
    throw e;
  }
}

export async function setDocument(collection, docId, data, { merge = true } = {}) {
  const keys = Object.keys(data || {});
  if (keys.length === 0) return null;
  const { idToken } = await ensureAnonAuth();
  const payload = { fields: encodeFields(data) };
  if (merge) {
    const mask = keys.map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
    return apiPatch(`${docPath(collection, docId)}?${mask}`, payload, idToken);
  }
  return apiPatch(docPath(collection, docId), payload, idToken);
}

export async function createDocument(collection, data, docId) {
  const { idToken } = await ensureAnonAuth();
  const base = /\/documents$/.test(ROOT) ? ROOT : `${ROOT}/documents`;
  const url = docId
    ? `${base}/${collection}?documentId=${encodeURIComponent(docId)}`
    : `${base}/${collection}`;
  const body = await apiPost(url, { fields: encodeFields(data) }, idToken);
  return body.name || null;
}

export async function getCollectionDocs(collection, { pageSize = 40, pageToken = '', idTokenOverride } = {}) {
  const { idToken } = idTokenOverride ? { idToken: idTokenOverride } : await ensureAnonAuth();
  const base = /\/documents$/.test(ROOT) ? ROOT : `${ROOT}/documents`;
  let url = `${base}/${collection}?pageSize=${pageSize}`;
  if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
  const body = await apiGet(url, idToken);
  const docs = (body.documents || []).map(d => ({
    id: d.name.split('/').pop(),
    data: decodeFields(d.fields || {}),
  }));
  return { docs, nextPageToken: body.nextPageToken || '' };
}

const OP_MAP = { EQUAL: 'EQUAL', '==': 'EQUAL', GREATER: 'GREATER', '>': 'GREATER', GREATER_OR_EQUAL: 'GREATER_OR_EQUAL', '>=': 'GREATER_OR_EQUAL', LESS: 'LESS', '<': 'LESS', LESS_OR_EQUAL: 'LESS_OR_EQUAL', '<=': 'LESS_OR_EQUAL', ARRAY_CONTAINS: 'ARRAY_CONTAINS', IN: 'IN' };

export function buildStructuredQuery(collection, filters = [], { offset = 0, limit = 100, orderBy = null, select = null } = {}) {
  const where = filters.map(f => ({
    field: { fieldPath: f.field },
    op: OP_MAP[f.op] || f.op,
    value: encodeValue(f.value),
  }));
  const q = {
    from: [{ collectionId: collection, allDescendants: false }],
    limit,
    offset,
    where: null,
  };
  if (where.length) q.where = { compositeFilter: { op: 'AND', filters: where } };
  if (orderBy) q.orderBy = [{ field: { fieldPath: orderBy.field }, direction: orderBy.direction || 'ASCENDING' }];
  if (select && select.length) q.select = { fields: select.map(f => ({ fieldPath: f })) };
  return { structuredQuery: q };
}

// runQuery paginates via read-time cursor entries; helper is single-page, chain by offset.
export async function queryDocs(collection, filters = [], opts = {}) {
  const { idToken } = await ensureAnonAuth();
  const req = buildStructuredQuery(collection, filters, opts);
  const res = await apiPost(`${ROOT}/documents:runQuery`, req, idToken) || [];
  const docs = res.filter(e => e.document).map(e => ({
    id: e.document.name.split('/').pop(),
    data: decodeFields(e.document.fields || {}),
  }));
  return docs;
}

// Atomic server-side increment via commit fieldTransform (no decrement path by design).
export async function incrementField(collection, docId, field, by = 1, extraFields = {}) {
  const { idToken } = await ensureAnonAuth();
  const name = resourceName(collection, docId);
  const writes = [];
  const extraKeys = extraFields ? Object.keys(extraFields) : [];
  if (extraKeys.length > 0) {
    writes.push({
      update: { name, fields: encodeFields(extraFields) },
      updateMask: { fieldPaths: extraKeys },
    });
  }
  writes.push({
    transform: {
      document: name,
      fieldTransforms: [
        { fieldPath: field, increment: encodeValue(by) },
        { fieldPath: 'lastUseAt', setToServerValue: 'REQUEST_TIME' },
      ],
    },
  });
  await restJson(`${ROOT}/documents:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(idToken) },
    body: JSON.stringify({ writes }),
  });
  return getDocument(collection, docId);
}
