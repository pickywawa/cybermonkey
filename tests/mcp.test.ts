import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WorkspaceStore } from '../src/main/infra/storage/workspace-store.js';
import { McpService } from '../src/main/mcp/server.js';
import { ALL_TOOLS } from '../src/main/mcp/tools/index.js';
import { partialRoot, routeTo, sequenceRoot } from '../src/main/engine/execution/roots.js';
import { MCP_GROUPS, MCP_TOOLS } from '../src/shared/mcp.js';
import { makeNode, makeVariant, appendChildren } from '../src/shared/domain/scenario.js';

const PORT = 47650 + Math.floor(Math.random() * 200);

async function setup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cm-mcp-'));
  const store = new WorkspaceStore(path.join(dir, 'cfg'), dir);
  await store.load();
  await store.patchSettings({ mcpPort: PORT + Math.floor(Math.random() * 50) });
  const project = await store.create({ name: 'Demo', platforms: ['android', 'ios'] });
  const scenario = makeNode('scenario', 'Login');
  const nav = { ...makeNode('navigation', 'Open menu', ['android', 'ios']) };
  const act = makeNode('action', 'Tap login', ['android', 'ios']);
  const test1 = makeNode('test', 'Check title', ['android', 'ios']);
  test1.variants.ios = makeVariant({
    operation: 'assert',
    locator: { using: 'accessibility id', value: 't' },
  });
  await store.update({
    id: project.id,
    nodes: appendChildren([scenario], scenario.id, [nav, act, test1]),
  });
  const c: any = {
    store,
    settings: () => store.state.settings,
    emit() {},
    devices: { known: new Map() },
    automation: { leaseOwner: () => undefined },
  };
  const service = new McpService(c, '0.0.0-test');
  return {
    store,
    c,
    service,
    project,
    scenario,
    nav,
    act,
    test1,
    port: store.state.settings.mcpPort,
  };
}

test('catalog and registry list exactly the same tools, each in a known group', () => {
  assert.deepEqual([...ALL_TOOLS.map((t) => t.name)].sort(), MCP_TOOLS.map((t) => t.name).sort());
  for (const t of ALL_TOOLS) assert.equal(MCP_TOOLS.find((m) => m.name === t.name)!.group, t.group);
  for (const t of MCP_TOOLS) assert.ok(MCP_GROUPS.includes(t.group));
});

test('settings default: enabled, token generated, nothing disabled', async () => {
  const { store } = await setup();
  assert.equal(store.state.settings.mcpEnabled, true);
  assert.match(store.state.settings.mcpToken, /^[0-9a-f]{48}$/);
  assert.deepEqual(store.state.settings.mcpDisabledTools, []);
});

test('server: auth, host check, disabling tools and disabling the server', async () => {
  const { c, service, store, port } = await setup();
  await service.apply();
  try {
    assert.equal(service.status().running, true);
    const url = `http://127.0.0.1:${port}/mcp`;
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    assert.equal((await fetch(url, { method: 'POST', headers, body })).status, 401);
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers: { ...headers, authorization: 'Bearer nope' },
          body,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers: {
            ...headers,
            authorization: 'Bearer ' + store.state.settings.mcpToken,
            origin: 'https://evil.example',
          },
          body,
        })
      ).status,
      403,
    );

    const connect = async () => {
      const client = new Client({ name: 't', version: '1' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(url), {
          requestInit: { headers: { authorization: 'Bearer ' + store.state.settings.mcpToken } },
        }),
      );
      return client;
    };
    let client = await connect();
    assert.equal((await client.listTools()).tools.length, MCP_TOOLS.length);
    const res: any = await client.callTool({ name: 'list_projects', arguments: {} });
    assert.equal(res.isError ?? false, false);
    assert.equal(JSON.parse(res.content[0].text).projects[0].name, 'Demo');
    await client.close();

    await store.patchSettings({ mcpDisabledTools: ['run_scenario', 'click'] });
    client = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(
      !names.includes('run_scenario') && !names.includes('click') && names.includes('run_element'),
    );
    const err: any = await client.callTool({
      name: 'list_scenarios',
      arguments: { project: 'does-not-exist' },
    });
    assert.equal(err.isError, true);
    assert.match(JSON.parse(err.content[0].text).error, /not found/);
    await client.close();

    await store.patchSettings({ mcpEnabled: false });
    await service.apply();
    assert.equal(service.status().running, false);
    await assert.rejects(fetch(url, { method: 'POST', headers, body }));
  } finally {
    await service.stop();
  }
  void c;
});

test('routes: what must run before an item, and partial roots keep the start screen', async () => {
  const { store, project, scenario, nav, act, test1 } = await setup();
  const p = store.get(project.id);
  const route = routeTo(p, test1.id)!;
  assert.deepEqual(
    route.steps.map((s) => s.node.id),
    [nav.id, act.id],
  );
  assert.equal(route.scenario.id, scenario.id);
  const partial = partialRoot(p, test1.id, true)!;
  assert.deepEqual(
    partial.children.map((n) => n.id),
    [test1.id],
  );
  const seq = sequenceRoot('x', [act, nav]);
  assert.deepEqual(
    seq.children.map((n) => n.id),
    [act.id, nav.id],
  );
});
