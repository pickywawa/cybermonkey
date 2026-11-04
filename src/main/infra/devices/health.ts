import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Device, DeviceCheck, DeviceHealth } from '../../../shared/domain/devices.js';
import type { Settings } from '../../../shared/domain/settings.js';
import type { Automation } from '../appium/automation.js';
import type { AppiumServer } from '../appium/server.js';
import { failureComponent, NON_MAC_DOC, WDA_PROVISIONING_DOC } from '../appium/ios-config.js';
import { command, commandEnv } from '../env.js';
import { nodeModules } from '../paths.js';

/** Step-by-step readiness checks that tell the user exactly what to fix, and how. */
export class DeviceDiagnostics {
  private probes = new Map<string, { time: number; task: Promise<string> }>();
  constructor(
    private automation: Automation,
    private server: AppiumServer,
    private settings: () => Settings,
  ) {}

  private probe(name: string, args: string[]) {
    const old = this.probes.get(name + args.join());
    if (old && Date.now() - old.time < 30000) return old.task;
    const task = command(name, args, { timeout: 6000 }).then(
      (b) => b.toString().trim().split('\n')[0] || 'OK',
    );
    void task.catch(() => {});
    this.probes.set(name + args.join(), { time: Date.now(), task });
    return task;
  }

  async health(device: Device | undefined, id: string): Promise<DeviceHealth> {
    const settings = this.settings();
    const t = (fr: string, en: string) => (settings.language === 'en' ? en : fr);
    const checks: DeviceCheck[] = [];
    const add = (c: DeviceCheck) => checks.push(c);
    const state = this.automation.connectionState(id);
    const ios = device?.platform === 'ios' || id.startsWith('ios:') || id.startsWith('sim:');

    add({
      id: 'connection',
      label: ios ? 'iPhone / Simulator' : 'ADB / USB',
      state:
        !device || device.status !== 'ready'
          ? 'error'
          : device.kind === 'manual' && !state.connected
            ? 'unknown'
            : 'ok',
      detail:
        device?.detail ??
        t('Appareil absent du dernier relevé.', 'Device missing from the last scan.'),
      fix:
        device?.status === 'unauthorized'
          ? t(
              'Déverrouillez le téléphone et acceptez « Autoriser le débogage USB ».',
              'Unlock the phone and accept “Allow USB debugging”.',
            )
          : t(
              'Branchez et déverrouillez l’appareil, acceptez la confiance, puis actualisez.',
              'Connect and unlock the device, accept trust, then refresh.',
            ),
    });

    const appium = await this.server.ready();
    add({
      id: 'appium',
      label: 'Appium',
      state: appium ? 'ok' : state.starting ? 'pending' : 'error',
      detail: appium
        ? t('Serveur joignable : ', 'Server reachable: ') + settings.appiumUrl
        : t('Le serveur ne répond pas.', 'The server is not responding.'),
      fix: t(
        'Cliquez « Reconnecter » : le serveur local démarre au besoin. Vérifiez l’adresse dans Paramètres → Appareils.',
        'Click “Reconnect”: the local server starts when needed. Check the URL in Settings → Devices.',
      ),
    });

    const pkgName = ios ? 'appium-xcuitest-driver' : 'appium-uiautomator2-driver';
    try {
      const pkg = JSON.parse(
        await fs.readFile(path.join(nodeModules(), pkgName, 'package.json'), 'utf8'),
      );
      add({
        id: 'driver',
        label: ios ? 'XCUITest' : 'UiAutomator2',
        state: 'ok',
        detail: t('Pilote inclus · version ', 'Bundled driver · version ') + pkg.version,
      });
    } catch {
      add({
        id: 'driver',
        label: ios ? 'XCUITest' : 'UiAutomator2',
        state: 'error',
        detail: t('Pilote introuvable.', 'Driver not found.'),
        fix: t(
          'Réinstallez Cybermonkey (en développement : npm ci).',
          'Reinstall Cybermonkey (in development: npm ci).',
        ),
        command: 'npm ci',
      });
    }

    if (ios) {
      if (state.connected && state.sessionId)
        try {
          const locked = await this.server.request(
            `/session/${state.sessionId}/execute/sync`,
            'POST',
            { script: 'mobile: isLocked', args: [] },
            3000,
          );
          if (typeof locked === 'boolean')
            add({
              id: 'lock',
              label: t('Écran iPhone', 'iPhone screen'),
              state: locked ? 'error' : 'ok',
              detail: locked
                ? t('iPhone verrouillé.', 'iPhone locked.')
                : t('iPhone déverrouillé.', 'iPhone unlocked.'),
              fix: t(
                'Déverrouillez l’iPhone. Pour la QA : Réglages → Affichage → Verrouillage auto → Jamais.',
                'Unlock the iPhone. For QA: Settings → Display → Auto-Lock → Never.',
              ),
            });
        } catch {
          /* optional */
        }
      if (settings.iosKeepAwake && device?.kind !== 'simulator') {
        const k = state.keepAwake;
        add({
          id: 'keep-awake',
          label: t('Maintien éveillé · expérimental', 'Keep awake · experimental'),
          state:
            k?.state === 'error' || k?.state === 'locked'
              ? 'error'
              : k?.state === 'active'
                ? 'ok'
                : k?.state === 'paused'
                  ? 'unknown'
                  : 'pending',
          detail:
            k?.state === 'active'
              ? t('Dernière interaction : ', 'Last activity: ') + k.lastActivity
              : k?.state === 'locked'
                ? t('iPhone verrouillé : rien envoyé.', 'iPhone locked: nothing sent.')
                : k?.state === 'error'
                  ? (k.detail ?? '')
                  : t('En attente d’une session WDA.', 'Waiting for a WDA session.'),
          fix: t(
            'Désactivez cette option si les boutons de volume gênent votre application.',
            'Turn this off if volume buttons interfere with your app.',
          ),
        });
      }
      const mode = settings.iosWdaMode;
      if (mode === 'build') {
        if (process.platform !== 'darwin')
          add({
            id: 'xcode',
            label: 'Xcode',
            state: 'error',
            detail: t('La compilation WDA nécessite macOS.', 'Building WDA requires macOS.'),
            fix: t(
              'Choisissez WDA préinstallé ou externe (iOS 18+ et RemoteXPC).',
              'Choose preinstalled or external WDA (iOS 18+ and RemoteXPC).',
            ),
            documentation: NON_MAC_DOC,
          });
        else
          try {
            add({
              id: 'xcode',
              label: 'Xcode',
              state: 'ok',
              detail: await this.probe('xcodebuild', ['-version']),
            });
          } catch (e) {
            add({
              id: 'xcode',
              label: 'Xcode',
              state: 'error',
              detail: String(e),
              fix: t(
                'Installez Xcode, ouvrez-le une fois, puis sélectionnez ses outils en ligne de commande.',
                'Install Xcode, open it once, then select its command line tools.',
              ),
              command:
                'sudo xcode-select -s /Applications/Xcode.app/Contents/Developer && sudo xcodebuild -runFirstLaunch',
            });
          }
        if (device?.kind !== 'simulator') {
          const configured = !!(
            settings.iosWdaBundleId &&
            (settings.iosXcodeConfigFile || settings.iosTeamId)
          );
          const validTeam = !settings.iosTeamId || /^[A-Z0-9]{10}$/.test(settings.iosTeamId);
          const configExists =
            !settings.iosXcodeConfigFile ||
            (await fs.access(settings.iosXcodeConfigFile).then(
              () => true,
              () => false,
            ));
          add({
            id: 'signing',
            label: t('Signature WDA', 'WDA signing'),
            state: state.connected
              ? 'ok'
              : configured && validTeam && configExists
                ? 'unknown'
                : 'error',
            detail: state.connected
              ? t(
                  'Session WDA établie avec ces réglages.',
                  'WDA session established with these settings.',
                )
              : !configured
                ? t(
                    'Team ID (ou xcconfig) et Bundle ID WDA à renseigner.',
                    'Team ID (or xcconfig) and WDA Bundle ID required.',
                  )
                : !validTeam
                  ? t(
                      'Team ID invalide (10 caractères A-Z/0-9).',
                      'Invalid Team ID (10 chars A-Z/0-9).',
                    )
                  : !configExists
                    ? t('Fichier xcconfig introuvable.', 'xcconfig file not found.')
                    : t(
                        'Un champ renseigné ne prouve pas qu’un profil valide est installé.',
                        'A filled field does not prove a valid profile is installed.',
                      ),
            fix: t(
              'Paramètres → Appareils : Bundle ID WDA autorisé par votre équipe, profil Development couvrant base + .xctrunner et cet iPhone, compte Apple ajouté dans Xcode.',
              'Settings → Devices: WDA Bundle ID allowed by your team, Development profile covering base + .xctrunner and this iPhone, Apple account added in Xcode.',
            ),
            documentation: WDA_PROVISIONING_DOC,
          });
        }
      } else
        add({
          id: 'signing',
          label: t('WDA préparé', 'Prepared WDA'),
          state: state.connected ? 'ok' : 'unknown',
          detail:
            mode === 'preinstalled'
              ? t(
                  'WDA doit déjà être installé et signé sur l’iPhone.',
                  'WDA must already be installed and signed on the iPhone.',
                )
              : t(
                  'WDA doit tourner et son adresse correspondre à l’UDID.',
                  'WDA must be running and its URL match the UDID.',
                ),
          fix: t(
            'Vérifiez le mode WDA, le Bundle ID et l’UDID dans Paramètres → Appareils.',
            'Check WDA mode, Bundle ID and UDID in Settings → Devices.',
          ),
          documentation: NON_MAC_DOC,
        });
      if (device?.ddiReady !== undefined)
        add({
          id: 'ddi',
          label: t('Préparation iOS', 'iOS preparation'),
          state: device.ddiReady ? 'ok' : 'error',
          detail: device.ddiReady
            ? t('Services développeur disponibles.', 'Developer services available.')
            : t('Image développeur (DDI) non montée.', 'Developer disk image (DDI) not mounted.'),
          fix: t(
            'Déverrouillez l’iPhone, ouvrez Xcode → Window → Devices and Simulators et attendez la fin de la préparation.',
            'Unlock the iPhone, open Xcode → Window → Devices and Simulators and wait for preparation to finish.',
          ),
        });
      if (device?.developerMode && device.developerMode !== 'enabled')
        add({
          id: 'developer-mode',
          label: t('Mode développeur', 'Developer Mode'),
          state: 'error',
          detail: t('Désactivé sur l’iPhone.', 'Disabled on the iPhone.'),
          fix: t(
            'Réglages → Confidentialité et sécurité → Mode développeur → activer, puis redémarrer.',
            'Settings → Privacy & Security → Developer Mode → enable, then restart.',
          ),
        });
    } else {
      try {
        const adb = await this.probe('adb', ['version']);
        await this.probe('java', ['-version']).catch(() => {
          throw new Error(t('JDK introuvable (JAVA_HOME).', 'JDK not found (JAVA_HOME).'));
        });
        await fs.access(commandEnv.ANDROID_HOME ?? '');
        add({ id: 'environment', label: 'ADB / JDK / SDK', state: 'ok', detail: adb });
      } catch (e) {
        add({
          id: 'environment',
          label: 'ADB / JDK / SDK',
          state: 'error',
          detail: String(e).replace(/^Error: /, ''),
          fix: t(
            'Installez Android Platform Tools et un JDK, puis relancez Cybermonkey (JAVA_HOME / ANDROID_HOME).',
            'Install Android Platform Tools and a JDK, then restart Cybermonkey (JAVA_HOME / ANDROID_HOME).',
          ),
          command: 'brew install --cask android-platform-tools temurin',
        });
      }
    }

    add({
      id: 'agent',
      label: ios ? 'WebDriverAgent' : 'UiAutomator2',
      state: state.connected ? 'ok' : state.connecting ? 'pending' : 'error',
      detail: state.connected
        ? t('Session native établie.', 'Native session established.')
        : state.connecting
          ? t('Connexion en cours…', 'Connecting…')
          : t('Aucune session native prête.', 'No native session ready.'),
      fix: t(
        'Corrigez les lignes rouges puis « Reconnecter ».',
        'Fix the red rows, then “Reconnect”.',
      ),
    });
    if (state.failure) {
      const target =
        checks.find((c) => c.id === failureComponent(state.failure!)) ??
        checks.find((c) => c.id === 'agent')!;
      target.state = 'error';
      target.log = state.failure;
      target.detail +=
        '\n' + t('Dernier échec : ', 'Last failure: ') + state.failure.split('\n')[0];
    }
    return { deviceId: id, checkedAt: new Date().toISOString(), checks };
  }
}
