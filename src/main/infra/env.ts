import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { nodeModules } from './paths.js';

const windows = process.platform === 'win32';
/** Where the Android SDK usually lives: Android Studio's default, per OS. */
const sdkCandidates = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  windows && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : '',
  path.join(os.homedir(), 'Library/Android/sdk'),
  path.join(os.homedir(), 'Android/Sdk'),
].filter((p): p is string => !!p);
const androidHome = sdkCandidates.find((p) => existsSync(p)) ?? sdkCandidates[0];
// GUI-launched apps do not inherit the interactive shell PATH.
const extra = [
  ...sdkCandidates.map((p) => path.join(p, 'platform-tools')),
  ...(windows
    ? [
        // Common install places of adb / a JDK when PATH was not set up by the user.
        path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Android', 'platform-tools'),
        path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs'),
      ]
    : ['/opt/homebrew/bin', '/usr/local/bin']),
];
/** JDK to give Appium's Android driver when JAVA_HOME is not set: Android Studio's bundled one, then common JDK folders. */
function windowsJavaHome(): string | undefined {
  const programs = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    'C:\\Program Files',
  ].filter((p): p is string => !!p);
  const direct = programs.map((p) => path.join(p, 'Android', 'Android Studio', 'jbr'));
  const found = direct.find((p) => existsSync(path.join(p, 'bin', 'java.exe')));
  if (found) return found;
  for (const vendor of [
    'Eclipse Adoptium',
    'Microsoft',
    'Java',
    'Zulu',
    'Amazon Corretto',
    'BellSoft',
  ])
    for (const base of programs) {
      const folder = path.join(base, vendor);
      try {
        const jdk = readdirSync(folder)
          .filter((n) => /jdk|jre/i.test(n) && existsSync(path.join(folder, n, 'bin', 'java.exe')))
          .sort()
          .at(-1);
        if (jdk) return path.join(folder, jdk);
      } catch {
        /* folder absent */
      }
    }
  return undefined;
}
let javaHome = process.env.JAVA_HOME;
try {
  if (!javaHome && windows) javaHome = windowsJavaHome();
  if (!javaHome && process.platform === 'darwin')
    javaHome = execFileSync('/usr/libexec/java_home', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
} catch {
  /* no JDK registered */
}
// Windows names the variable `Path`: writing `PATH` next to it would give the child two competing entries.
const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
export const commandEnv: NodeJS.ProcessEnv = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: androidHome,
  [pathKey]: [process.env[pathKey], ...extra].filter(Boolean).join(path.delimiter),
};

export function command(
  file: string,
  args: string[],
  options: { timeout?: number; input?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        env: { ...commandEnv, ...options.env },
        cwd: options.cwd,
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
