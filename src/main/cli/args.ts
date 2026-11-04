import { EXPORT_FORMATS, type ExportFormat } from '../../shared/domain/campaign-export.js';
import { REMOTE_PROVIDERS, type RemoteProvider } from '../../shared/domain/remote.js';

/** Exit codes: stable contract for CI pipelines. */
export const EXIT = {
  /** Every test passed. */
  OK: 0,
  /** At least one test failed: the application under test is at fault (or its tests are). */
  TESTS_FAILED: 1,
  /** Bad arguments, missing project/device/build, nothing could run: the infrastructure is at fault. */
  USAGE_OR_INFRA: 2,
  /** Timed out or interrupted (Ctrl+C, SIGTERM). */
  CANCELLED: 3,
} as const;

export interface RunOptions {
  project?: string;
  environment?: string;
  /** Operating systems to run; undefined = the project's own focus. */
  os?: ('android' | 'ios')[];
  androidDevice?: string;
  iosDevice?: string;
  androidApp?: string;
  iosApp?: string;
  /** Uninstall the application before installing the given build, so the test starts from a blank state. */
  fresh: boolean;
  scenario?: string;
  campaign?: string;
  out: string;
  formats: ExportFormat[];
  artifacts: boolean;
  prepare: 'off' | 'existing' | 'ai';
  timeoutS: number;
  quiet: boolean;
  /** Phones reached over the network (`host:port`), connected for this run on top of the saved ones. */
  adbHosts: string[];
  /** An application already uploaded to the device cloud (`bs://…`, `storage:…`, an ARN). */
  androidAppRef?: string;
  iosAppRef?: string;
}

export type RemoteAction = 'status' | 'test' | 'upload' | 'adb-connect' | 'adb-pair';

export type Command =
  | { name: 'help' }
  | { name: 'version' }
  | { name: 'projects'; dataDir?: string; json: boolean; adbHosts?: string[] }
  | { name: 'devices'; dataDir?: string; json: boolean; adbHosts?: string[] }
  | {
      name: 'remote';
      dataDir?: string;
      action: RemoteAction;
      provider?: RemoteProvider;
      positional: string[];
      platform?: 'android' | 'ios';
      adbHosts: string[];
      json: boolean;
    }
  | { name: 'run'; dataDir?: string; options: RunOptions };

export class UsageError extends Error {}

const VALUE_FLAGS = new Set([
  '--project',
  '--env',
  '--os',
  '--android-device',
  '--ios-device',
  '--android-app',
  '--ios-app',
  '--scenario',
  '--campaign',
  '--out',
  '--format',
  '--prepare',
  '--timeout',
  '--data-dir',
  '--adb-host',
  '--android-app-ref',
  '--ios-app-ref',
  '--platform',
]);
const BOOLEAN_FLAGS = new Set(['--fresh', '--artifacts', '--quiet', '--json']);

/** `--flag value`, `--flag=value` and boolean flags; anything else is a mistake worth reporting. */
function readFlags(args: string[]) {
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    let arg = args[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    let inline: string | undefined;
    const eq = arg.indexOf('=');
    if (arg.startsWith('--') && eq > 0) {
      inline = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }
    if (BOOLEAN_FLAGS.has(arg)) {
      if (inline !== undefined) throw new UsageError(`L’option ${arg} n’attend pas de valeur.`);
      booleans.add(arg);
    } else if (VALUE_FLAGS.has(arg)) {
      const value = inline ?? args[++i];
      if (value === undefined || (inline === undefined && value.startsWith('--')))
        throw new UsageError(`L’option ${arg} attend une valeur.`);
      values.set(arg, value);
    } else throw new UsageError(`Option inconnue : ${arg}`);
  }
  return { values, booleans, positional };
}

