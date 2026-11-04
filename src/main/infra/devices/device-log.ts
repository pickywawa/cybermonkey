export interface LogEntry {
  timestamp: number;
  level?: string;
  message: string;
}
export interface DeviceLogSummary {
  /** The lines that matter, oldest first (the app's own output and system errors near it). */
  lines: string[];
  /** Plain-language signs of a network problem found in the log. */
  networkHints: string[];
  total: number;
}

/** Processes that talk constantly about the test harness itself: never about the app. */
const NOISE =
  /\b(testmanagerd|WebDriverAgent\w*|XCTRunner|xctest|xctrunner|runningboardd|backboardd|assertiond|CoreSimulator|UIKitSystemApp|SpringBoard|dasd|trustd|cfprefsd|mediaserverd|lsd|containermanagerd|com\.apple\.dt\.xctest|UiAutomator|io\.appium)\b/i;
/** Lines worth keeping first: errors and faults, or words that say something went wrong. */
const IMPORTANT =
  /\s(E|Ef|F|Ff|A|Af)\s|\b(error|exception|fatal|crash|failed|failure|timed? ?out|timeout|denied|refused|unreachable|offline|abort|assert|nsurlerror|SIGABRT|ANR)\b/i;

const NETWORK: [RegExp, string, string][] = [
  [
    /NSURLErrorDomain.{0,40}(-1009|-1004|-1003)|offline|not connected to the internet|network is unreachable|ENETUNREACH|UnknownHostException|Unable to resolve host|No address associated/i,
    'Pas de réseau ou serveur injoignable',
    'No network or server unreachable',
  ],
  [
    /NSURLErrorDomain.{0,40}-1001|SocketTimeoutException|timed out|ETIMEDOUT|connect timeout|request timeout/i,
    'Délai dépassé en appelant le serveur',
    'Timeout calling the server',
  ],
  [
    /ECONNREFUSED|Connection refused|NSURLErrorDomain.{0,40}-1004|ConnectException/i,
    'Connexion refusée par le serveur',
    'Connection refused by the server',
  ],
  [
    /NSURLErrorDomain.{0,40}-1200|SSL|TLS|certificate|CertPathValidator|SSLHandshakeException|-9807|-9808|-9814/i,
    'Problème de certificat ou de connexion sécurisée (TLS)',
    'Certificate or secure connection (TLS) problem',
  ],
  [
    /\b(HTTP\/[12](\.\d)?\s+5\d\d|status(?:Code)?[ =:]+5\d\d|\b50[0234]\b.{0,20}(error|gateway|unavailable))/i,
    'Le serveur a répondu par une erreur 5xx',
    'The server answered with a 5xx error',
  ],
  [
    /\b(HTTP\/[12](\.\d)?\s+40[13]|status(?:Code)?[ =:]+40[13]|unauthorized|forbidden)\b/i,
    'Le serveur a refusé l’accès (401/403) : session ou droits',
    'The server refused access (401/403): session or permissions',
  ],
];

const processOf = (line: string) => /\s([A-Za-z][\w.-]*)\[\d+:[0-9a-f]+\]/.exec(line)?.[1];
const pidOf = (line: string) => /\[(\d+):[0-9a-f]+\]/.exec(line)?.[1];

/**
 * Boil a raw device log (thousands of lines, mostly the system and the test harness talking) down to what helps explain a
 * failure: the APP's own output from the last seconds, and a verdict on network trouble. Lines of other processes are never
 * guessed at: a system daemon failing to initialise says nothing about the app under test.
 */
export function summarizeDeviceLog(
  entries: LogEntry[],
  options: {
    application?: string;
    /** Process id of the app (iOS): exact filter. */
    pid?: number;
    windowMs?: number;
    max?: number;
    language?: 'fr' | 'en';
  } = {},
): DeviceLogSummary {
  const window = options.windowMs ?? 25_000;
  const max = options.max ?? 40;
  if (!entries.length) return { lines: [], networkHints: [], total: 0 };
  const last = Math.max(...entries.map((e) => e.timestamp));
  const recent = entries.filter((e) => e.timestamp >= last - window);
  const app = options.application?.toLowerCase();
  // Without a pid, the app's process is the one that names its own bundle id.
  const appProcess = recent
    .filter((e) => app && e.message.toLowerCase().includes(app))
    .map((e) => processOf(e.message))
    .find((p) => p && !NOISE.test(p));
  const mine = (m: string) => {
    const pid = pidOf(m);
    if (pid)
      return options.pid
        ? pid === String(options.pid)
        : !!appProcess && processOf(m) === appProcess;
    // logcat: the package name, or the tags of the app's runtime and network stack
    return (
      !!app &&
      (m.toLowerCase().includes(app) ||
        /\b(flutter|AndroidRuntime|OkHttp|System\.err|chromium|Retrofit|ReactNativeJS)\b/i.test(m))
    );
  };
  const keep = recent
    .map((e) => e.message.replace(/\s+/g, ' ').trim())
    .filter((m) => !NOISE.test(m) && mine(m));
  const unique: string[] = [];
  for (const line of keep) if (unique[unique.length - 1] !== line) unique.push(line);
  // The latest lines for context, and every recent error even when it is further back than the window of lines.
  const important = unique.map((l, i) => (IMPORTANT.test(l) ? i : -1)).filter((i) => i >= 0);
  const picked = new Set([
    ...important.slice(-Math.ceil(max * 0.6)),
    ...unique.map((_, i) => i).slice(-Math.floor(max * 0.4)),
  ]);
  const lines = [...picked]
    .sort((a, b) => a - b)
    .map((i) => unique[i])
    .map((l) => (l.length > 400 ? l.slice(0, 400) + '…' : l));
  const hints = NETWORK.filter(([re]) => keep.some((l) => re.test(l))).map(([, fr, en]) =>
    options.language === 'en' ? en : fr,
  );
  return { lines, networkHints: [...new Set(hints)], total: entries.length };
}
