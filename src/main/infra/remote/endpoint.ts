import { AppiumError } from '../appium/server.js';

/** What the engine needs from an Appium server: the local one and a remote one answer the same way. */
export interface AppiumEndpoint {
  request(
    route: string,
    method?: string,
    body?: unknown,
    timeout?: number,
    signal?: AbortSignal,
  ): Promise<any>;
}

/** A WebDriver endpoint somewhere else (a device cloud, your own Appium server): base URL + credentials. */
export class RemoteAppium implements AppiumEndpoint {
  constructor(
    readonly base: string,
    private headers: Record<string, string> = {},
    private fetchImpl: typeof fetch = fetch,
    /** Values never to show in an error. */
    private secrets: string[] = [],
  ) {}

  private scrub(text: string) {
    let out = text;
    for (const s of this.secrets) if (s.length >= 4) out = out.split(s).join('•••');
    return out;
  }

  async request(
    route: string,
    method = 'GET',
    body?: unknown,
    timeout = 30000,
    signal?: AbortSignal,
  ): Promise<any> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.base.replace(/\/$/, '') + route, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...this.headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
          : AbortSignal.timeout(timeout),
      });
    } catch (error) {
      const e = error as Error;
      if (e.name === 'AbortError' && signal?.aborted) throw e;
      throw new AppiumError(
        this.scrub(
          e.name === 'TimeoutError' || e.name === 'AbortError'
            ? `Délai dépassé (${Math.round(timeout / 1000)} s) sur ${this.base}`
            : `Connexion impossible à ${this.base} : ${e.message}`,
        ),
        'remote-unreachable',
      );
    }
    const json = (await response.json().catch(() => ({}))) as any;
    if (!response.ok || json.value?.error)
      throw new AppiumError(
        this.scrub(
          json.value?.message ??
            (response.status === 401 || response.status === 403
              ? `Identifiants refusés (HTTP ${response.status})`
              : `Appium HTTP ${response.status}`),
        ),
        json.value?.error ?? (response.status === 401 ? 'unauthorized' : undefined),
      );
    return json.value;
  }
}
