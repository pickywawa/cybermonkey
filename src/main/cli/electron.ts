// Headless mode of the packaged app: `Cybermonkey --cli run …`. Same engine as the window, no window.
import { app } from 'electron';
import { electronCipher } from '../app/cipher.js';
import { paths } from '../infra/paths.js';
import { runCli } from './run.js';

/** The keychain is opt-in from the command line: a CI job must never wait for a permission window. */
let cipher: ReturnType<typeof electronCipher> | undefined;
const args = process.argv.slice(process.argv.indexOf('--cli') + 1);
app.dock?.hide();
paths.appRoot = app.getAppPath();
// Same data folder as the installed app: the CLI sees its projects and device pairings.
process.env.CYBERMONKEY_USER_DATA ??= app.getPath('userData');
process.env.CYBERMONKEY_VERSION = app.getVersion();

void app.whenReady().then(async () => {
  cipher = process.env.CYBERMONKEY_KEYCHAIN === '1' ? electronCipher() : undefined;
  let code: number;
  try {
    code = await runCli(args, undefined, cipher);
  } catch (error) {
    console.error('Erreur :', error);
    code = 2;
  }
  app.exit(code);
});
