import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeOs, migrateProject } from '../src/shared/domain/project.js';
import {
  appendChildren,
  applicableOs,
  cloneWithNewIds,
  makeNode,
  moveNode,
  validateTree,
  flatten,
} from '../src/shared/domain/scenario.js';
import { resolveVariables, resolveVariant } from '../src/shared/domain/variables.js';
import { makeVariant } from '../src/shared/domain/scenario.js';
import { autoSelectDevices, type Device } from '../src/shared/domain/devices.js';
import { classifyError } from '../src/shared/errors.js';

test('flutter projects become android + ios and legacy kinds are migrated', () => {
  const project = migrateProject({
    id: 'p',
    name: 'Legacy',
    directory: '/x',
    platforms: ['flutter'],
    createdAt: new Date().toISOString(),
    tab: 'variables',
    nodes: [
      {
        id: 'r',
        name: 'Root',
        kind: 'folder',
        children: [{ id: 'c', name: 'Check', kind: 'assertion', children: [] }],
      },
    ],
  });
  assert.deepEqual(project.platforms, ['android', 'ios']);
  assert.equal(project.tab, 'creation');
  assert.equal(project.nodes[0].kind, 'scenario');
  assert.equal(project.nodes[0].children[0].kind, 'test');
});

test('focus limits the active operating systems', () => {
  assert.deepEqual(activeOs({ platforms: ['android', 'ios'], focus: 'all' }), ['android', 'ios']);
  assert.deepEqual(activeOs({ platforms: ['android', 'ios'], focus: 'ios' }), ['ios']);
  assert.deepEqual(activeOs({ platforms: ['android'], focus: 'ios' }), ['android']);
});

test('tree helpers keep preconditions consistent', () => {
  const root = makeNode('scenario', 'S');
  const guard = makeNode('test', 'Guard', ['android']);
  const step = makeNode('action', 'Step', ['android']);
  step.preconditionId = guard.id;
  root.children = [guard, step];
  validateTree([root]);
  const moved = moveNode([root], step.id, -1);
  assert.equal(moved[0].children[0].id, step.id);
  assert.equal(
    moved[0].children[1].preconditionId,
    null,
    'precondition must not survive a reorder',
  );
  const copy = cloneWithNewIds(root);
  assert.notEqual(copy.id, root.id);
  assert.equal(copy.children[1].preconditionId, copy.children[0].id);
  assert.equal(flatten(appendChildren([root], root.id, [makeNode('test', 'T', [])])).length, 4);
});

test('single-OS steps are not applicable on the other OS', () => {
  const node = makeNode('action', 'Android only', ['android']);
  node.platforms = ['android'];
  assert.deepEqual(applicableOs(node, ['android', 'ios']), ['android']);
});

test('variables resolve in values, expected texts and selectors', () => {
  assert.equal(resolveVariables('pin=${PIN}', { PIN: '1234' }), 'pin=1234');
  assert.throws(() => resolveVariables('${MISSING}', {}), /MISSING/);
  assert.equal(resolveVariables('${TOKEN}', {}, { CYBERMONKEY_SECRET_TOKEN: 'x' }), 'x');
  const v = resolveVariant(
    makeVariant({ value: '${A}', fallbacks: [{ using: 'id', value: '${A}' }] }),
    { A: 'b' },
  );
  assert.equal(v.value, 'b');
  assert.equal(v.fallbacks[0].value, 'b');
});

test('usb devices are paired automatically, an existing choice is kept', () => {
  const d = (id: string, platform: 'android' | 'ios', kind: Device['kind']): Device => ({
    id,
    name: id,
    platform,
    kind,
    status: 'ready',
    detail: '',
  });
  const devices = [
    d('android:a', 'android', 'simulator'),
    d('android:b', 'android', 'usb'),
    d('ios:c', 'ios', 'usb'),
  ];
  assert.deepEqual(autoSelectDevices({}, devices, ['android', 'ios']), {
    android: 'android:b',
    ios: 'ios:c',
  });
  assert.deepEqual(autoSelectDevices({ android: 'android:a' }, devices, ['android']), {
    android: 'android:a',
  });
});

test('errors are classified for friendly messages', () => {
  assert.equal(classifyError(new Error('device unauthorized')).code, 'device-unauthorized');
  assert.equal(
    classifyError(new Error('Sélecteur ambigu : 2 composants')).code,
    'selector-ambiguous',
  );
  assert.equal(classifyError(new Error('No profiles for com.x were found')).code, 'ios-signing');
  assert.equal(classifyError(new Error('???')).code, 'unknown');
});
