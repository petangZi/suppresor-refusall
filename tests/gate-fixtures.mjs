import { generateKeyPairSync } from 'node:crypto';

let cached = null;

export function installTokenKeys() {
  if (cached) return cached;
  const pair = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  process.env.SUPPRESOR_TOKEN_KEY_PEM = pair.privateKey;
  process.env.SUPPRESOR_TOKEN_PUBLIC_PEM = pair.publicKey;
  cached = pair;
  return cached;
}
