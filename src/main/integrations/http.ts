import { tr } from './i18n.js';

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Removes secrets that may be echoed back by an error page or a URL before the text is shown or logged. */
export function scrub(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const s of secrets.filter((s): s is string => !!s && s.length >= 4))
    out = out.split(s).join('•••');
  return out;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT';
  headers?: Record<string, string>;
  /** Object → JSON; string / Buffer / FormData are sent as is. */
  body?: unknown;
  timeoutMs?: number;
  /** Values never to show in an error (tokens, webhook URLs). */
  secrets?: (string | undefined)[];
  /** Replaceable in tests. */
  fetchImpl?: typeof fetch;
}

/** JSON request with a timeout and readable errors (status + the server's own message, secrets masked). */
export async function request<T = unknown>(url: string, o: RequestOptions = {}): Promise<T> {
  const raw = o.body;
  const isJson =
    raw !== undefined &&
    typeof raw === 'object' &&
    !(raw instanceof FormData) &&
    !Buffer.isBuffer(raw) &&
    !(raw instanceof Uint8Array);
  let response: Response;
  try {
    response = await (o.fetchImpl ?? fetch)(url, {
      method: o.method ?? (raw === undefined ? 'GET' : 'POST'),
      headers: {
        Accept: 'application/json',
        ...(isJson ? { 'Content-Type': 'application/json' } : {}),
        ...o.headers,
      },
      body: raw === undefined ? undefined : isJson ? JSON.stringify(raw) : (raw as BodyInit),
      signal: AbortSignal.timeout(o.timeoutMs ?? 20000),
    });
  } catch (error) {
    const e = error as Error;
    const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError';
    throw new HttpError(
      scrub(
        timedOut
          ? tr(
              `Délai dépassé (${(o.timeoutMs ?? 20000) / 1000} s)`,
              `Timed out (${(o.timeoutMs ?? 20000) / 1000} s)`,
            )
          : `${tr('Connexion impossible', 'Cannot connect')} : ${e.message}${(e.cause as Error | undefined)?.message ? ' (' + (e.cause as Error).message + ')' : ''}`,
        o.secrets ?? [],
      ),
    );
  }
  const text = await response.text();
  if (!response.ok) {
    let detail = text.slice(0, 400).replace(/\s+/g, ' ');
    try {
      const json = JSON.parse(text);
      detail =
        json.message ??
        json.error ??
        (json.errorMessages?.length ? json.errorMessages.join('; ') : undefined) ??
        (json.errors ? JSON.stringify(json.errors) : undefined) ??
        detail;
    } catch {
      /* not JSON */
    }
    throw new HttpError(
      scrub(`HTTP ${response.status} : ${String(detail)}`, o.secrets ?? []),
      response.status,
    );
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

export const basicAuth = (user: string, secret: string) =>
  'Basic ' + Buffer.from(`${user}:${secret}`).toString('base64');
export const trimSlash = (url: string) => url.replace(/\/+$/, '');
