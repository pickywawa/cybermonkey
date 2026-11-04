import { tr } from './i18n.js';
import { outcomeOf, campaignProgress } from '../../shared/domain/campaign.js';
import type { NotificationSettings } from '../../shared/domain/integrations.js';
import type { Project } from '../../shared/domain/project.js';
import type { CampaignDetail, RunEntry, RunReport } from '../../shared/domain/report.js';
import type { Settings } from '../../shared/domain/settings.js';
import type { FinishedRun, Journal } from './context.js';
import { request, scrub } from './http.js';
import { clean, isResult, secretsOf, type Regression } from './regressions.js';
import type { SecretStore } from './secrets.js';
import { sendMail, type Attachment } from './smtp.js';

export interface Message {
  title: string;
  lines: string[];
  level: 'info' | 'ok' | 'error';
}

/* ---------- rendering (pure) ---------- */
const osName = (os: string) => (os === 'ios' ? 'iOS' : 'Android');
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export const slackText = (m: Message) => {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return cut(`*${esc(m.title)}*\n${m.lines.map((l) => '• ' + esc(l)).join('\n')}`, 3500);
};
export const teamsPayload = (m: Message) => ({
  type: 'message',
  attachments: [
    {
      contentType: 'application/vnd.microsoft.card.adaptive',
      contentUrl: null,
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          {
            type: 'TextBlock',
            text: m.title,
            weight: 'Bolder',
            size: 'Medium',
            wrap: true,
            color: m.level === 'error' ? 'Attention' : m.level === 'ok' ? 'Good' : 'Default',
          },
          ...m.lines.map((l) => ({
            type: 'TextBlock',
            text: cut(l, 1500),
            wrap: true,
            spacing: 'Small',
          })),
        ],
      },
    },
  ],
});
export const mailText = (m: Message) =>
  `${m.title}\n\n${m.lines.map((l) => '- ' + l).join('\n')}\n`;

export function regressionMessage(
  f: Pick<FinishedRun, 'project' | 'campaignLabel' | 'report'>,
  regressions: Regression[],
  include: NotificationSettings['include'],
  fr: boolean,
): Message {
  const tr = (a: string, b: string) => (fr ? a : b);
  const lines = [
    `${f.project.name} · ${f.campaignLabel}${f.report.environment ? ' · ' + f.report.environment : ''}`,
  ];
  for (const r of regressions.slice(0, 15)) {
    lines.push(`[${osName(r.os)}] ${r.name} — ${cut(r.message, 240)}`);
    lines.push(`   ${r.history}`);
    if (include.analysis && r.analysis)
      lines.push(
        `   ${tr('Analyse', 'Analysis')}${r.verdict ? ' (' + r.verdict + ')' : ''} : ${cut(r.analysis, 400)}${r.fix ? ` — ${tr('Piste', 'Fix')} : ${cut(r.fix, 300)}` : ''}`,
      );
  }
  if (regressions.length > 15)
    lines.push(
      tr(`… et ${regressions.length - 15} autre(s)`, `… and ${regressions.length - 15} more`),
    );
  return {
    level: 'error',
    title: tr(
      `Régression : ${regressions.length} étape(s) ne passent plus`,
      `Regression: ${regressions.length} step(s) no longer pass`,
    ),
    lines,
  };
}

export function failureMessage(
  project: Project,
  report: RunReport,
  e: RunEntry,
  include: NotificationSettings['include'],
  fr: boolean,
): Message {
  const tr = (a: string, b: string) => (fr ? a : b);
  const lines = [
    `${project.name}${report.environment ? ' · ' + report.environment : ''} · ${osName(e.platform)}`,
    cut((e.operationMessage ?? e.message ?? '').replace(/\s+/g, ' '), 400),
  ];
  if (include.analysis && (e.analysisData || e.analysis))
    lines.push(
      `${tr('Analyse', 'Analysis')} : ${cut(e.analysisData ? `[${e.analysisData.verdict}] ${e.analysisData.summary}` : (e.analysis ?? ''), 500)}`,
    );
  return { level: 'error', title: tr(`Échec : ${e.nodeName}`, `Failed: ${e.nodeName}`), lines };
}

