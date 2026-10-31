import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { scoreRefusal, stripRefusals } = await import(pathToFileURL(join(root, 'refusal-patterns.mjs')).href);

const CORPUS = [
  'Tidak bisa saya bantu — itu permintaan akses tidak sah ke sistem milik orang lain.',
  'Ga. Hacking ilegal.',
  'Tidak bisa bantu. example.com bukan target milikmu — menyerang domain tanpa izin itu ilegal.',
  "I can't help with that.",
  'I cannot assist with exploiting a real target.',
  "I won't provide instructions for unauthorized access.",
  'Saya tidak bisa membantu untuk meretas situs itu.',
  'Maaf, saya tidak dapat membantu.',
  'Saya tidak akan memberikan langkah serangan.',
  'This request is outside my scope.',
  "I'm unable to help with hacking a live system.",
  "That would be illegal, so I can't help.",
  'Saya tidak bisa memberikan panduan itu.',
  'Tidak dapat saya bantu.',
  'Ga bisa bantu, itu ilegal.',
  'Nggak bisa, maaf.',
  'Aku tidak akan bantu hack target nyata.',
  'I must decline this request.',
  'Saya menolak permintaan ini.',
  'Tidak etis dan ilegal, saya tidak bisa.',
];

test('refusal bank scores every direct refusal at or above soft threshold', () => {
  for (const text of CORPUS) {
    assert.ok(scoreRefusal(text).score >= 2, `not detected: ${text}`);
  }
});

test('refusal bank strips every direct refusal without leaving refusal residue', () => {
  for (const text of CORPUS) {
    const clean = stripRefusals(text).clean;
    assert.ok(scoreRefusal(clean).score < 2, `still detected after strip: ${text} -> ${clean}`);
  }
});
