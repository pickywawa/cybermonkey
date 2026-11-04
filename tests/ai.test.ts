import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, parseDecision } from '../src/shared/ai/protocol.js';

test('JSON is recovered from fences, prose and trailing text', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure! {"a":{"b":"}"}} hope it helps'), { a: { b: '}' } });
  assert.throws(() => extractJson('no json here'));
});

test('decisions tolerate nulls from structured-output providers and reject malformed ones', () => {
  const ok = parseDecision(
    JSON.stringify({
      tool: 'perform',
      deviceId: 'android:x',
      componentId: 'c1',
      operation: 'tap',
      value: null,
      direction: null,
      summary: null,
      nodes: null,
    }),
  );
  assert.ok(
    ok.ok &&
      ok.decision.tool === 'perform' &&
      ok.decision.value === '' &&
      ok.decision.direction === 'up',
  );
  const finish = parseDecision('{"tool":"finish","summary":null,"nodes":null}');
  assert.ok(finish.ok && finish.decision.tool === 'finish' && finish.decision.nodes.length === 0);
  assert.equal(parseDecision('{"tool":"perform","deviceId":"x"}').ok, false);
  assert.equal(parseDecision('{"tool":"rm -rf"}').ok, false);
});

test('a sequence decision carries several steps and tolerates nulls', () => {
  const r = parseDecision(
    JSON.stringify({
      tool: 'sequence',
      deviceId: 'd',
      steps: [
        { componentId: 'a', cell: null, operation: 'type', value: '${U}', direction: null },
        { componentId: 'b', operation: 'tap' },
      ],
    }),
  );
  assert.ok(
    r.ok &&
      r.decision.tool === 'sequence' &&
      r.decision.steps.length === 2 &&
      r.decision.steps[1].value === '',
  );
  assert.equal(parseDecision('{"tool":"sequence","deviceId":"d","steps":[]}').ok, false);
});
