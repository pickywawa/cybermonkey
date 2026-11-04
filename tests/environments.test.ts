import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  activeEnvironment,
  effectiveVariables,
  normalizeEnvironments,
  type Project,
} from '../src/shared/domain/project.js';
import { WorkspaceStore } from '../src/main/infra/storage/workspace-store.js';
import { resolveVariables } from '../src/shared/domain/variables.js';

const env = (id: string, name: string, variables: Record<string, string> = {}) => ({
  id,
  name,
  variables,
});
const base = (patch: Partial<Project> = {}) =>
  ({
    variables: { URL: 'https://prod.acme.io', LOGIN: 'common' },
    environments: [],
    activeEnvironmentId: null,
    ...patch,
  }) as Project;

test('the selected environment overrides the common variables, the rest is inherited', () => {
  const p = base({
    environments: [
      env('r', 'Recette', { URL: 'https://recette.acme.io', EXTRA: '1' }),
      env('p', 'Préprod', { URL: 'https://preprod.acme.io' }),
    ],
    activeEnvironmentId: 'r',
  });
  assert.deepEqual(effectiveVariables(p), {
    URL: 'https://recette.acme.io',
    LOGIN: 'common',
    EXTRA: '1',
  });
  assert.equal(activeEnvironment(p)?.name, 'Recette');
  assert.deepEqual(effectiveVariables({ ...p, activeEnvironmentId: null }), {
    URL: 'https://prod.acme.io',
    LOGIN: 'common',
  });
  assert.deepEqual(effectiveVariables({ ...p, activeEnvironmentId: 'ghost' }), {
    URL: 'https://prod.acme.io',
    LOGIN: 'common',
  });
  // what a step resolves
  assert.equal(
    resolveVariables('${URL}/login', effectiveVariables(p)),
    'https://recette.acme.io/login',
  );
});

test('environment names must be distinct; a selection that no longer exists falls back to none', () => {
  assert.throws(
    () =>
      normalizeEnvironments({
        environments: [env('1', 'Recette'), env('2', ' recette ')],
        activeEnvironmentId: null,
      }),
    /Deux environnements/,
  );
  const gone = normalizeEnvironments({
    environments: [env('1', 'Recette')],
    activeEnvironmentId: '9',
  });
  assert.equal(gone.activeEnvironmentId, null);
  assert.equal(
    normalizeEnvironments({ environments: [env('1', 'Recette')], activeEnvironmentId: '1' })
      .activeEnvironmentId,
    '1',
  );
});

test('the store keeps environments with the project, and drops a selection when its environment is deleted', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cm-env-'));
  const store = new WorkspaceStore(path.join(dir, 'config'), dir);
  await store.load();
  const project = await store.create({
    name: 'Envs',
    platforms: ['ios'],
    applications: { android: '', ios: '' },
  });
  assert.deepEqual(project.environments, []);
  const withEnv = await store.update({
    id: project.id,
    environments: [env('r', 'Recette', { URL: 'x' })],
    activeEnvironmentId: 'r',
  });
  assert.equal(withEnv.activeEnvironmentId, 'r');
  assert.deepEqual(effectiveVariables(withEnv).URL, 'x');
  const removed = await store.update({ id: project.id, environments: [] });
  assert.equal(removed.activeEnvironmentId, null);
  await assert.rejects(
    store.update({ id: project.id, environments: [env('1', 'A'), env('2', 'a')] }),
    /Deux environnements/,
  );
  // survives a reload from disk
  await store.update({
    id: project.id,
    environments: [env('r', 'Recette', { URL: 'x' })],
    activeEnvironmentId: 'r',
  });
  const again = new WorkspaceStore(path.join(dir, 'config'), dir);
  await again.load();
  assert.equal(activeEnvironment(again.get(project.id))?.name, 'Recette');
});
