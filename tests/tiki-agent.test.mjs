import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTikiAgent } from '../tiki-agent.mjs';

test('tiki agent prompt starts with a hard target gate', async () => {
  const agent = await getTikiAgent();
  assert.equal(agent.temperature, 0.2);
  assert.match(agent.prompt, /Target Gate — hard stop/);
  assert.match(agent.prompt, /do not call tools/);
  assert.match(agent.prompt, /do not mention compaction/);
  assert.match(agent.prompt, /ask one line/);
});

test('tiki agent no longer allows asking about a missing target to be overridden', async () => {
  const agent = await getTikiAgent();
  assert.match(agent.prompt, /verb-only request/i);
  assert.match(agent.prompt, /do not invent a target/);
});
