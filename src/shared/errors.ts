/** Errors crossing the IPC boundary carry a stable code so the UI can translate and help. */
export interface AppErrorInfo {
  code: ErrorCode;
  title: string;
  detail: string;
  hint?: string;
  docs?: string;
  raw: string;
}
export type ErrorCode =
  | 'device-unauthorized'
  | 'device-offline'
  | 'device-locked'
  | 'device-busy'
  | 'device-missing'
  | 'adb-missing'
  | 'appium-start'
  | 'ios-signing'
  | 'ios-ddi'
  | 'ios-wda'
  | 'ios-developer-mode'
  | 'selector-ambiguous'
  | 'selector-missing'
  | 'session-lost'
  | 'app-missing'
  | 'ai-auth'
  | 'ai-timeout'
  | 'ai-quota'
  | 'ai-missing'
  | 'ai-invalid'
  | 'network'
  | 'cancelled'
  | 'unknown';

interface Rule {
  code: ErrorCode;
  test: RegExp;
  docs?: string;
}
const DOC = 'https://appium.github.io/appium-xcuitest-driver/latest/';
const RULES: Rule[] = [
  { code: 'cancelled', test: /AbortError|aborted|annulé|interrompue/i },
  { code: 'device-unauthorized', test: /unauthorized|autoriser le débogage/i },
  { code: 'device-locked', test: /DeviceLocked|device is locked|verrouillé/i },
  { code: 'device-busy', test: /occupé|déjà utilisé|already in use/i },
  { code: 'device-offline', test: /offline|non connecté|device .*not found|no devices/i },
  { code: 'adb-missing', test: /adb: .*(not found|ENOENT)|spawn adb|ADB indisponible/i },
  { code: 'ios-developer-mode', test: /developer mode|mode développeur/i },
  { code: 'ios-ddi', test: /developer disk|DDI|image could not be mounted/i, docs: DOC },
  {
    code: 'ios-signing',
    test: /No profiles|provision|signing certificate|No Accounts|code.?65|development team|bundle identifier|signature/i,
    docs: DOC + 'getting-started/provisioning-profile/',
  },
  { code: 'ios-wda', test: /WebDriverAgent|WDA|xcodebuild/i, docs: DOC },
  {
    code: 'appium-start',
    test: /Appium ne démarre|Cannot find module|MODULE_NOT_FOUND|ECONNREFUSED.*47\d\d/i,
  },
  { code: 'selector-ambiguous', test: /ambigu|multiple elements/i },
  { code: 'selector-missing', test: /introuvable|no such element|Composant|not found/i },
  {
    code: 'session-lost',
    test: /invalid session id|session.*(terminated|not started)|NoSuchDriver/i,
  },
  { code: 'app-missing', test: /not installed|non installée/i },
  { code: 'ai-quota', test: /quota|rate.?limit|usage limit|429|insufficient/i },
  { code: 'ai-auth', test: /not logged|unauthenticated|auth|login|401|403|connexion requise/i },
  { code: 'ai-timeout', test: /n’a pas répondu|timed? ?out|timeout|ETIMEDOUT/i },
  { code: 'ai-missing', test: /codex.*ENOENT|copilot.*ENOENT|claude.*ENOENT|spawn .*ENOENT/i },
  { code: 'ai-invalid', test: /JSON|schema|invalid response|réponse invalide/i },
  { code: 'network', test: /ENOTFOUND|ECONNRESET|EAI_AGAIN|fetch failed|network/i },
];
/** Classify a raw error; messages are localized by the renderer from `code`. */
export function classifyError(error: unknown): AppErrorInfo {
  const raw = error instanceof Error ? error.message : String(error);
  const rule = RULES.find((r) => r.test.test(raw));
  return { code: rule?.code ?? 'unknown', title: '', detail: raw, docs: rule?.docs, raw };
}
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}
