#!/usr/bin/env node
// Live verification for the deployed Firestore rules.
//
// Checks the license-critical surface only: key enumeration must be closed,
// key lookup must stay open for activation, and the free-tier ledger must be
// writable by an anonymous account.
//
//   node admin/verify-rules.mjs
//   SUPPRESOR_TEST_KEY=TTK-... node admin/verify-rules.mjs
//
// Exits 1 if any probe fails, so it can gate a deploy.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(root, 'firestore-access.json'), 'utf8')).firebaseConfig;
const base = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${cfg.databaseId}/documents`;
const testKey = process.env.SUPPRESOR_TEST_KEY || 'TTK-25A0-4906-4AEA';

const results = [];
function record(name, expected, actual, detail = '') {
  const ok = Array.isArray(expected) ? expected.includes(actual) : actual === expected;
  results.push({ name, expected: String(expected), actual, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  expected=${expected} actual=${actual}${detail ? `  ${detail}` : ''}`);
}

async function status(url, init) {
  const res = await fetch(url, init);
  return { code: res.status, body: await res.text() };
}

// 1-3. Enumeration and writes on accessKeys must be denied.
record('runQuery accessKeys denied', 403, (await status(`${base}:runQuery`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'accessKeys' }], limit: 1 } }),
})).code);

record('list accessKeys denied', 403, (await status(`${base}/accessKeys?pageSize=2`)).code);

record('create accessKeys denied', 403, (await status(`${base}/accessKeys?documentId=TTK-0000-0000-0000`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ fields: { id: { stringValue: 'TTK-0000-0000-0000' } } }),
})).code);

// 4. Unauthenticated get is denied once rules require auth.
record('get accessKeys needs auth', [401, 403], (await status(`${base}/accessKeys/${encodeURIComponent(testKey)}`)).code);

// 5-6. Anonymous ledger create and increment.
const signup = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${cfg.apiKey}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ returnSecureToken: true }),
});
if (!signup.ok) {
  record('anonymous auth enabled', 200, signup.status, (await signup.text()).slice(0, 120));
} else {
  record('anonymous auth enabled', 200, 200);
  const { idToken, localId } = await signup.json();
  const auth = { authorization: `Bearer ${idToken}`, 'content-type': 'application/json' };
  const authedKey = await status(`${base}/accessKeys/${encodeURIComponent(testKey)}`, { headers: { authorization: `Bearer ${idToken}` } });
  record('get accessKeys with auth', [200, 404], authedKey.code);

  const privateDoc = await status(`${base}/accessKeysPrivate/${encodeURIComponent(testKey)}`, { headers: { authorization: `Bearer ${idToken}` } });
  record('private key doc denied', 403, privateDoc.code);

  const ledger = await status(`${base}/users?documentId=${localId}`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      fields: {
        deviceId: { stringValue: `verify-${Date.now()}` },
        keyRef: { nullValue: null },
        uses: { integerValue: '0' },
      },
    }),
  });
  record('ledger create allowed', 200, ledger.code, ledger.code === 200 ? '' : ledger.body.slice(0, 120));

  const name = `projects/${cfg.projectId}/databases/${cfg.databaseId}/documents/users/${localId}`;
  const inc = await status(`${base}:commit`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      writes: [{
        transform: {
          document: name,
          fieldTransforms: [
            { fieldPath: 'uses', increment: { integerValue: '1' } },
            { fieldPath: 'lastUseAt', setToServerValue: 'REQUEST_TIME' },
          ],
        },
      }],
    }),
  });
  record('ledger increment allowed', 200, inc.code, inc.code === 200 ? '' : inc.body.slice(0, 120));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