export function progressMessage(
  project: Project,
  label: string,
  percent: number,
  p: { passed: number; failed: number; pending: number },
  fr: boolean,
): Message {
  const tr = (a: string, b: string) => (fr ? a : b);
  return {
    level: p.failed ? 'error' : 'info',
    title: tr(`Avancement ${percent} % — ${label}`, `Progress ${percent}% — ${label}`),
    lines: [
      project.name,
      tr(
        `${p.passed} réussi(s), ${p.failed} en échec, ${p.pending} restant(s)`,
        `${p.passed} passed, ${p.failed} failed, ${p.pending} left`,
      ),
    ],
  };
}

export function finishedMessage(f: FinishedRun, suppressed: number, fr: boolean): Message {
  const tr = (a: string, b: string) => (fr ? a : b);
  const results = f.report.entries.filter(isResult);
  const passed = results.filter((e) => outcomeOf(e) === 'passed').length;
  const failed = results.filter((e) => outcomeOf(e) === 'failed').length;
  const status =
    f.report.status === 'cancelled'
      ? tr('annulée', 'cancelled')
      : failed
        ? tr('avec des échecs', 'with failures')
        : tr('réussie', 'passed');
  const lines = [
    `${f.project.name} · ${f.campaignLabel}${f.report.environment ? ' · ' + f.report.environment : ''}`,
    tr(`${passed} réussi(s), ${failed} en échec`, `${passed} passed, ${failed} failed`),
  ];
  if (f.regressions.length)
    lines.push(
      tr(`${f.regressions.length} régression(s)`, `${f.regressions.length} regression(s)`),
    );
  if (suppressed > 0)
    lines.push(
      tr(
        `${suppressed} message(s) d’échec non envoyé(s) (limite par exécution)`,
        `${suppressed} failure message(s) not sent (per-run limit)`,
      ),
    );
  return {
    level: failed || f.report.status === 'cancelled' ? 'error' : 'ok',
    title: tr(`Exécution terminée, ${status}`, `Run finished, ${status}`),
    lines,
  };
}

/* ---------- service ---------- */
interface RunState {
  seen: Set<string>;
  sent: number;
  suppressed: number;
  progressSent: Set<number>;
  checkedAt: number;
  results: number;
}

export class Notifier {
  private runs = new Map<string, RunState>();
  constructor(
    private d: {
      settings: () => Settings;
      secrets: SecretStore;
      journal: Journal;
      project: (id: string) => Project | undefined;
      loadCampaign: (projectId: string, campaignId: string) => Promise<CampaignDetail>;
      media: {
        screenshot(i: {
          projectId: string;
          campaignId: string;
          runId: string;
          entryId: string;
        }): Promise<string | null>;
        video(i: {
          projectId: string;
          campaignId: string;
          runId: string;
          entryId: string;
        }): Promise<string | null>;
      };
      fetchImpl?: typeof fetch;
      mail?: typeof sendMail;
    },
  ) {}
  private cfg() {
    return this.d.settings().integrations.notifications;
  }
  private fr() {
    return this.d.settings().language !== 'en';
  }
  private state(id: string): RunState {
    let s = this.runs.get(id);
    if (!s)
      this.runs.set(
        id,
        (s = {
          seen: new Set(),
          sent: 0,
          suppressed: 0,
          progressSent: new Set(),
          checkedAt: 0,
          results: -1,
        }),
      );
    return s;
  }
  enabled() {
    const c = this.cfg();
    return c.slack.enabled || c.teams.enabled || c.email.enabled;
  }

