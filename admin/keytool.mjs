#!/usr/bin/env node
// Admin-only key minting. Never ship this file or the private key with the plugin.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateKey, sign, randomBytes } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const privPath = process.env.SUPPRESOR_PRIVATE_KEY || join(here, 'license-private.pem');

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function usage() {
  console.log(`usage:
  node admin/keytool.mjs mint [--id ID] [--days 365] [--devices 5] [--tier pro]
  node admin/keytool.mjs verify <KEY>

defaults: id random, days 365, devices 5, tier pro
private key: ${privPath}`);
}

function mint(opts) {
  const priv = createPrivateKey(readFileSync(privPath, 'utf8'));
  const payload = {
    v: 1,
    id: opts.id || `SRK-${randomBytes(6).toString('hex').toUpperCase()}`,
    tier: opts.tier || 'pro',
    dev: opts.devices ?? 5,
    iat: Date.now(),
    exp: opts.days && opts.days > 0 ? Date.now() + opts.days * 86400000 : 0,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(sign(null, Buffer.from(body), priv));
  return { key: `SRK1.${body}.${sig}`, payload };
}

function parseArgs(argv) {
  const out = { devices: 5, days: 365, tier: 'pro' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--id') out.id = argv[++i];
    else if (a === '--days') out.days = parseInt(argv[++i], 10);
    else if (a === '--devices') out.devices = parseInt(argv[++i], 10);
    else if (a === '--tier') out.tier = argv[++i];
  }
  return out;
}

const [, , cmd, ...rest] = process.argv;

if (cmd === 'mint') {
  const { key, payload } = mint(parseArgs(rest));
  console.log(JSON.stringify({ key, payload }, null, 2));
  console.log('\npaste in opencode: /suppresor-refusall key ' + key);
} else if (cmd === 'verify' && rest[0]) {
  const { verifySignedKey } = await import('../license.mjs');
  console.log(JSON.stringify(verifySignedKey(rest[0]), null, 2));
} else {
  usage();
  process.exit(cmd ? 1 : 0);
}
