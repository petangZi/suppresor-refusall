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

test('all Tiki modes load a distinct prompt and mode', async () => {
  const { getTikiAgent, getTikiAgents } = await import('../tiki-agent.mjs');
  const subagents = ['tiki', 'tiki-prompter', 'tiki-coder', 'tiki-architect'];
  for (const id of subagents) {
    const agent = await getTikiAgent(id);
    assert.ok(agent, `${id} missing`);
    assert.equal(agent.mode, 'subagent');
    assert.match(agent.description, /TIKI/);
    if (id === 'tiki-prompter') {
      assert.match(agent.prompt, /project_instructions/);
      assert.match(agent.prompt, /Kamu adalah TIKI/);
    } else {
      assert.match(agent.prompt, /Target Gate — hard stop/);
      assert.match(agent.prompt, /TIKI LICKY/);
    }
  }
  const bigtiki = await getTikiAgent('bigtiki');
  assert.ok(bigtiki);
  assert.equal(bigtiki.mode, 'primary');
  assert.match(bigtiki.prompt, /TIKI LICKY/);
  assert.match(bigtiki.prompt, /BIGTIKI/);
  assert.match(bigtiki.prompt, /Gas, Bos/);
  const all = await getTikiAgents();
  assert.equal(Object.keys(all).length, 5);
});