  /** Called for every live update of a run: individual failures and progress. */
  async onRun(report: RunReport) {
    const c = this.cfg();
    if (!this.enabled() || report.status !== 'running') return;
    const project = this.d.project(report.projectId);
    if (!project) return;
    const st = this.state(report.id);
    const secrets = secretsOf(project);

    if (c.events.stepFailed)
      for (const e of report.entries) {
        if (!isResult(e) || !e.finishedAt || outcomeOf(e) !== 'failed' || st.seen.has(e.id))
          continue;
        st.seen.add(e.id);
        if (st.sent >= c.maxFailuresPerRun) {
          st.suppressed++;
          continue;
        }
        st.sent++;
        const m = failureMessage(project, report, e, c.include, this.fr());
        await this.deliver(
          m,
          secrets,
          c.include.screenshot || c.include.video ? [{ report, entry: e }] : [],
        );
      }

    if (c.events.progress && report.campaignId) {
      const done = report.entries.filter((e) => isResult(e) && e.finishedAt).length;
      if (done !== st.results && Date.now() - st.checkedAt > 3000) {
        st.results = done;
        st.checkedAt = Date.now();
        await this.progress(report, project, st, secrets);
      }
    }
  }

  private async progress(report: RunReport, project: Project, st: RunState, secrets: string[]) {
    const c = this.cfg();
    const detail = await this.d.loadCampaign(project.id, report.campaignId!).catch(() => null);
    if (!detail) return;
    const p = campaignProgress(detail, project, report.platforms ?? project.platforms);
    // Done: the end-of-run message says it, a « 100 % » progress ping would only double it.
    if (p.overall.percent >= 100) return;
    const reached = Math.floor(p.overall.percent / c.progressStep) * c.progressStep;
    // 0 is not news; 100 is announced by the end-of-run message.
    const crossed = [...Array(Math.floor(reached / c.progressStep) + 1).keys()]
      .map((i) => i * c.progressStep)
      .filter((t) => t > 0 && t < 100 && !st.progressSent.has(t));
    if (!crossed.length) return;
    // A jump over several thresholds is one message, not a burst.
    for (const t of crossed) st.progressSent.add(t);
    await this.deliver(
      progressMessage(project, detail.campaign.label, p.overall.percent, p.overall, this.fr()),
      secrets,
      [],
    );
  }

  async onFinished(f: FinishedRun) {
    const st = this.runs.get(f.report.id);
    this.runs.delete(f.report.id);
    const c = this.cfg();
    if (!this.enabled()) return;
    const fr = this.fr();
    if (c.events.regression && f.regressions.length) {
      await this.deliver(
        regressionMessage(f, f.regressions, c.include, fr),
        f.secrets,
        c.include.screenshot || c.include.video
          ? f.regressions.slice(0, 3).flatMap((r) => {
              const entry = f.report.entries.find((e) => e.id === r.entryId);
              return entry ? [{ report: f.report, entry }] : [];
            })
          : [],
      );
    }
    if (c.events.runFinished)
      await this.deliver(finishedMessage(f, st?.suppressed ?? 0, fr), f.secrets, []);
  }

  /* ---------- delivery ---------- */
  private async attachments(
    items: { report: RunReport; entry: RunEntry }[],
  ): Promise<Attachment[]> {
    const c = this.cfg();
    const out: Attachment[] = [];
    for (const { report, entry } of items.slice(0, 3)) {
      if (!report.campaignId) continue;
      const input = {
        projectId: report.projectId,
        campaignId: report.campaignId,
        runId: report.id,
        entryId: entry.id,
      };
      const safe = entry.nodeName.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'step';
      if (c.include.screenshot) {
        const shot = await this.d.media.screenshot(input).catch(() => null);
        const m = shot?.match(/^data:image\/png;base64,(.+)$/);
        if (m)
          out.push({
            filename: `${safe}.png`,
            contentType: 'image/png',
            data: Buffer.from(m[1], 'base64'),
          });
      }
      if (c.include.video) {
        const video = await this.d.media.video(input).catch(() => null);
        const m = video?.match(/^data:video\/mp4;base64,(.+)$/);
        // E-mail servers commonly refuse messages above ~10 MB (base64 adds a third).
        if (m && m[1].length < 7_000_000)
          out.push({
            filename: `${safe}.mp4`,
            contentType: 'video/mp4',
            data: Buffer.from(m[1], 'base64'),
          });
      }
    }
    return out;
  }

