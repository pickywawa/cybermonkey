import { tr } from './i18n.js';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { TicketSettings } from '../../shared/domain/integrations.js';
import type { Settings } from '../../shared/domain/settings.js';
import type { AiHub } from '../infra/ai/hub.js';
import { askStructured } from '../infra/ai/provider.js';
import type { Confirmer, FinishedRun, Journal } from './context.js';
import { HttpError, basicAuth, request, scrub, trimSlash } from './http.js';
import { clean, type Regression } from './regressions.js';
import type { SecretStore } from './secrets.js';

const osName = (os: string) => (os === 'ios' ? 'iOS' : 'Android');
const list = (s: string) =>
  s
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter(Boolean);

/* ---------- drafts (pure) ---------- */
export interface Draft {
  title: string;
  /** Markdown for GitHub, Jira wiki markup for Jira. */
  body: string;
}

export function draftOf(
  f: Pick<FinishedRun, 'project' | 'campaignLabel' | 'report'>,
  regressions: Regression[],
  style: 'github' | 'jira',
  fr: boolean,
): Draft {
  const tr = (a: string, b: string) => (fr ? a : b);
  const h = (s: string) => (style === 'jira' ? `h3. ${s}` : `### ${s}`);
  const b = (s: string) => (style === 'jira' ? `*${s}*` : `**${s}**`);
  const code = (s: string) =>
    style === 'jira' ? `{{${s.replace(/[{}]/g, '')}}}` : '`' + s.replace(/`/g, "'") + '`';
  const oses = [...new Set(regressions.map((r) => osName(r.os)))].join(' + ');
  const title =
    regressions.length === 1
      ? `[Cybermonkey] ${tr('Régression', 'Regression')} : ${regressions[0].name} (${oses})`
      : `[Cybermonkey] ${tr('Régression', 'Regression')} : ${regressions.length} ${tr('étapes', 'steps')} — ${f.project.name} (${oses})`;
  const lines = [
    `${b(tr('Projet', 'Project'))} : ${f.project.name}`,
    `${b(tr('Campagne', 'Campaign'))} : ${f.campaignLabel}`,
    ...(f.report.environment
      ? [`${b(tr('Environnement', 'Environment'))} : ${f.report.environment}`]
      : []),
    `${b(tr('Date', 'Date'))} : ${f.report.startedAt}`,
    '',
    h(tr('Étapes qui ne passent plus', 'Steps that no longer pass')),
  ];
  const sub = style === 'jira' ? '** ' : '  - ';
  for (const r of regressions) {
    lines.push(`* ${b(r.name)} (${osName(r.os)}) — ${r.message || tr('échec', 'failure')}`);
    lines.push(sub + r.history);
    if (r.analysis)
      lines.push(
        sub +
          `${tr('Analyse', 'Analysis')}${r.verdict ? ' ' + code(r.verdict) : ''} : ${r.analysis}${r.fix ? ` — ${tr('Piste', 'Suggested fix')} : ${r.fix}` : ''}`,
      );
  }
  lines.push(
    '',
    `_${tr('Créé automatiquement par Cybermonkey.', 'Created automatically by Cybermonkey.')}_`,
  );
  return { title: title.slice(0, 250), body: lines.join('\n') };
}

/* ---------- payloads ---------- */
export type GithubPayload = {
  title: string;
  body: string;
  labels?: string[];
  assignees?: string[];
};
export type JiraPayload = { fields: Record<string, unknown> };

/** Fields the AI may set on a Jira issue: the ones people actually fill, plus any custom field. */
const AI_JIRA_FIELDS =
  /^(customfield_\d+|labels|components|priority|assignee|fixVersions|versions|environment|duedate)$/;

export function parseExtraFields(text: string): Record<string, unknown> {
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      tr('Champs Jira supplémentaires : JSON invalide (', 'Extra Jira fields: invalid JSON (') +
        (error as Error).message +
        ')',
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(
      tr(
        'Champs Jira supplémentaires : un objet JSON est attendu, par exemple {"customfield_10010": "valeur"}',
        'Extra Jira fields: a JSON object is expected, e.g. {"customfield_10010": "value"}',
      ),
    );
  return parsed as Record<string, unknown>;
}

export function jiraPayload(
  c: TicketSettings['jira'],
  draft: Draft,
  ai?: { summary?: string; description?: string; fields?: Record<string, unknown> },
): { payload: JiraPayload; dropped: string[] } {
  const dropped: string[] = [];
  const extra = parseExtraFields(c.extraFields);
  const aiFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ai?.fields ?? {})) {
    // project / issuetype / reporter are decided by the configuration, never by a model.
    if (AI_JIRA_FIELDS.test(k)) aiFields[k] = v;
    else dropped.push(k);
  }
  const labels = [
    ...new Set([
      ...list(c.labels),
      ...(Array.isArray(extra.labels) ? extra.labels.map(String) : []),
      ...(Array.isArray(aiFields.labels) ? (aiFields.labels as unknown[]).map(String) : []),
    ]),
  ].map((l) => l.replace(/\s+/g, '-'));
  const fields: Record<string, unknown> = {
    ...extra,
    ...aiFields,
    project: { key: c.projectKey },
    issuetype: { name: c.issueType || 'Bug' },
    summary: (ai?.summary || draft.title).slice(0, 250),
    description: ai?.description || draft.body,
    ...(labels.length ? { labels } : {}),
  };
  return { payload: { fields }, dropped };
}

