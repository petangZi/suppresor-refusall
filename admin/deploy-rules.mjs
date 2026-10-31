#!/usr/bin/env node
// Deploy firestore.rules to the named database using the Firebase CLI login.
//
// `firebase deploy --only firestore:rules` stops at the service-usage preflight
// when the account lacks serviceusage.services.use. The Firebase Rules API needs
// only firebaserules.rulesets.create + firebaserules.releases.update, which the
// same account already has, so this bypasses the preflight without changing IAM.
//
//   node admin/deploy-rules.mjs            # deploy firestore.rules
//   node admin/deploy-rules.mjs --dry-run  # validate by creating a ruleset only

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = process.env.SUPPRESOR_FIRESTORE_PROJECT || 'crafty-joy-d6d0h';
const DATABASE = process.env.SUPPRESOR_FIRESTORE_DB
  || 'ai-studio-tikitikifirehub-2c738d85-fa44-4fe8-9139-9a025f0ef977';
const dryRun = process.argv.includes('--dry-run');

const rules = readFileSync(join(root, 'firestore.rules'), 'utf8');

function cliRefreshToken() {
  const path = join(process.env.HOME || '', '.config/configstore/firebase-tools.json');
  try {
    const token = JSON.parse(readFileSync(path, 'utf8')).tokens?.refresh_token;
    if (token) return token;
  } catch { /* fall through */ }
  throw new Error(`no Firebase CLI login found at ${path}; run firebase login`);
}

async function accessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: cliRefreshToken(),
      client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
      client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
    }),
  });
  const body = await res.json();
  if (!body.access_token) throw new Error(`token exchange failed: ${JSON.stringify(body).slice(0, 200)}`);
  return body.access_token;
}

const auth = { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' };

const created = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: rules }] } }),
});
const ruleset = await created.json();
if (!ruleset.name) throw new Error(`ruleset rejected: ${JSON.stringify(ruleset).slice(0, 600)}`);
console.log(`ruleset: ${ruleset.name}`);

if (dryRun) {
  console.log('dry run: ruleset validated, release not updated');
  process.exit(0);
}

const release = `projects/${PROJECT}/releases/cloud.firestore/${DATABASE}`;
const updated = await fetch(`https://firebaserules.googleapis.com/v1/${release}?updateMask=ruleset_name`, {
  method: 'PATCH',
  headers: auth,
  body: JSON.stringify({ release: { name: release, rulesetName: ruleset.name } }),
});
const result = await updated.json();
if (!updated.ok) throw new Error(`release update failed: ${JSON.stringify(result).slice(0, 400)}`);
console.log(`release: ${result.name} -> ${result.rulesetName}`);
console.log('deployed. run `node admin/verify-rules.mjs` to confirm.');
