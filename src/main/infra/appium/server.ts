import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import type { Settings } from '../../../shared/domain/settings.js';
import { commandEnv } from '../env.js';
import { nodeModules } from '../paths.js';
import { log } from '../log.js';
import { prepareAppiumRuntime } from './runtime.js';

export class AppiumError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

/** Owns the local Appium process and speaks W3C WebDriver over HTTP. */
export class AppiumServer {
  private child?: ChildProcess;
  private starting?: Promise<void>;
  private buffer = '';
  xcodeLog = '';
  constructor(
    private settings: () => Settings,
    private home: string,
  ) {}

  base() {
    return this.settings().appiumUrl.replace(/\/$/, '');
  }
  get isStarting() {
    return !!this.starting;
  }
  async request(
    route: string,
    method = 'GET',
    body?: unknown,
    timeout = 30000,
    signal?: AbortSignal,
  ): Promise<any> {
    const response = await fetch(this.base() + route, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
        : AbortSignal.timeout(timeout),
    });
    const json = (await response.json().catch(() => ({}))) as any;
    if (!response.ok || json.value?.error)
      throw new AppiumError(
        json.value?.message ?? `Appium HTTP ${response.status}`,
        json.value?.error,
      );
    return json.value;
  }
  async ready() {
    try {
      return !!(await this.request('/status', 'GET', undefined, 1500))?.ready;
    } catch {
      return false;
    }
  }
  async ensure() {
    if (await this.ready()) return;
    if (this.starting) return this.starting;
    this.starting = this.start().finally(() => (this.starting = undefined));
    return this.starting;
  }
  private async start() {
    const url = new URL(this.base());
    const modules = nodeModules();
    const home = await prepareAppiumRuntime(modules, this.home);
    const script = path.join(modules, 'appium/build/lib/main.js');
    const child = spawn(
      process.execPath,
      [
        script,
        '--address',
        url.hostname === 'localhost' ? '127.0.0.1' : url.hostname.replace(/[[\]]/g, ''),
        '--port',
        url.port || '80',
        '--base-path',
        url.pathname === '/' ? '' : url.pathname,
        '--log-level',
        'info',
      ],
      {
        env: { ...commandEnv, APPIUM_HOME: home, ELECTRON_RUN_AS_NODE: '1' },
        cwd: home,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    this.child = child;
    let failure = '';
    const collect = (b: Buffer) => {
      const text = b.toString().replace(/\x1b\[[0-9;]*m/g, '');
      failure = (failure + text).slice(-4000);
      this.buffer += text;
      for (const line of text.split('\n'))
        if (/error|warn|xcodebuild|wda|session/i.test(line) && line.trim())
          log('appium-out', line.trim().slice(0, 300));
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() ?? '';
      for (const line of lines)
        if (line.includes('[Xcode]')) this.xcodeLog = (this.xcodeLog + line + '\n').slice(-16000);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', (e) => (failure = e.message));
    for (let i = 0; i < 60; i++) {
      if (await this.ready()) return;
      if (child.exitCode !== null) break;
      await delay(500);
    }
    throw new AppiumError('Appium ne démarre pas : ' + failure, 'appium-start');
  }
  stop() {
    this.child?.kill();
  }
}