export function githubPayload(
  c: TicketSettings['github'],
  draft: Draft,
  ai?: { title?: string; body?: string; labels?: string[]; assignees?: string[] },
): GithubPayload {
  const labels = [...new Set([...list(c.labels), ...(ai?.labels ?? [])])];
  const assignees = [...new Set([...list(c.assignees), ...(ai?.assignees ?? [])])];
  return {
    title: (ai?.title || draft.title).slice(0, 250),
    body: ai?.body || draft.body,
    ...(labels.length ? { labels } : {}),
    ...(assignees.length ? { assignees } : {}),
  };
}

const aiJira = z.object({
  summary: z.string().max(250),
  description: z.string().max(20000),
  fields: z.record(z.string(), z.unknown()).default({}),
});
const aiGithub = z.object({
  title: z.string().max(250),
  body: z.string().max(60000),
  labels: z.array(z.string().max(100)).max(10).default([]),
  assignees: z.array(z.string().max(100)).max(5).default([]),
});
const jsonSchemaOf = (schema: z.ZodType): object => {
  const { $schema: _marker, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
};

const AI_SYSTEM = `You write a bug ticket for a mobile QA team from automated-test failures.
Rules:
- Write in the language of the team's instructions (default: the language of "language").
- Be factual: only use the data provided. Never invent steps, versions, people or links.
- Use the description markup of the target tracker ("markup": markdown for GitHub, Jira wiki markup for Jira: h3., *bold*, {{code}}, * bullets).
- Follow the team's instructions about fields, wording and house rules. If they include an example creation request, imitate its field names and value shapes.
- For Jira, put custom fields in "fields" using their exact ids (customfield_NNNNN). Never set project, issuetype or reporter: the application sets them.
- Never include credentials or tokens.`;

/* ---------- ledger ---------- */
interface LedgerEntry {
  provider: 'github' | 'jira';
  ref: string;
  url: string;
  createdAt: string;
}
class Ledger {
  constructor(private file: string) {}
  private async read(): Promise<Record<string, LedgerEntry>> {
    try {
      return JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch {
      return {};
    }
  }
  async get(key: string) {
    return (await this.read())[key];
  }
  async set(key: string, entry: LedgerEntry) {
    const all = await this.read();
    all[key] = entry;
    // Keep the file small: the oldest entries are the least likely to matter.
    const keep = Object.entries(all)
      .sort((a, b) => b[1].createdAt.localeCompare(a[1].createdAt))
      .slice(0, 500);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(Object.fromEntries(keep), null, 1), {
      mode: 0o600,
    });
  }
}

/** One key per set of regressions: the same regressions, night after night, make one ticket, not thirty. */
export const ticketKey = (projectId: string, provider: string, regressions: Regression[]) =>
  createHash('sha1')
    .update(
      projectId +
        '|' +
        provider +
        '|' +
        regressions
          .map((r) => r.os + ':' + r.nodeId)
          .sort()
          .join(','),
    )
    .digest('hex');

/* ---------- service ---------- */
export class TicketService {
  private ledger: Ledger;
  constructor(
    private d: {
      settings: () => Settings;
      secrets: SecretStore;
      journal: Journal;
      confirm?: Confirmer;
      hub?: Pick<AiHub, 'converse'>;
      ledgerFile: string;
      screenshot?: (i: {
        projectId: string;
        campaignId: string;
        runId: string;
        entryId: string;
      }) => Promise<string | null>;
      fetchImpl?: typeof fetch;
    },
  ) {
    this.ledger = new Ledger(d.ledgerFile);
  }
  private cfg() {
    return this.d.settings().integrations.tickets;
  }

  private async token() {
    const c = this.cfg();
    const token = await this.d.secrets.get(c.provider === 'github' ? 'githubToken' : 'jiraToken');
    if (!token)
      throw new Error(
        c.provider === 'github'
          ? tr('Jeton GitHub non renseigné', 'GitHub token not set')
          : tr('Jeton Jira non renseigné', 'Jira token not set'),
      );
    return token;
  }
  private headers(token: string): Record<string, string> {
    const c = this.cfg();
    if (c.provider === 'github')
      return {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Cybermonkey',
      };
    return {
      Authorization: c.jira.auth === 'bearer' ? `Bearer ${token}` : basicAuth(c.jira.email, token),
    };
  }
  private githubBase() {
    const g = this.cfg().github;
    if (!g.owner || !g.repo)
      throw new Error(
        tr(
          'Dépôt GitHub (propriétaire / nom) non renseigné',
          'GitHub repository (owner / name) not set',
        ),
      );
    return `https://api.github.com/repos/${encodeURIComponent(g.owner)}/${encodeURIComponent(g.repo)}`;
  }
  private jiraBase() {
    const j = this.cfg().jira;
    if (!j.url) throw new Error(tr('URL Jira non renseignée', 'Jira URL not set'));
    if (!j.projectKey)
      throw new Error(tr('Clé de projet Jira non renseignée', 'Jira project key not set'));
    if (j.auth === 'basic' && !j.email)
      throw new Error(
        tr('E-mail Jira requis avec un jeton d’API', 'Jira e-mail required with an API token'),
      );
    return trimSlash(j.url);
  }

  /** The ticket recorded for these regressions is still open (or could not be checked: then we do not duplicate). */
  private async stillOpen(entry: LedgerEntry, token: string): Promise<boolean> {
    try {
      if (entry.provider === 'github') {
        const issue = await request<{ state: string }>(`${this.githubBase()}/issues/${entry.ref}`, {
          headers: this.headers(token),
          secrets: [token],
          fetchImpl: this.d.fetchImpl,
        });
        return issue.state === 'open';
      }
      const issue = await request<{ fields?: { status?: { statusCategory?: { key?: string } } } }>(
        `${this.jiraBase()}/rest/api/2/issue/${encodeURIComponent(entry.ref)}?fields=status`,
        { headers: this.headers(token), secrets: [token], fetchImpl: this.d.fetchImpl },
      );
      return issue.fields?.status?.statusCategory?.key !== 'done';
    } catch (error) {
      return !(error instanceof HttpError && error.status === 404);
    }
  }

  private async aiRefine(f: FinishedRun, regressions: Regression[], draft: Draft) {
    const c = this.cfg();
    const hub = this.d.hub;
    if (!hub || !c.useAi || !c.instructions.trim()) return undefined;
    const prompt = JSON.stringify({
      language: this.d.settings().language,
      tracker: c.provider,
      markup: c.provider === 'jira' ? 'jira-wiki' : 'markdown',
      teamInstructions: c.instructions,
      configured:
        c.provider === 'jira'
          ? {
              projectKey: c.jira.projectKey,
              issueType: c.jira.issueType,
              labels: list(c.jira.labels),
              fixedFields: Object.keys(parseExtraFields(c.jira.extraFields)),
            }
          : { labels: list(c.github.labels) },
      context: {
        project: f.project.name,
        campaign: f.campaignLabel,
        environment: f.report.environment,
        regressions: regressions.map((r) => ({
          platform: r.os,
          step: r.name,
          error: clean(r.message, f.secrets),
          history: r.history,
          analysis: r.analysis && clean(r.analysis, f.secrets),
          suggestedFix: r.fix && clean(r.fix, f.secrets),
        })),
      },
      defaultDraft: draft,
    });
    const schema = c.provider === 'jira' ? aiJira : aiGithub;
    return hub.converse(AI_SYSTEM, AbortSignal.timeout(150000), (conversation) =>
      askStructured(
        conversation,
        prompt,
        schema as z.ZodType<z.infer<typeof schema>>,
        jsonSchemaOf(schema),
        { timeoutMs: 120000 },
      ),
    );
  }

  async onFinished(f: FinishedRun) {
    const c = this.cfg();
    if (c.mode === 'off' || !f.regressions.length || f.report.status === 'cancelled') return;
    const fr = this.d.settings().language !== 'en';
    try {
      const token = await this.token();
      const groups = c.grouping === 'step' ? f.regressions.map((r) => [r]) : [f.regressions];
      for (const group of groups.slice(0, c.maxPerRun)) {
        const key = ticketKey(f.project.id, c.provider, group);
        const known = await this.ledger.get(key);
        if (known && (await this.stillOpen(known, token))) {
          this.d.journal.add(
            c.provider,
            true,
            tr(
              `Ticket déjà ouvert pour ces régressions : ${known.url}`,
              `Ticket already open for these regressions: ${known.url}`,
            ),
          );
          continue;
        }
        const base = draftOf(f, group, c.provider === 'jira' ? 'jira' : 'github', fr);
        const draft = { title: clean(base.title, f.secrets), body: clean(base.body, f.secrets) };
        let ai: z.infer<typeof aiJira> | z.infer<typeof aiGithub> | undefined;
        try {
          ai = await this.aiRefine(f, group, draft);
        } catch (error) {
          this.d.journal.add(
            'ai',
            false,
            tr('Ticket rédigé sans l’IA : ', 'Ticket written without the AI: ') +
              String((error as Error).message).slice(0, 200),
          );
        }
        let payload: GithubPayload | JiraPayload;
        let dropped: string[] = [];
        if (c.provider === 'jira') {
          this.jiraBase();
          const built = jiraPayload(c.jira, draft, ai as z.infer<typeof aiJira> | undefined);
          payload = built.payload;
          dropped = built.dropped;
        } else {
          this.githubBase();
          payload = githubPayload(c.github, draft, ai as z.infer<typeof aiGithub> | undefined);
        }
        if (dropped.length)
          this.d.journal.add(
            'ai',
            true,
            tr(
              `Champs refusés (non autorisés pour l’IA) : ${dropped.join(', ')}`,
              `Fields refused (not allowed for the AI): ${dropped.join(', ')}`,
            ),
          );

        if (c.mode === 'ask') {
          const answer = await this.d.confirm?.({
            kind: 'ticket',
            title: fr
              ? `Créer un ticket ${c.provider === 'jira' ? 'Jira' : 'GitHub'} ?`
              : `Create a ${c.provider === 'jira' ? 'Jira' : 'GitHub'} ticket?`,
            message: fr
              ? `${group.length} régression(s) dans « ${f.project.name} ». Le contenu ci-dessous sera envoyé tel quel ; vous pouvez le modifier.`
              : `${group.length} regression(s) in “${f.project.name}”. The content below is sent as is; you can edit it.`,
            details: group.slice(0, 6).map((r) => `[${osName(r.os)}] ${r.name}`),
            editable: {
              label: fr ? 'Contenu du ticket (JSON)' : 'Ticket content (JSON)',
              value: JSON.stringify(payload, null, 2),
              mono: true,
              rows: 14,
            },
            confirmLabel: fr ? 'Créer le ticket' : 'Create ticket',
          });
          if (!answer) {
            this.d.journal.add(
              c.provider,
              true,
              tr(
                'Ticket proposé mais aucune fenêtre pour répondre : ignoré.',
                'Ticket offered but no window to answer: skipped.',
              ),
            );
            continue;
          }
          if (!answer.accepted) continue;
          try {
            payload = JSON.parse(answer.edited ?? JSON.stringify(payload));
          } catch {
            this.d.journal.add(
              c.provider,
              false,
              tr(
                'Contenu du ticket modifié : JSON invalide, ticket non créé.',
                'Edited ticket content: invalid JSON, ticket not created.',
              ),
            );
            continue;
          }
        }
        const created = await this.create(payload, token);
        await this.ledger.set(key, {
          provider: c.provider,
          ref: created.ref,
          url: created.url,
          createdAt: new Date().toISOString(),
        });
        if (c.provider === 'jira' && c.attachScreenshot)
          await this.attach(created.ref, f, group[0], token).catch(() => {});
        this.d.journal.add(
          c.provider,
          true,
          tr(`Ticket créé : ${created.url}`, `Ticket created: ${created.url}`),
        );
      }
    } catch (error) {
      this.d.journal.add(
        c.provider,
        false,
        scrub(String((error as Error).message), []).slice(0, 300),
      );
    }
  }

  private async create(
    payload: GithubPayload | JiraPayload,
    token: string,
  ): Promise<{ ref: string; url: string }> {
    const c = this.cfg();
    if (c.provider === 'github') {
      const issue = await request<{ number: number; html_url: string }>(
        `${this.githubBase()}/issues`,
        {
          body: payload,
          headers: this.headers(token),
          secrets: [token],
          fetchImpl: this.d.fetchImpl,
        },
      );
      return { ref: String(issue.number), url: issue.html_url };
    }
    const base = this.jiraBase();
    const issue = await request<{ key: string }>(`${base}/rest/api/2/issue`, {
      body: payload,
      headers: this.headers(token),
      secrets: [token],
      fetchImpl: this.d.fetchImpl,
    });
    return { ref: issue.key, url: `${base}/browse/${issue.key}` };
  }

  private async attach(key: string, f: FinishedRun, first: Regression | undefined, token: string) {
    if (!first || !f.report.campaignId || !this.d.screenshot) return;
    const shot = await this.d.screenshot({
      projectId: f.report.projectId,
      campaignId: f.report.campaignId,
      runId: f.report.id,
      entryId: first.entryId,
    });
    const m = shot?.match(/^data:image\/png;base64,(.+)$/);
    if (!m) return;
    const form = new FormData();
    form.append(
      'file',
      new Blob([Buffer.from(m[1], 'base64')], { type: 'image/png' }),
      'capture.png',
    );
    await request(`${this.jiraBase()}/rest/api/2/issue/${encodeURIComponent(key)}/attachments`, {
      body: form,
      headers: { ...this.headers(token), 'X-Atlassian-Token': 'no-check' },
      secrets: [token],
      fetchImpl: this.d.fetchImpl,
      timeoutMs: 60000,
    });
  }

  /** « Test the connection » button: proves the token and the target exist, creates nothing. */
  async test(): Promise<{ ok: boolean; message: string }> {
    const c = this.cfg();
    try {
      const token = await this.token();
      if (c.provider === 'github') {
        const repo = await request<{
          full_name: string;
          has_issues: boolean;
          permissions?: { push?: boolean };
        }>(this.githubBase(), {
          headers: this.headers(token),
          secrets: [token],
          fetchImpl: this.d.fetchImpl,
        });
        if (!repo.has_issues)
          return {
            ok: false,
            message: tr(
              `${repo.full_name} : les tickets (issues) sont désactivés sur ce dépôt.`,
              `${repo.full_name}: issues are disabled on this repository.`,
            ),
          };
        return {
          ok: true,
          message: tr(
            `Accès à ${repo.full_name} confirmé.`,
            `Access to ${repo.full_name} confirmed.`,
          ),
        };
      }
      const base = this.jiraBase();
      const me = await request<{ displayName?: string; name?: string }>(
        `${base}/rest/api/2/myself`,
        { headers: this.headers(token), secrets: [token], fetchImpl: this.d.fetchImpl },
      );
      await request(`${base}/rest/api/2/project/${encodeURIComponent(c.jira.projectKey)}`, {
        headers: this.headers(token),
        secrets: [token],
        fetchImpl: this.d.fetchImpl,
      });
      parseExtraFields(c.jira.extraFields);
      return {
        ok: true,
        message: tr(
          `Connecté en tant que ${me.displayName ?? me.name ?? '?'} ; projet ${c.jira.projectKey} trouvé.`,
          `Signed in as ${me.displayName ?? me.name ?? '?'}; project ${c.jira.projectKey} found.`,
        ),
      };
    } catch (error) {
      return { ok: false, message: String((error as Error).message) };
    }
  }
}