export function parseArgs(argv: string[]): Command {
  const [first, ...rest] = argv;
  if (!first || first === 'help' || first === '--help' || first === '-h') return { name: 'help' };
  if (first === 'version' || first === '--version' || first === '-v') return { name: 'version' };
  if (first !== 'run' && first !== 'devices' && first !== 'projects' && first !== 'remote')
    throw new UsageError(
      `Commande inconnue : ${first}. Commandes : run, devices, projects, remote.`,
    );
  if (rest.includes('--help') || rest.includes('-h')) return { name: 'help' };

  const { values, booleans, positional } = readFlags(rest);
  const dataDir = values.get('--data-dir');
  const adbHosts = (values.get('--adb-host') ?? '')
    .split(/[,;\s]+/)
    .map((h) => h.trim())
    .filter(Boolean);
  if (first === 'remote') {
    const [action, ...args] = positional;
    const actions = ['status', 'test', 'upload', 'adb-connect', 'adb-pair'] as const;
    if (!action || !(actions as readonly string[]).includes(action))
      throw new UsageError(`remote attend : ${actions.join(', ')}.`);
    for (const flag of [...values.keys(), ...booleans])
      if (!['--data-dir', '--json', '--platform', '--adb-host'].includes(flag))
        throw new UsageError(`L’option ${flag} n’existe pas pour « remote ».`);
    const platform = values.get('--platform');
    if (platform && platform !== 'android' && platform !== 'ios')
      throw new UsageError('--platform attend android ou ios.');
    let provider: RemoteProvider | undefined;
    let rest2 = args;
    if (action === 'test' || action === 'upload') {
      const name = args[0];
      if (!name || !(REMOTE_PROVIDERS as readonly string[]).includes(name))
        throw new UsageError(`${action} attend un fournisseur : ${REMOTE_PROVIDERS.join(', ')}.`);
      provider = name as RemoteProvider;
      rest2 = args.slice(1);
    }
    if (action === 'upload' && rest2.length !== 1)
      throw new UsageError('upload attend un fichier : remote upload <fournisseur> <fichier>.');
    if (action === 'adb-pair' && rest2.length !== 2)
      throw new UsageError('adb-pair attend : remote adb-pair <hôte:port> <code à 6 chiffres>.');
    if ((action === 'status' || action === 'test') && rest2.length)
      throw new UsageError(`Argument inattendu : ${rest2[0]}`);
    return {
      name: 'remote',
      dataDir,
      action: action as RemoteAction,
      provider,
      positional: rest2,
      platform: platform as 'android' | 'ios' | undefined,
      // `adb-connect host:port…` takes its hosts as arguments, the others through --adb-host.
      adbHosts: action === 'adb-connect' ? [...rest2, ...adbHosts] : adbHosts,
      json: booleans.has('--json'),
    };
  }
  if (positional.length) throw new UsageError(`Argument inattendu : ${positional[0]}`);
  if (first !== 'run') {
    for (const flag of [...values.keys(), ...booleans])
      if (flag !== '--data-dir' && flag !== '--json' && flag !== '--adb-host')
        throw new UsageError(`L’option ${flag} n’existe que pour « run ».`);
    return { name: first, dataDir, json: booleans.has('--json'), adbHosts } as Command;
  }
  if (booleans.has('--json'))
    throw new UsageError('L’option --json n’existe que pour « devices » et « projects ».');

  const osValue = values.get('--os');
  let os: RunOptions['os'];
  if (osValue) {
    if (osValue === 'all' || osValue === 'both') os = ['android', 'ios'];
    else if (osValue === 'android' || osValue === 'ios') os = [osValue];
    else throw new UsageError('--os attend android, ios ou all.');
  }
  const prepare = values.get('--prepare') ?? 'existing';
  if (prepare !== 'off' && prepare !== 'existing' && prepare !== 'ai')
    throw new UsageError('--prepare attend off, existing ou ai.');

  const formatValue = values.get('--format') ?? 'junit,html,json';
  const formats = [
    ...new Set(
      formatValue
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean),
    ),
  ];
  for (const f of formats)
    if (!(EXPORT_FORMATS as readonly string[]).includes(f))
      throw new UsageError(`Format inconnu : ${f}. Formats : ${EXPORT_FORMATS.join(', ')}.`);
  if (!formats.length) throw new UsageError('--format est vide.');

  const timeoutValue = values.get('--timeout');
  const timeoutS = timeoutValue === undefined ? 3600 : Number(timeoutValue);
  if (!Number.isInteger(timeoutS) || timeoutS < 10)
    throw new UsageError('--timeout attend un nombre entier de secondes (10 minimum).');

  // A build for an OS that is not run would be installed for nothing: flag the mistake instead of hiding it.
  const androidApp = values.get('--android-app');
  const iosApp = values.get('--ios-app');
  if (os && androidApp && !os.includes('android'))
    throw new UsageError('--android-app est donné mais --os exclut Android.');
  if (os && iosApp && !os.includes('ios'))
    throw new UsageError('--ios-app est donné mais --os exclut iOS.');

  return {
    name: 'run',
    dataDir,
    options: {
      project: values.get('--project'),
      environment: values.get('--env'),
      os,
      androidDevice: values.get('--android-device'),
      iosDevice: values.get('--ios-device'),
      androidApp,
      iosApp,
      fresh: booleans.has('--fresh'),
      scenario: values.get('--scenario'),
      campaign: values.get('--campaign'),
      out: values.get('--out') ?? 'cybermonkey-report',
      formats: formats as ExportFormat[],
      artifacts: booleans.has('--artifacts'),
      prepare,
      timeoutS,
      quiet: booleans.has('--quiet'),
      adbHosts,
      androidAppRef: values.get('--android-app-ref'),
      iosAppRef: values.get('--ios-app-ref'),
    },
  };
}

