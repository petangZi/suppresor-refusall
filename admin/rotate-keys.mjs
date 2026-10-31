#!/usr/bin/env node
// Rotate leaked TTK-* license keys.
//
// The key documents store the raw key in a `key` field, and the collection was
// enumerable while the old rules were live. This script mints a replacement key
// per ACTIVE document, copies metadata, drops the raw `key` field, and revokes
// the old document. Distribution of the new keys is on you: they are printed
// once to stdout and never written to disk.
//
//   GOOGLE_APPLICATION_CREDENTIALS=/path/sa.json node admin/rotate-keys.mjs
//   GOOGLE_APPLICATION_CREDENTIALS=/path/sa.json node admin/rotate-keys.mjs --apply
//   ... --apply --delete-old     # remove old docs instead of marking REVOKED
//
// Needs a service account with roles/datastore.user (or Owner) on the project.
// Dry run is the default; nothing is written without --apply.

import { readFileSync } from 'node:fs';
import { createSign, randomBytes, createHash } from 'node:crypto';

const PROJECT = process.env.SUPPRESOR_FIRESTORE_PROJECT || 'crafty-joy-d6d0h';
const DATABASE = process.env.SUPPRESOR_FIRESTORE_DB
  || 'ai-studio-tikitikifirehub-2c738d85-fa44-4fe8-9139-9a025f0ef977';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/documents`;

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const deleteOld = args.includes('--delete-old');
const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || (args.includes('--sa') ? args[args.indexOf('--sa') + 1] : '');

if (!saPath) {
  console.error('service account required: set GOOGLE_APPLICATION_CREDENTIALS or pass --sa <path>');
  process.exit(2);
}

const sa = JSON.parse(readFileSync(saPath, 'utf8'));

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

async function accessToken() {
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  }));
  const signature = createSign('RSA-SHA256').update(`${header}.${claim}`).sign(sa.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`token: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

const token = await accessToken();
const auth = { authorization: `Bearer ${token}` };

async function listKeys() {
  const docs = [];
  let pageToken = '';
  do {
    const url = `${BASE}/accessKeys?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url, { headers: auth });
    if (!res.ok) throw new Error(`list: ${res.status} ${await res.text()}`);
    const body = await res.json();
    docs.push(...(body.documents || []));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return docs;
}

function fieldString(fields, name) {
  const f = fields?.[name];
  if (!f) return '';
  return f.stringValue ?? f.integerValue ?? f.booleanValue ?? '';
}

function newKey() {
  const raw = randomBytes(6).toString('hex').toUpperCase();
  return `TTK-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

async function createKey(id, fields) {
  const res = await fetch(`${BASE}/accessKeys?documentId=${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (res.status === 409) return false;
  if (!res.ok) throw new Error(`create ${id}: ${res.status} ${await res.text()}`);
  return true;
}

async function revokeOld(id, remove) {
  if (remove) {
    const res = await fetch(`${BASE}/accessKeys/${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth });
    if (!res.ok && res.status !== 404) throw new Error(`delete ${id}: ${res.status} ${await res.text()}`);
    return;
  }
  const res = await fetch(
    `${BASE}/accessKeys/${encodeURIComponent(id)}?updateMask.fieldPaths=status&updateMask.fieldPaths=key`,
    {
      method: 'PATCH',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ fields: { status: { stringValue: 'REVOKED' } } }),
    },
  );
  if (!res.ok) throw new Error(`revoke ${id}: ${res.status} ${await res.text()}`);
}

const docs = await listKeys();
const active = docs.filter((doc) => {
  const status = String(fieldString(doc.fields, 'status')).toUpperCase();
  return status === 'ACTIVE' || doc.fields?.active?.booleanValue === true;
});

console.log(`project ${PROJECT} / database ${DATABASE}`);
console.log(`documents: ${docs.length}, active: ${active.length}, mode: ${apply ? (deleteOld ? 'APPLY + delete old' : 'APPLY + revoke old') : 'dry run'}`);

function replacementFields(source, oldId, key) {
  const fields = { ...source };
  delete fields.key;
  fields.id = { stringValue: key };
  fields.keyHash = { stringValue: createHash('sha256').update(key).digest('hex') };
  fields.maskedKey = { stringValue: `TTK-****-****-${key.slice(-4)}` };
  fields.createdAt = { stringValue: new Date().toISOString() };
  fields.rotatedFrom = { stringValue: oldId };
  fields.status = { stringValue: 'ACTIVE' };
  return fields;
}

const rotated = [];
for (const doc of active) {
  const oldId = doc.name.split('/').pop();
  const key = newKey();

  if (!apply) {
    rotated.push({ oldId, key });
    console.log(`would rotate ${oldId} -> ${key}`);
    continue;
  }

  let mintedKey = null;
  for (let attempt = 0; attempt < 3 && !mintedKey; attempt += 1) {
    const candidate = attempt === 0 ? key : newKey();
    if (await createKey(candidate, replacementFields(doc.fields, oldId, candidate))) mintedKey = candidate;
  }
  if (!mintedKey) {
    console.error(`failed to mint replacement for ${oldId}`);
    continue;
  }
  await revokeOld(oldId, deleteOld);
  rotated.push({ oldId, key: mintedKey });
  console.log(`rotated ${oldId} -> ${mintedKey}`);
}

console.log('\nnew keys (hand these out once, they are not stored in plaintext):');
for (const row of rotated) console.log(`${row.oldId} -> ${row.key}`);
if (!apply) console.log('\nnothing written; re-run with --apply');
