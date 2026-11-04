import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EXPORT_EXTENSIONS, campaignExport } from '../../shared/domain/campaign-export.js';
import type { Device } from '../../shared/domain/devices.js';
import { activeOs, type Project } from '../../shared/domain/project.js';
import type { RunEntry } from '../../shared/domain/report.js';
import { flatten, type OS } from '../../shared/domain/scenario.js';
import type { LiveEvent } from '../../shared/ipc.js';
import { createContainer, type Container } from '../container.js';
import { paths } from '../infra/paths.js';
import type { Cipher } from '../integrations/secrets.js';
import { EXIT, HELP, UsageError, parseArgs, type Command, type RunOptions } from './args.js';
import { installBuild } from './install.js';
import { countable, verdictOf } from './outcome.js';

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}
export const consoleIo: Io = {
  out: (line) => process.stdout.write(line + '\n'),
  err: (line) => process.stderr.write(line + '\n'),
};

/** Where the installed desktop app keeps its data, so the CLI sees the same projects and device pairings. */
export function defaultDataDir(env = process.env, platform = process.platform) {
  if (env.CYBERMONKEY_USER_DATA) return env.CYBERMONKEY_USER_DATA;
  if (platform === 'darwin')
    return path.join(os.homedir(), 'Library', 'Application Support', 'Cybermonkey');
  if (platform === 'win32')
    return path.join(env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Cybermonkey');
  return path.join(env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'Cybermonkey');
}

class InfraError extends Error {}

/** Exact id or case-insensitive exact name; ambiguity is an error, never a silent pick. */
export function pick<T extends { id: string }>(
  items: T[],
  query: string,
  name: (item: T) => string,
  what: string,
): T {
  const byId = items.find((i) => i.id === query);
  if (byId) return byId;
  const wanted = query.trim().toLowerCase();
  const matches = items.filter((i) => name(i).trim().toLowerCase() === wanted);
  if (matches.length === 1) return matches[0];
  const known = items.map((i) => `« ${name(i)} »`).join(', ') || 'aucun';
  throw new InfraError(
    matches.length > 1
      ? `${what} « ${query} » est ambigu (${matches.length} correspondances) : utilisez son identifiant.`
      : `${what} « ${query} » introuvable. Connus : ${known}.`,
  );
}

async function open(dataDir: string | undefined, emit: (e: LiveEvent) => void, cipher?: Cipher) {
  const userData = path.resolve(dataDir ?? defaultDataDir());
  paths.userData = userData;
  paths.documents = path.join(os.homedir(), 'Documents');
  const container = await createContainer({
    userData,
    documents: paths.documents,
    emit,
    cipher,
    interactive: false,
    openAuthUrl: async () => {
      throw new Error(
        'Connexion IA impossible en ligne de commande : connectez-vous dans l’application.',
      );
    },
  });
  return container;
}

/** Devices to use, per OS: explicit flag, else the one paired to the project, else the only ready one. */
export function chooseDevices(
  project: Project,
  platforms: OS[],
  known: Device[],
  flags: Partial<Record<OS, string>>,
): Record<OS, Device | undefined> {
  const chosen: Record<OS, Device | undefined> = { android: undefined, ios: undefined };
  for (const platform of platforms) {
    const label = platform === 'ios' ? 'iOS' : 'Android';
    const ofOs = known.filter((d) => d.platform === platform);
    const wanted = flags[platform] ?? project.deviceIds[platform];
    let device: Device | undefined;
    if (wanted) {
      device = ofOs.find((d) => d.id === wanted || d.name.toLowerCase() === wanted.toLowerCase());
      if (!device)
        throw new InfraError(
          `Appareil ${label} « ${wanted} » non détecté. Détectés : ${ofOs.map((d) => `${d.name} (${d.id})`).join(', ') || 'aucun'}.`,
        );
    } else {
      const ready = ofOs.filter((d) => d.status === 'ready');
      if (ready.length > 1)
        throw new InfraError(
          `Plusieurs appareils ${label} prêts : précisez --${platform}-device (${ready.map((d) => d.id).join(', ')}).`,
        );
      device = ready[0];
      if (!device) throw new InfraError(`Aucun appareil ${label} prêt.`);
    }
    if (device.status !== 'ready')
      throw new InfraError(
        `${device.name} n’est pas prêt (${
          device.kind === 'cloud' || device.kind === 'network'
            ? device.detail
            : device.status === 'unauthorized'
              ? 'non autorisé : acceptez le débogage USB'
              : 'hors ligne'
        }).`,
      );
    chosen[platform] = device;
  }
  return chosen;
}

const symbols: Record<string, string> = {
  passed: '✔',
  failed: '✘',
  skipped: '–',
  blocked: '!',
  cancelled: '–',
  na: '–',
};

function progressPrinter(io: Io, quiet: boolean) {
  const printed = new Set<string>();
  return (event: LiveEvent) => {
    if (quiet || event.type !== 'run') return;
    for (const e of event.report.entries as RunEntry[]) {
      if (printed.has(e.id) || !e.finishedAt || e.status === 'running' || !countable(e)) continue;
      printed.add(e.id);
      const status = e.outcome ?? e.status;
      const seconds = (Date.parse(e.finishedAt) - Date.parse(e.startedAt)) / 1000;
      const detail =
        status === 'passed' ? '' : ` — ${e.message.replace(/\s+/g, ' ').slice(0, 160)}`;
      io.out(
        `  ${symbols[status] ?? '?'} [${e.platform}] ${e.nodeName} (${seconds.toFixed(1)} s)${e.flaky ? ' ⚠ instable' : ''}${detail}`,
      );
    }
  };
}

async function writeReports(c: Container, project: Project, campaignId: string, o: RunOptions) {
  const detail = await c.runner.loadCampaign(project.id, campaignId);
  const out = path.resolve(o.out);
  await fs.mkdir(out, { recursive: true });
  const written: string[] = [];
  for (const format of o.formats) {
    const [extension] = EXPORT_EXTENSIONS[format];
    // junit.xml, html.html would be silly: the format name is the file name except for the extension.
    const file = path.join(out, `${format}.${extension}`);
    await fs.writeFile(file, campaignExport(detail, format, project), 'utf8');
    written.push(file);
  }
  if (o.artifacts) {
    const source = path.join(project.directory, 'campaigns', campaignId);
    const target = path.join(out, 'campaign');
    await fs.rm(target, { recursive: true, force: true });
    await fs.cp(source, target, { recursive: true });
    written.push(target);
  }
  return { detail, written };
}

/** Phones reached over the network: the saved ones plus `--adb-host`, connected now (a CI has no monitor to do it). */
async function connectAdb(c: Container, extra: string[], say: (line: string) => void) {
  const remote = c.settings().remote;
  remote.adb.hosts = [...new Set([...remote.adb.hosts, ...extra])];
  if (!remote.adb.hosts.length) return;
  say(`ADB réseau : connexion à ${remote.adb.hosts.join(', ')}`);
  for (const r of await c.remote.adb.connectNow(remote.adb.hosts))
    if (!r.ok) say(`  ⚠ ${r.host} : ${r.detail}`);
}

async function remoteCommand(
  command: Extract<Command, { name: 'remote' }>,
  c: Container,
  io: Io,
): Promise<number> {
  const log = (line: string) => io.err(line);
  if (command.action === 'status') {
    await connectAdb(c, command.adbHosts, log);
    await c.devices.scan();
    const listed = new Map(
      [...c.devices.known.values()]
        .filter((d) => d.id.startsWith('android:'))
        .map((d) => [d.id.slice(8), d.status === 'ready' ? ('device' as const) : d.status]),
    );
    const status = await c.remote.status(listed);
    io.out(
      command.json
        ? JSON.stringify(status, null, 2)
        : [
            ...Object.entries(status.providers).map(
              ([name, p]) => `${name}  ${p.ready ? 'prêt' : 'incomplet : ' + p.missing}`,
            ),
            ...status.adb.map((a) => `adb ${a.host}  ${a.state}  ${a.detail}`),
          ].join('\n'),
    );
    return EXIT.OK;
  }
  if (command.action === 'test') {
    const result = await c.remote.test(command.provider!);
    (result.ok ? io.out : io.err)(result.message);
    return result.ok ? EXIT.OK : EXIT.USAGE_OR_INFRA;
  }
  if (command.action === 'upload') {
    const file = path.resolve(command.positional[0]);
    const platform = command.platform ?? (file.toLowerCase().endsWith('.apk') ? 'android' : 'ios');
    log(`Envoi de ${path.basename(file)} (${platform}) vers ${command.provider}…`);
    // The reference alone on stdout: `REF=$(cybermonkey remote upload browserstack app.apk)`.
    io.out(await c.remote.upload(command.provider!, platform, file));
    return EXIT.OK;
  }
  if (command.action === 'adb-pair') {
    const result = await c.remote.adb.pair(command.positional[0], command.positional[1]);
    (result.ok ? io.out : io.err)(result.message);
    return result.ok ? EXIT.OK : EXIT.USAGE_OR_INFRA;
  }
  // adb-connect
  const hosts = command.adbHosts.length ? command.adbHosts : c.settings().remote.adb.hosts;
  if (!hosts.length)
    throw new InfraError(
      'Aucun hôte : remote adb-connect <hôte:port> ou les réglages (Appareils distants).',
    );
  const results = await c.remote.adb.connectNow(hosts);
  for (const r of results) io.out(`${r.ok ? '✔' : '✘'} ${r.host}  ${r.detail}`);
  return results.some((r) => r.ok) ? EXIT.OK : EXIT.USAGE_OR_INFRA;
}

async function execute(o: RunOptions, c: Container, io: Io): Promise<number> {
  const say = (line: string) => !o.quiet && io.out(line);
  const projects = c.store.state.projects;
  if (!projects.length)
    throw new InfraError('Aucun projet. Créez-en un dans l’application, ou utilisez --data-dir.');
  const project = o.project
    ? pick(projects, o.project, (p) => p.name, 'Le projet')
    : projects.find((p) => p.id === c.store.state.activeProjectId);
  if (!project)
    throw new InfraError(
      `Précisez --project. Projets : ${projects.map((p) => `« ${p.name} »`).join(', ')}.`,
    );

  // In memory only: a CI run must not change which environment the user has selected in the app.
  if (o.environment) {
    const env = pick(project.environments, o.environment, (e) => e.name, 'L’environnement');
    c.store.get(project.id).activeEnvironmentId = env.id;
  }
  const platforms = o.os ?? activeOs(project);
  for (const p of platforms)
    if (!project.platforms.includes(p))
      throw new InfraError(`Le projet « ${project.name} » ne cible pas ${p}.`);

  let nodeId: string | undefined;
  if (o.scenario) {
    const scenarios = flatten(project.nodes).filter((n) => n.kind === 'scenario');
    nodeId = pick(scenarios, o.scenario, (n) => n.name, 'Le scénario').id;
  }

  await connectAdb(c, o.adbHosts, say);
  const scan = await c.devices.scan();
  const chosen = chooseDevices(project, platforms, scan.devices, {
    android: o.androidDevice,
    ios: o.iosDevice,
  });

  const refs: Partial<Record<OS, string | undefined>> = {
    android: o.androidAppRef,
    ios: o.iosAppRef,
  };
  for (const platform of platforms) {
    const ref = refs[platform];
    if (!ref) continue;
    const remote = chosen[platform]?.remote;
    if (!remote)
      throw new InfraError(
        `--${platform}-app-ref ne s’applique qu’à un appareil distant (cloud) : ${chosen[platform]?.name} est local.`,
      );
    c.remote.setAppOverride(remote.provider, platform, ref);
  }
  const builds: Partial<Record<OS, string | undefined>> = { android: o.androidApp, ios: o.iosApp };
  for (const platform of platforms) {
    const build = builds[platform];
    if (!build) continue;
    say(`Installation du build ${platform}`);
    try {
      await installBuild(
        chosen[platform]!,
        path.resolve(build),
        project.applications[platform],
        o.fresh,
        say,
        undefined,
        c.remote,
      );
    } catch (error) {
      throw new InfraError(error instanceof Error ? error.message : String(error));
    }
  }
  if (o.fresh && !o.androidApp && !o.iosApp)
    io.err('Avertissement : --fresh n’a d’effet qu’avec --android-app ou --ios-app.');

  const label = o.campaign ?? `CI ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  const campaign = await c.campaigns.create(project.id, label);
  const deviceIds = platforms.map((p) => chosen[p]!.id);
  say(
    `Campagne « ${label} » · ${project.name}${o.environment ? ` · ${o.environment}` : ''} · ${platforms
      .map((p) => `${p}: ${chosen[p]!.name}`)
      .join(', ')}`,
  );

  const runStartedAt = Date.now();
  const started = await c.runner.start({
    projectId: project.id,
    campaignId: campaign.id,
    platforms,
    deviceIds,
    nodeId,
    preparation: o.prepare,
  });

  let cancelled = false;
  const interrupt = () => {
    cancelled = true;
    c.runner.cancel();
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const finished = await c.runner.waitForRun(started.id, o.timeoutS * 1000);
    if (!finished) {
      cancelled = true;
      io.err(`Délai de ${o.timeoutS} s dépassé : exécution annulée.`);
      c.runner.cancel();
      await c.runner.stop();
    }
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }

  // Notifications, tickets and result push start when the run ends: let them finish before the process exits.
  await c.integrations.settled();
  const sinceIso = new Date(runStartedAt).toISOString();
  for (const e of c.integrations.journal.list().reverse())
    if (e.at >= sinceIso && (!o.quiet || !e.ok))
      io.out(`  ${e.ok ? '↗' : '⚠'} [${e.target}] ${e.message}`);

  const report = c.runner.getReport(started.id);
  if (!report) throw new InfraError('Rapport introuvable après l’exécution.');
  const verdict = verdictOf(report, cancelled);
  const { written } = await writeReports(c, project, campaign.id, o);

  io.out('');
  io.out(
    `Résultat : ${verdict.passed} réussi(s), ${verdict.failed} en échec` +
      (verdict.flaky ? `, ${verdict.flaky} instable(s)` : '') +
      (verdict.notRun ? `, ${verdict.notRun} non exécuté(s)` : '') +
      ` — ${verdict.reason}`,
  );
  for (const file of written) io.out(`  rapport : ${file}`);
  return verdict.code;
}

/** Entry point shared by the standalone Node launcher and the packaged app's `--cli` mode. Returns the exit code. */
export async function runCli(argv: string[], io: Io = consoleIo, cipher?: Cipher): Promise<number> {
  let command: Command;
  try {
    command = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.err(error.message);
    io.err('Aide : cybermonkey --help');
    return EXIT.USAGE_OR_INFRA;
  }
  if (command.name === 'help') {
    io.out(HELP);
    return EXIT.OK;
  }
  if (command.name === 'version') {
    io.out(process.env.CYBERMONKEY_VERSION ?? 'inconnue');
    return EXIT.OK;
  }

  let container: Container | undefined;
  try {
    const printer = progressPrinter(io, command.name === 'run' && command.options.quiet);
    container = await open(command.dataDir, command.name === 'run' ? printer : () => {}, cipher);
    const c = container;
    if (command.name === 'projects') {
      const list = c.store.state.projects.map((p) => ({
        id: p.id,
        name: p.name,
        platforms: p.platforms,
        environments: p.environments.map((e) => e.name),
      }));
      io.out(
        command.json
          ? JSON.stringify(list, null, 2)
          : list.map((p) => `${p.name}  (${p.id})  ${p.platforms.join('+')}`).join('\n') ||
              'Aucun projet.',
      );
      return EXIT.OK;
    }
    if (command.name === 'remote') return await remoteCommand(command, c, io);
    if (command.name === 'devices') {
      await connectAdb(c, command.adbHosts ?? [], (line) => io.err(line));
      const scan = await c.devices.scan();
      io.out(
        command.json
          ? JSON.stringify(scan, null, 2)
          : scan.devices
              .map((d) => `${d.id}  ${d.platform}  ${d.status}  ${d.name}  (${d.kind})`)
              .join('\n') || 'Aucun appareil détecté.',
      );
      return EXIT.OK;
    }
    return await execute(command.options, c, io);
  } catch (error) {
    io.err(
      error instanceof InfraError || error instanceof Error
        ? `Erreur : ${error.message}`
        : String(error),
    );
    return EXIT.USAGE_OR_INFRA;
  } finally {
    await container?.stop().catch(() => {});
  }
}
