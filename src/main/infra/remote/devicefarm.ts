import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RemoteDevice } from '../../../shared/domain/remote.js';
import type { OS } from '../../../shared/domain/scenario.js';
import { HttpError, request, scrub } from '../../integrations/http.js';
import { tr } from '../../integrations/i18n.js';
import { RemoteAppium } from './endpoint.js';
import type { Provider, ProviderContext, RemoteTarget } from './providers.js';
import { signV4, type AwsCredentials } from './sigv4.js';

/** Device Farm only exists in us-west-2 (Oregon). */
export const DEVICEFARM_REGION = 'us-west-2';
const HOST = `https://devicefarm.${DEVICEFARM_REGION}.amazonaws.com/`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The few Device Farm calls we need, signed with SigV4 (JSON 1.1 protocol). */
export class DeviceFarmApi {
  constructor(
    private credentials: AwsCredentials,
    private fetchImpl?: typeof fetch,
    private now: () => Date = () => new Date(),
  ) {}
  call<T = any>(operation: string, body: Record<string, unknown>): Promise<T> {
    const payload = JSON.stringify(body);
    const headers = signV4({
      method: 'POST',
      url: new URL(HOST),
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': `DeviceFarm_20150623.${operation}`,
      },
      body: payload,
      region: DEVICEFARM_REGION,
      service: 'devicefarm',
      credentials: this.credentials,
      now: this.now(),
    });
    return request<T>(HOST, {
      method: 'POST',
      headers,
      // Already a string: sent as is, the signature covers exactly these bytes.
      body: payload,
      secrets: [this.credentials.secretAccessKey, this.credentials.sessionToken],
      fetchImpl: this.fetchImpl,
      timeoutMs: 30000,
    }).catch((error) => {
      if (error instanceof HttpError)
        throw new Error(`Device Farm ${operation} : ${error.message}`);
      throw error;
    });
  }
}

async function api(ctx: ProviderContext) {
  const secret = (await ctx.secret('awsSecretKey'))!;
  return new DeviceFarmApi(
    {
      accessKeyId: ctx.settings.devicefarm.accessKeyId,
      secretAccessKey: secret,
      sessionToken: process.env.AWS_SESSION_TOKEN?.trim() || undefined,
    },
    ctx.fetchImpl,
  );
}

