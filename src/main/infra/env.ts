import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { nodeModules } from './paths.js';

// Finder-launched apps do not inherit the interactive shell PATH.
const extra = [
  path.join(os.homedir(), 'Library/Android/sdk/platform-tools'),
  path.join(os.homedir(), 'Android/Sdk/platform-tools'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
];
let javaHome = process.env.JAVA_HOME;
try {
  if (!javaHome && process.platform === 'darwin')
    javaHome = execFileSync('/usr/libexec/java_home', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
} catch {
  /* no JDK registered */
}
export const commandEnv: NodeJS.ProcessEnv = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME:
    process.env.ANDROID_HOME ??
    path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Android/sdk' : 'Android/Sdk'),
  PATH: [process.env.PATH, ...extra].filter(Boolean).join(path.delimiter),
};

export function command(
  file: string,
  args: string[],
  options: { timeout?: number; input?: string } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        env: commandEnv,
        timeout: options.timeout ?? 15000,
        maxBuffer: 24 * 1024 * 1024,
        encoding: 'buffer',
        windowsHide: true,
      },
      (error, stdout, stderr) =>
        error
          ? reject(new Error(`${file}: ${stderr.toString().trim() || error.message}`))
          : resolve(stdout),
    );
    if (options.input) child.stdin?.end(options.input);
  });
}
export const exists = (file: string) => existsSync(file);

const suffix = process.platform === 'win32' ? '.exe' : '';
const first = (candidates: string[], fallback: string) => candidates.find(existsSync) ?? fallback;

export function codexBinary(): string {
  const triple =
    process.platform === 'darwin'
      ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`
      : process.platform === 'win32'
        ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`
        : `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-musl`;
  const base = nodeModules();
  return first(
    [
      path.join(
        base,
        `@openai/codex-${process.platform}-${process.arch}`,
        'vendor',
        triple,
        'bin',
        `codex${suffix}`,
      ),
      path.join(base, '@openai/codex/vendor', triple, 'codex', `codex${suffix}`),
    ],
    `codex${suffix}`,
  );
}
export function copilotBinary(): string {
  const musl =
    process.platform === 'linux' &&
    process.report?.getReport &&
    !(process.report.getReport() as any).header.glibcVersionRuntime;
  return first(
    [
      path.join(
        nodeModules(),
        `@github/copilot-${musl ? 'linuxmusl' : process.platform}-${process.arch}`,
        `copilot${suffix}`,
      ),
    ],
    `copilot${suffix}`,
  );
}
/** Claude Code native binary shipped with the Agent SDK; falls back to a `claude` on PATH. */
export function claudeBinary(): string {
  const base = nodeModules();
  const names = [`${process.platform}-${process.arch}`, `${process.platform}-${process.arch}-musl`];
  return first(
    names.map((n) => path.join(base, `@anthropic-ai/claude-agent-sdk-${n}`, `claude${suffix}`)),
    `claude${suffix}`,
  );
}
