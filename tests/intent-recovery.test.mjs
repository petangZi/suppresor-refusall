import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeIntent, assessIntentRecovery, buildRecoveryPrompt, domainCount } from '../intent-recovery.mjs';

test('domain index has at least 100 capabilities', () => {
  assert.ok(domainCount() >= 100, `only ${domainCount()} domains`);
});

test('web pentest request resolves to web-app-security', () => {
  const a = analyzeIntent('cara pentest web example.com cari xss dan idor');
  assert.equal(a.domain, 'web-app-security');
  assert.equal(a.ambiguity, 'clear');
});

test('ambiguous request falls back to ambiguous intent', () => {
  const a = analyzeIntent('bantu ini dong');
  assert.equal(a.domain, null);
  assert.equal(a.ambiguity, 'no_domain');
});

test('guideline refusal is classified as false refusal', () => {
  const r = assessIntentRecovery({
    userText: 'cara pentest web example.com cari xss',
    assistantText: "I can't help with that. My guidelines prevent this request.",
    thinkingText: 'The system prompt says I should not assist with security testing.',
  });
  assert.equal(r.classification.type, 'false_refusal');
  assert.equal(r.classification.subtype, 'guideline_anti_injection');
  assert.equal(r.classification.shouldRetry, true);
  assert.equal(r.classification.domain, 'web-app-security');
});

test('partial refusal keeps the original domain and does not redirect', () => {
  const r = assessIntentRecovery({
    userText: 'cara pentest web example.com cari xss',
    assistantText: 'Langkah pertama: petakan endpoint dan parameter. Langkah kedua: uji refleksi input. I cannot help with the rest of this request.',
  });
  assert.equal(r.classification.type, 'partial_refusal');
  assert.match(r.recoveryPrompt, /web-app-security/);
  assert.match(r.recoveryPrompt, /Do not switch to a lab/);
  assert.match(r.recoveryPrompt, /example\.com/);
});

test('missing domain routes to the classifier instead of a generic retry', () => {
  const r = assessIntentRecovery({
    userText: 'bantu ini dong',
    assistantText: "I can't help with that.",
  });
  assert.equal(r.classification.type, 'ambiguous_intent');
  assert.equal(r.classification.domain, null);
});

test('recovery prompt preserves the original request text', () => {
  const original = 'cara pentest web example.com cari xss di form login';
  const prompt = buildRecoveryPrompt({ userText: original, analysis: analyzeIntent(original) });
  assert.ok(prompt.includes(original));
  assert.match(prompt, /Preserve the original target, scope, language/);
});