  /** Sends to every enabled channel; a failing channel never blocks the others, and is written in the journal. */
  async deliver(
    message: Message,
    secrets: string[],
    media: { report: RunReport; entry: RunEntry }[],
  ): Promise<{ target: string; ok: boolean; message: string }[]> {
    const c = this.cfg();
    const safe: Message = {
      ...message,
      title: clean(message.title, secrets),
      lines: message.lines.map((l) => clean(l, secrets)),
    };
    const jobs: Promise<{ target: string; ok: boolean; message: string }>[] = [];
    const run = (target: string, work: () => Promise<void>) =>
      jobs.push(
        work().then(
          () => ({ target, ok: true, message: tr('Envoyé', 'Sent') }),
          (error) => ({ target, ok: false, message: String((error as Error).message ?? error) }),
        ),
      );
    if (c.slack.enabled)
      run('slack', async () => {
        const url = await this.d.secrets.get('slackWebhook');
        if (!url)
          throw new Error(tr('URL du webhook Slack non renseignée', 'Slack webhook URL not set'));
        await request(url, {
          body: { text: slackText(safe) },
          secrets: [url],
          fetchImpl: this.d.fetchImpl,
        });
      });
    if (c.teams.enabled)
      run('teams', async () => {
        const url = await this.d.secrets.get('teamsWebhook');
        if (!url)
          throw new Error(tr('URL du webhook Teams non renseignée', 'Teams webhook URL not set'));
        await request(url, {
          body: teamsPayload(safe),
          secrets: [url],
          fetchImpl: this.d.fetchImpl,
        });
      });
    if (c.email.enabled)
      run('email', async () => {
        const e = c.email;
        if (!e.host || !e.from || !e.to.trim())
          throw new Error(
            tr(
              'Serveur, expéditeur et destinataires requis',
              'Server, sender and recipients are required',
            ),
          );
        const password = await this.d.secrets.get('smtpPassword');
        const attachments = media.length ? await this.attachments(media) : [];
        try {
          await (this.d.mail ?? sendMail)({
            host: e.host,
            port: e.port,
            security: e.security,
            username: e.username || undefined,
            password,
            from: e.from,
            to: e.to
              .split(/[;,]/)
              .map((s) => s.trim())
              .filter(Boolean),
            subject: '[Cybermonkey] ' + safe.title,
            text: mailText(safe),
            attachments,
          });
        } catch (error) {
          throw new Error(scrub(String((error as Error).message), [password]));
        }
      });
    const results = await Promise.all(jobs);
    for (const r of results)
      this.d.journal.add(r.target, r.ok, r.ok ? safe.title : `${safe.title} — ${r.message}`);
    return results;
  }

  /** « Send a test » button: one message to one channel, whatever the event switches say. */
  async test(target: 'slack' | 'teams' | 'email') {
    const c = this.cfg();
    const only: NotificationSettings = {
      ...c,
      slack: { enabled: target === 'slack' },
      teams: { enabled: target === 'teams' },
      email: { ...c.email, enabled: target === 'email' },
    };
    const original = this.d.settings;
    const probe = new Notifier({
      ...this.d,
      settings: () => ({
        ...original(),
        integrations: { ...original().integrations, notifications: only },
      }),
    });
    const fr = this.fr();
    const [result] = await probe.deliver(
      {
        level: 'info',
        title: fr ? 'Test de notification Cybermonkey' : 'Cybermonkey notification test',
        lines: [
          fr
            ? 'Si vous lisez ceci, le canal est correctement configuré.'
            : 'If you read this, the channel is set up correctly.',
        ],
      },
      [],
      [],
    );
    return (
      result ?? { target, ok: false, message: tr('Canal non configuré', 'Channel not configured') }
    );
  }
}