const SESSION_WAIT_MS = 6 * 60 * 1000;
export const devicefarm: Provider & { pollMs: number } = {
  pollMs: 4000,
  async missing(ctx) {
    const c = ctx.settings.devicefarm;
    if (!c.accessKeyId) return tr('identifiant de clé AWS manquant', 'AWS access key id missing');
    if (!(await ctx.secret('awsSecretKey')))
      return tr('clé secrète AWS manquante', 'AWS secret access key missing');
    if (!c.projectArn)
      return tr('ARN du projet Device Farm manquant', 'Device Farm project ARN missing');
  },
  async open(device: RemoteDevice, ctx): Promise<RemoteTarget> {
    if (!device.ref)
      throw new Error(
        tr(
          'ARN de l’appareil Device Farm manquant dans ce profil.',
          'Device Farm device ARN missing in this profile.',
        ),
      );
    const c = ctx.settings.devicefarm;
    const df = await api(ctx);
    const appArn = ctx.app(device.platform);
    // The session is billed by the minute from here: everything after this point must end in a Stop.
    const created = await df.call<{ remoteAccessSession?: { arn?: string } }>(
      'CreateRemoteAccessSession',
      {
        projectArn: c.projectArn,
        deviceArn: device.ref,
        name: `Cybermonkey · ${device.label}`.slice(0, 256),
        ...(appArn ? { appArn } : {}),
      },
    );
    const arn = created.remoteAccessSession?.arn;
    if (!arn)
      throw new Error(
        tr('Device Farm n’a pas renvoyé de session.', 'Device Farm returned no session.'),
      );
    const close = async () => {
      await df.call('StopRemoteAccessSession', { arn }).catch(() => {});
    };
    try {
      const deadline = Date.now() + SESSION_WAIT_MS;
      for (;;) {
        const got = await df.call<{
          remoteAccessSession?: {
            status?: string;
            result?: string;
            message?: string;
            endpoints?: { remoteDriverEndpoint?: string };
          };
        }>('GetRemoteAccessSession', { arn });
        const s = got.remoteAccessSession;
        if (s?.status === 'RUNNING' && s.endpoints?.remoteDriverEndpoint)
          return {
            endpoint: new RemoteAppium(s.endpoints.remoteDriverEndpoint, {}, ctx.fetchImpl),
            capabilities: {
              platformName: device.platform === 'android' ? 'Android' : 'iOS',
              'appium:automationName': device.platform === 'android' ? 'UiAutomator2' : 'XCUITest',
              'appium:noReset': true,
              'appium:autoLaunch': false,
              'appium:newCommandTimeout': 600,
              ...(c.appiumVersion ? { 'appium:version': c.appiumVersion } : {}),
            },
            close,
          };
        if (
          s?.status === 'COMPLETED' ||
          s?.status === 'STOPPING' ||
          (s?.result && s.result !== 'PENDING')
        )
          throw new Error(
            tr(
              `La session Device Farm s’est terminée avant de démarrer (${s?.result ?? s?.status}${s?.message ? ' : ' + s.message : ''}).`,
              `The Device Farm session ended before it started (${s?.result ?? s?.status}${s?.message ? ': ' + s.message : ''}).`,
            ),
          );
        if (Date.now() > deadline)
          throw new Error(
            tr(
              `La session Device Farm n’a pas démarré en ${SESSION_WAIT_MS / 60000} minutes (statut : ${s?.status ?? 'inconnu'}).`,
              `The Device Farm session did not start within ${SESSION_WAIT_MS / 60000} minutes (status: ${s?.status ?? 'unknown'}).`,
            ),
          );
        await wait(this.pollMs);
      }
    } catch (error) {
      await close();
      throw error;
    }
  },
  async upload(file: string, platform: OS, ctx) {
    const df = await api(ctx);
    const created = await df.call<{ upload?: { arn?: string; url?: string } }>('CreateUpload', {
      projectArn: ctx.settings.devicefarm.projectArn,
      name: path.basename(file),
      type: platform === 'android' ? 'ANDROID_APP' : 'IOS_APP',
    });
    const upload = created.upload;
    if (!upload?.arn || !upload.url)
      throw new Error(
        tr('Device Farm n’a pas renvoyé d’adresse d’envoi.', 'Device Farm returned no upload URL.'),
      );
    const response = await (ctx.fetchImpl ?? fetch)(upload.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: await fs.readFile(file),
      signal: AbortSignal.timeout(900000),
    });
    if (!response.ok)
      throw new Error(scrub(`Device Farm upload : HTTP ${response.status}`, [upload.url]));
    for (let i = 0; i < 120; i++) {
      const got = await df.call<{ upload?: { status?: string; message?: string } }>('GetUpload', {
        arn: upload.arn,
      });
      if (got.upload?.status === 'SUCCEEDED') return upload.arn;
      if (got.upload?.status === 'FAILED')
        throw new Error(
          tr(
            `Device Farm a refusé l’application : ${got.upload.message ?? 'échec'}`,
            `Device Farm rejected the application: ${got.upload.message ?? 'failed'}`,
          ),
        );
      await wait(this.pollMs);
    }
    throw new Error(
      tr(
        'Device Farm n’a pas fini de traiter l’application.',
        'Device Farm did not finish processing the application.',
      ),
    );
  },
  async test(ctx) {
    const df = await api(ctx);
    const got = await df.call<{ project?: { name?: string } }>('GetProject', {
      arn: ctx.settings.devicefarm.projectArn,
    });
    return {
      ok: true,
      message: tr(
        `Projet Device Farm « ${got.project?.name ?? '?'} » accessible.`,
        `Device Farm project “${got.project?.name ?? '?'}” reachable.`,
      ),
    };
  },
};
