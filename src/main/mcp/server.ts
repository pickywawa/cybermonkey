import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MCP_TOOLS, type McpStatus } from '../../shared/mcp.js';
import type { Container } from '../container.js';
import { explainFailure, type Ctx, type McpState, type ToolResult } from './context.js';
import { ALL_TOOLS } from './tools/index.js';

const MAX_BODY = 4 * 1024 * 1024;

export const INSTRUCTIONS = `Cybermonkey drives real Android and iOS devices to run and create mobile test scenarios.
Typical flow after a code change: list_scenarios (find what is impacted) → find_path (how to reach it) → run_navigation / run_element (go there and re-run) → on failure read failures[].what_to_do, screenshot + inspect_screen, fix with update_node, run_element again. To cover new behaviour: create_scenario_from_prompt → replay_proposal → accept_proposal. Scenarios can hold conditions (only_if: skipped, not failed, when the element is absent), calls to other scenarios (calls_scenario), datasets (one pass per row) and capture steps (read a value from the screen into \${NAME}). A scenario with "handler" is an interruption handler: it runs by itself when a step fails while its screen is showing (popup, expired session, login screen) and the step is then replayed; run results list interruptions_handled.
Every tool acts on the OS currently ticked in the app (or the "platforms" you pass) and returns one result per OS, so differences between Android and iOS are visible. Every reply is JSON with a "summary" and "next_steps". Only one run can use a device at a time.`;

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Local MCP server: stateless Streamable HTTP on 127.0.0.1, protected by a bearer token, rebuilt per request from the current settings. */
export class McpService {
  private http?: http.Server;
  private listening?: { port: number };
  private error?: string;
  private calls = 0;
  private last?: McpStatus['last'];
  private state: McpState = { proposals: new Map() };
  private starting: Promise<void> = Promise.resolve();

  constructor(
    private c: Container,
    private version: string,
  ) {}

  /** Bring the server in line with the settings (called at startup and after every settings change). */
  apply() {
    this.starting = this.starting.catch(() => {}).then(() => this.reconcile());
    return this.starting;
  }
  private async reconcile() {
    const { mcpEnabled, mcpPort } = this.c.settings();
    if (this.listening && (!mcpEnabled || this.listening.port !== mcpPort)) await this.close();
    if (!mcpEnabled || this.listening) return;
    this.error = undefined;
    const server = http.createServer((req, res) => void this.handle(req, res));
    server.requestTimeout = 0; // runs and creations legitimately last minutes
    server.headersTimeout = 30_000;
    await new Promise<void>((resolve) => {
      server.once('error', (e: NodeJS.ErrnoException) => {
        this.error =
          e.code === 'EADDRINUSE'
            ? `Port ${mcpPort} is already used by another program. Choose another port.`
            : e.message;
        resolve();
      });
      server.listen(mcpPort, '127.0.0.1', () => {
        this.http = server;
        this.listening = { port: mcpPort };
        server.removeAllListeners('error');
        server.on('error', (e) => (this.error = e.message));
        resolve();
      });
    });
  }
  private async close() {
    const server = this.http;
    this.http = undefined;
    this.listening = undefined;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
  async stop() {
    await this.starting.catch(() => {});
    await this.close();
  }

  status(): McpStatus {
    const s = this.c.settings();
    return {
      running: !!this.listening,
      port: s.mcpPort,
      url: `http://127.0.0.1:${s.mcpPort}/mcp`,
      error: this.error,
      tools: this.enabledTools().length,
      calls: this.calls,
      last: this.last,
    };
  }
  private enabledTools() {
    const disabled = new Set(this.c.settings().mcpDisabledTools);
    const known = new Set<string>(MCP_TOOLS.map((t) => t.name));
    return ALL_TOOLS.filter((t) => known.has(t.name) && !disabled.has(t.name));
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const reply = (code: number, body: unknown) => {
      if (res.headersSent) return;
      res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    };
    try {
      const { mcpPort, mcpToken, mcpEnabled } = this.c.settings();
      const host = (req.headers.host ?? '').toLowerCase();
      if (!mcpEnabled) return reply(503, { error: 'MCP is disabled in Cybermonkey settings.' });
      // DNS-rebinding guard: only literal loopback names on our port.
      if (![`127.0.0.1:${mcpPort}`, `localhost:${mcpPort}`, `[::1]:${mcpPort}`].includes(host))
        return reply(403, { error: 'Forbidden host.' });
      if (
        req.headers.origin &&
        !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(req.headers.origin)
      )
        return reply(403, { error: 'Forbidden origin.' });
      const auth = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
      if (!mcpToken || !safeEqual(auth, mcpToken))
        return reply(401, {
          error: 'Missing or invalid token. Copy it from Cybermonkey → Settings → MCP.',
        });
      if (new URL(req.url ?? '/', 'http://x').pathname !== '/mcp')
        return reply(404, { error: 'Use /mcp.' });
      if (req.method !== 'POST')
        return void res
          .writeHead(405, { allow: 'POST' })
          .end(JSON.stringify({ error: 'Stateless server: POST only.' }));

      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > MAX_BODY) return reply(413, { error: 'Request too large.' });
        chunks.push(chunk as Buffer);
      }
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return reply(400, { error: 'Invalid JSON.' });
      }
      const server = this.build();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      reply(500, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  private build() {
    const server = new McpServer(
      { name: 'cybermonkey', version: this.version },
      { instructions: INSTRUCTIONS },
    );
    for (const tool of this.enabledTools()) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.input,
          annotations: { readOnlyHint: !!tool.readOnly, openWorldHint: false },
        },
        async (args: Record<string, unknown>, extra: { signal: AbortSignal }) =>
          this.call(tool.name, tool.run, args, extra.signal),
      );
    }
    return server;
  }

  private async call(
    name: string,
    run: (args: never, ctx: Ctx) => Promise<ToolResult>,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    this.calls++;
    const project = this.c.store.activeProject();
    if (project) this.c.emit({ type: 'ai', projectId: project.id, message: `MCP · ${name}` });
    let result: ToolResult;
    try {
      result = await run(args as never, { c: this.c, state: this.state, signal });
      this.last = { tool: name, at: new Date().toISOString(), ok: true };
    } catch (e) {
      const f = explainFailure(e);
      result = { isError: true, data: { error: f.message, what_to_do: f.hints } };
      this.last = { tool: name, at: new Date().toISOString(), ok: false };
    }
    return {
      isError: result.isError,
      content: [
        { type: 'text' as const, text: JSON.stringify(result.data, null, 1) },
        ...(result.images ?? []).map((i) => ({
          type: 'image' as const,
          data: i.data,
          mimeType: i.mime,
        })),
      ],
    };
  }
}