export const HELP = `Cybermonkey en ligne de commande (intégration CI/CD)

Usage :
  cybermonkey run [options]       Lance une campagne sans interface et écrit les rapports
  cybermonkey devices [--json]    Liste les appareils détectés
  cybermonkey projects [--json]   Liste les projets connus
  cybermonkey remote <action>     Appareils distants : status, test, upload, adb-connect, adb-pair

Options de « run » :
  --project <nom|id>        Projet (défaut : le projet actif de l’application)
  --env <nom|id>            Environnement (recette, préprod…) pour cette exécution
  --os <android|ios|all>    OS à exécuter (défaut : le choix du projet)
  --android-device <id>     Appareil Android (défaut : l’appareil associé au projet, sinon le seul prêt)
  --ios-device <id>         Appareil iOS (idem)
  --android-app <fichier>   APK à installer avant le test
  --ios-app <fichier>       .app (simulateur) ou .ipa (iPhone) à installer avant le test
  --fresh                   Désinstalle l’application avant d’installer (départ sans données)
  --scenario <nom|id>       Un seul scénario au lieu de tout le projet
  --campaign <libellé>      Nom de la campagne créée (défaut : « CI <date> »)
  --out <dossier>           Dossier des rapports (défaut : ./cybermonkey-report)
  --format <liste>          Formats séparés par des virgules : text, csv, markdown, confluence, html, junit, json
                            (défaut : junit,html,json)
  --artifacts               Copie aussi captures et vidéos de la campagne dans <dossier>/campaign
  --prepare <off|existing|ai>  Accès à l’écran de départ (défaut : existing, sans IA)
  --timeout <secondes>      Durée maximale (défaut : 3600)
  --data-dir <dossier>      Données Cybermonkey (défaut : celles de l’application installée)
  --adb-host <hôte:port>    Téléphone Android joint par le réseau (adb connect), en plus de ceux des réglages
                            (plusieurs : séparés par des virgules)
  --android-app-ref <réf>   Application Android déjà envoyée au cloud (bs://…, storage:…, ARN)
  --ios-app-ref <réf>       Idem pour iOS
  --quiet                   Seulement le résumé final

Appareils distants (cloud) : --android-device / --ios-device acceptent l’identifiant « remote:<id> » (voir « devices »)
ou le nom du profil. Avec --android-app / --ios-app, le build est envoyé au fournisseur au lieu d’être installé.

remote :
  remote status                       Fournisseurs prêts, téléphones ADB réseau
  remote test <fournisseur>           Vérifie les identifiants (browserstack, saucelabs, devicefarm, appium)
  remote upload <fournisseur> <fichier> [--platform android|ios]
                                      Envoie un .apk / .ipa et affiche sa référence (seule sur la sortie standard)
  remote adb-connect [hôte:port…]     Connecte des téléphones Android par le réseau
  remote adb-pair <hôte:port> <code>  Appairage Android 11+ (débogage sans fil)

Codes de sortie :
  0  tous les tests ont réussi
  1  au moins un test a échoué
  2  erreur d’usage ou d’infrastructure (projet, appareil, build introuvable, rien n’a pu s’exécuter)
  3  délai dépassé ou exécution interrompue

Exemple :
  cybermonkey run --project "Atlas Mobile" --env recette \\
    --android-app build/app-debug.apk --fresh --out reports
`;
