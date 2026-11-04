import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { integrationsSchema } from '../src/shared/domain/integrations.js';
import { settingsSchema, type Settings } from '../src/shared/domain/settings.js';
import type { CampaignDetail, RunEntry, RunReport } from '../src/shared/domain/report.js';
import type { Project } from '../src/shared/domain/project.js';
import type { ScenarioNode } from '../src/shared/domain/scenario.js';
import { SecretStore, envName } from '../src/main/integrations/secrets.js';
import { ConfirmBroker, Journal } from '../src/main/integrations/context.js';
import {
  changedFiles,
  commitAndPush,
  commitText,
  inspect,
  pullFastForward,
} from '../src/main/integrations/git.js';
import { GitSync } from '../src/main/integrations/git-sync.js';
import { findRegressions, secretsOf } from '../src/main/integrations/regressions.js';
import {
  Notifier,
  failureMessage,
  slackText,
  teamsPayload,
  type Message,
} from '../src/main/integrations/notifier.js';
import { buildMessage, sendMail, addressOf } from '../src/main/integrations/smtp.js';
import {
  TicketService,
  draftOf,
  githubPayload,
  jiraPayload,
  parseExtraFields,
  ticketKey,
} from '../src/main/integrations/tickets.js';
import {
  TrackerService,
  caseIdFor,
  collectResults,
  pushAzure,
  pushTestrail,
} from '../src/main/integrations/trackers.js';
import { IntegrationHub } from '../src/main/integrations/hub.js';

const tmp = (name = 'cm-int-') => mkdtempSync(path.join(os.tmpdir(), name));

/* ---------- fixtures ---------- */
const settings = (integrations: unknown = {}, extra: Partial<Settings> = {}): Settings =>
  settingsSchema.parse({ projectsDirectory: '/x', language: 'fr', integrations, ...extra });
const entry = (over: Partial<RunEntry>): RunEntry =>
  ({
    id: Math.random().toString(36).slice(2),
    nodeId: 'step1',
    nodeName: 'Se connecter',
    deviceId: 'dev',
    platform: 'android',
    status: 'passed',
    message: '',
    kind: 'test',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:00:02Z',
    ...over,
  }) as RunEntry;
const report = (entries: RunEntry[], over: Partial<RunReport> = {}): RunReport => ({
  id: 'run-' + Math.random().toString(36).slice(2),
  projectId: 'p1',
  campaignId: 'c-now',
  startedAt: '2026-01-02T00:00:00Z',
  status: 'passed',
  entries,
  snapshot: [],
  ...over,
});
const detail = (id: string, reports: RunReport[]): CampaignDetail => ({
  campaign: {
    id,
    projectId: 'p1',
    label: id,
    createdAt: '2026-01-01',
    updatedAt: '',
    status: 'open',
  },
  reports,
});
const project = (over: Partial<Project> = {}) =>
  ({
    id: 'p1',
    name: 'Atlas',
    platforms: ['android', 'ios'],
    variables: { PASSWORD: 'hunter2hunter2', LOGIN: 'bob' },
    environments: [],
    activeEnvironmentId: null,
    nodes: [],
    directory: '/x/Atlas',
    ...over,
  }) as unknown as Project;
/** A fetch that records requests and answers from a script. */
function fakeFetch(answer: (url: string, init: RequestInit) => unknown) {
  const calls: { url: string; init: RequestInit; json?: any }[] = [];
  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    const u = String(url);
    let json: unknown;
    try {
      json = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    } catch {
      /* not JSON */
    }
    calls.push({ url: u, init, json });
    const out = answer(u, init);
    if (out instanceof Response) return out;
    return new Response(typeof out === 'string' ? out : JSON.stringify(out ?? {}), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

/* ---------- secrets ---------- */
test('secrets: kept apart, owner-only, encrypted when a cipher exists, overridable from the environment', async () => {
  const dir = tmp();
  const file = path.join(dir, 's', 'secrets.json');
  const cipher = {
    encrypt: (s: string) => 'enc:' + Buffer.from(s).toString('base64'),
    decrypt: (s: string) => Buffer.from(s.slice(4), 'base64').toString(),
  };
  const store = new SecretStore(file, cipher);
  assert.equal(await store.get('jiraToken'), undefined);
  await store.set('jiraToken', '  tok-123456 ');
  assert.equal(await store.get('jiraToken'), 'tok-123456');
  assert.ok(
    !readFileSync(file, 'utf8').includes('tok-123456'),
    'never in clear on disk when encrypted',
  );
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o077, 0, 'owner only');
  assert.equal((await new SecretStore(file, cipher).has()).jiraToken, true);
  assert.equal(
    (await new SecretStore(file).has()).jiraToken,
    false,
    'unreadable without the cipher',
  );
  process.env[envName('githubToken')] = 'from-ci';
  try {
    assert.equal(await store.get('githubToken'), 'from-ci');
    assert.equal((await store.has()).githubToken, true);
  } finally {
    delete process.env[envName('githubToken')];
  }
  await store.set('jiraToken', null);
  assert.equal((await store.has()).jiraToken, false);
  assert.equal(envName('testrailApiKey'), 'CYBERMONKEY_TESTRAIL_API_KEY');
});

test('settings: integrations default to everything off and survive a round trip', () => {
  const s = settings();
  assert.equal(s.integrations.git.pushOnChange, false);
  assert.equal(s.integrations.notifications.events.stepFailed, false);
  assert.equal(s.integrations.notifications.events.regression, true);
  assert.equal(s.integrations.trackers.mode, 'off');
  assert.equal(s.integrations.tickets.mode, 'off');
  assert.ok(!('slackWebhook' in s.integrations), 'secrets are not settings');
  assert.deepEqual(
    settingsSchema.parse(JSON.parse(JSON.stringify(s))).integrations,
    s.integrations,
  );
  assert.throws(() => integrationsSchema.parse({ notifications: { progressStep: 7 } }));
  assert.throws(() => integrationsSchema.parse({ trackers: { testrail: { url: 'ftp://x' } } }));
});

/* ---------- git (real git on temporary repositories) ---------- */
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  });
function repos() {
  const root = tmp();
  const origin = path.join(root, 'origin.git');
  git(root, 'init', '--bare', '-b', 'main', origin);
  const a = path.join(root, 'a');
  git(root, 'clone', origin, a);
  // A CI runner has no global identity: give each clone its own, so a commit never depends on the machine.
  git(a, 'config', 'user.name', 't');
  git(a, 'config', 'user.email', 't@t');
  mkdirSync(path.join(a, 'Atlas'));
  writeFileSync(path.join(a, 'Atlas', 'cybermonkey.project.json'), '{}');
  git(a, 'add', '-A');
  git(a, 'commit', '-m', 'init');
  git(a, 'push', '-u', 'origin', 'HEAD:main');
  const b = path.join(root, 'b');
  git(root, 'clone', origin, b);
  git(b, 'config', 'user.name', 't');
  git(b, 'config', 'user.email', 't@t');
  return { root, a, b, project: path.join(a, 'Atlas') };
}
process.env.GIT_AUTHOR_NAME = 't';
process.env.GIT_AUTHOR_EMAIL = 't@t';
process.env.GIT_COMMITTER_NAME = 't';
process.env.GIT_COMMITTER_EMAIL = 't@t';

test('git: detects a repository, its branch, upstream and local changes', async () => {
  const { a, project: dir, root } = repos();
  const none = await inspect(tmp());
  assert.equal(none.isRepo, false);
  writeFileSync(path.join(dir, 'new.json'), '{}');
  const info = await inspect(dir);
  assert.equal(info.isRepo, true);
  assert.equal(info.branch, 'main');
  assert.equal(info.upstream, 'origin/main');
  assert.equal(info.changes, 1);
  assert.equal(info.ahead, 0);
  assert.equal((await inspect(path.join(root, 'nope'))).isRepo, false);
  assert.ok(a);
});

test('git: commit and push leave media out unless asked and never touch what the person staged', async () => {
  const { a, project: dir } = repos();
  mkdirSync(path.join(dir, 'campaigns', 'c1', 'captures'), { recursive: true });
  writeFileSync(path.join(dir, 'campaigns', 'c1', 'captures', 'shot.png'), 'png');
  writeFileSync(path.join(dir, 'campaigns', 'c1', 'campaign.json'), '{}');
  assert.deepEqual(
    (await changedFiles(dir, false)).map((l) => l.trim()),
    ['?? Atlas/campaigns/c1/campaign.json'],
  );
  assert.equal((await changedFiles(dir, true)).length, 2, 'with media: the capture is listed too');

  writeFileSync(path.join(a, 'outside.txt'), 'x');
  git(a, 'add', 'outside.txt');
  const refused = await commitAndPush(dir, 'msg', false);
  assert.equal(refused.ok, false);
  assert.match(refused.message, /indexés/);
  git(a, 'reset', '--quiet');

  const pushed = await commitAndPush(dir, 'Cybermonkey : test', false);
  assert.equal(pushed.ok, true, pushed.message);
  assert.equal(git(a, 'log', '-1', '--format=%s').trim(), 'Cybermonkey : test');
  assert.equal(git(a, 'ls-tree', '-r', 'HEAD', '--name-only').includes('shot.png'), false);
  assert.equal(git(a, 'ls-tree', '-r', 'HEAD', '--name-only').includes('outside.txt'), false);
  assert.equal((await commitAndPush(dir, 'again', false)).committed, false, 'nothing to commit');
});

test('git: a push the remote refuses is reported, never forced, and the commit stays local', async () => {
  const { a, b, project: dir } = repos();
  writeFileSync(path.join(b, 'Atlas', 'remote.json'), '{}');
  git(b, 'add', '-A');
  git(b, 'commit', '-m', 'remote moved');
  git(b, 'push');
  writeFileSync(path.join(dir, 'local.json'), '{}');
  const result = await commitAndPush(dir, 'local work', false);
  assert.equal(result.ok, false);
  assert.equal(result.rejected, true);
  assert.equal(result.committed, true);
  assert.equal(git(a, 'log', '-1', '--format=%s').trim(), 'local work');
  // Diverged: a fast-forward pull must refuse and touch nothing.
  const pull = await pullFastForward(dir);
  assert.equal(pull.ok, false);
  assert.equal(pull.conflict, true);
  assert.equal(git(a, 'log', '-1', '--format=%s').trim(), 'local work');
});

test('git: a fast-forward pull brings the remote work in', async () => {
  const { a, b, project: dir } = repos();
  writeFileSync(path.join(b, 'Atlas', 'from-b.json'), '{}');
  git(b, 'add', '-A');
  git(b, 'commit', '-m', 'b');
  git(b, 'push');
  git(a, 'fetch');
  assert.equal((await inspect(dir)).behind, 1);
  const pull = await pullFastForward(dir);
  assert.equal(pull.ok, true, pull.message);
  assert.equal(readFileSync(path.join(dir, 'from-b.json'), 'utf8'), '{}');
  assert.equal(commitText('Sync {summary}', 'Atlas (2 fichiers)'), 'Sync Atlas (2 fichiers)');
});

function gitSync(
  dir: string,
  answers: ((r: any) => any)[],
  over: Partial<Settings['integrations']['git']> = {},
) {
  const asked: any[] = [];
  const journal = new Journal();
  let reloaded = 0;
  const sync = new GitSync({
    settings: () => settings({ git: { pushOnChange: true, delaySeconds: 10, ...over } }),
    projects: () => [{ id: 'p1', name: 'Atlas', directory: dir }],
    confirm: async (r) => {
      asked.push(r);
      return answers.shift()?.(r) ?? { accepted: false };
    },
    journal,
    isBusy: () => false,
    reload: async () => void reloaded++,
  });
  return { sync, asked, journal, reloaded: () => reloaded };
}

test('git sync: asks before pulling, then fast-forwards and reloads the projects', async () => {
  const { a, b, project: dir } = repos();
  writeFileSync(path.join(b, 'Atlas', 'x.json'), '{}');
  git(b, 'add', '-A');
  git(b, 'commit', '-m', 'b');
  git(b, 'push');
  const decline = gitSync(dir, [() => ({ accepted: false })]);
  await decline.sync.checkPull();
  assert.equal(decline.asked.length, 1);
  assert.equal(git(a, 'log', '-1', '--format=%s').trim(), 'init', 'declined: nothing moved');
  const accept = gitSync(dir, [() => ({ accepted: true })]);
  await accept.sync.checkPull();
  assert.equal(accept.reloaded(), 1);
  assert.equal(git(a, 'log', '-1', '--format=%s').trim(), 'b');
});

test('git sync: diverged histories are reported as a notice and left untouched', async () => {
  const { a, b, project: dir } = repos();
  writeFileSync(path.join(b, 'Atlas', 'x.json'), '{}');
  git(b, 'add', '-A');
  git(b, 'commit', '-m', 'b');
  git(b, 'push');
  writeFileSync(path.join(dir, 'y.json'), '{}');
  git(a, 'add', '-A');
  git(a, 'commit', '-m', 'a-local');
  const run = gitSync(dir, [() => ({ accepted: false })]);
  await run.sync.checkPull();
  assert.equal(run.asked.length, 1);
  assert.equal(run.asked[0].informational, true);
  assert.equal(git(a, 'log', '-1', '--format=%s').trim(), 'a-local');
  assert.equal(run.journal.list()[0].ok, false);
});

test('git sync: proposes a push with an editable message, honors a « later », and asks again only when files change', async () => {
  const { a, project: dir } = repos();
  writeFileSync(path.join(dir, 'new.json'), '{}');
  const run = gitSync(dir, [
    () => ({ accepted: false }),
    () => ({ accepted: true, edited: 'Mon message' }),
  ]);
  await run.sync.proposePush();
  assert.equal(run.asked.length, 1);
  assert.equal(run.asked[0].kind, 'git-push');
  assert.match(run.asked[0].editable.value, /Atlas \(1 fichier\)/);
  await run.sync.proposePush();
  assert.equal(run.asked.length, 1, 'same changes after « later »: not asked again');
  writeFileSync(path.join(dir, 'newer.json'), '{}');
  await run.sync.proposePush();
  assert.equal(run.asked.length, 2);
  assert.equal(git(a, 'log', '-1', '--format=%s').trim(), 'Mon message');
  const quiet = gitSync(dir, []);
  await quiet.sync.proposePush();
  assert.equal(quiet.asked.length, 0, 'nothing changed: no window');
});

test('confirm broker: answers reach the waiter, quitting answers « no »', async () => {
  const shown: any[] = [];
  const broker = new ConfirmBroker((r) => shown.push(r));
  const pending = broker.ask({
    kind: 'ticket',
    title: 't',
    message: 'm',
    details: [],
    confirmLabel: 'ok',
  });
  broker.answer(shown[0].id, { accepted: true, edited: 'x' });
  assert.deepEqual(await pending, { accepted: true, edited: 'x' });
  const second = broker.ask({
    kind: 'ticket',
    title: 't',
    message: 'm',
    details: [],
    confirmLabel: 'ok',
  });
  broker.cancelAll();
  assert.deepEqual(await second, { accepted: false });
});

/* ---------- regressions ---------- */
test('regressions: only steps that passed before count; flaky, never-worked and passing steps do not', () => {
  const pass = (id: string, name = id) => entry({ nodeId: id, nodeName: name });
  const fail = (id: string, name = id) =>
    entry({ nodeId: id, nodeName: name, status: 'failed', message: 'introuvable' });
  const past = (n: number) =>
    detail(
      'old',
      Array.from({ length: n }, (_, i) =>
        report([pass('login'), pass('flaky'), fail('never')], {
          id: 'o' + i,
          startedAt: `2026-01-0${i + 1}`,
        }),
      ),
    );
  const flakyHistory = detail('old2', [
    report([entry({ nodeId: 'flaky', status: 'failed' })], { id: 'f1', startedAt: '2025-12-01' }),
    report([pass('flaky')], { id: 'f2', startedAt: '2025-12-02' }),
    report([entry({ nodeId: 'flaky', status: 'failed' })], { id: 'f3', startedAt: '2025-12-03' }),
    report([pass('flaky')], { id: 'f4', startedAt: '2025-12-04' }),
  ]);
  const now = report([fail('login', 'Se connecter'), fail('flaky'), fail('never'), pass('other')], {
    startedAt: '2026-03-01',
  });
  const regressions = findRegressions(now, [past(3), flakyHistory]);
  assert.deepEqual(
    regressions.map((r) => r.nodeId),
    ['login'],
  );
  assert.match(regressions[0].history, /passed before|failed once after/);
  // The persisted copy of the run itself must not count twice.
  assert.equal(findRegressions(now, [detail('self', [now]), past(3), flakyHistory]).length, 1);
  assert.deepEqual(findRegressions(report([pass('login')]), [past(3)]), []);
  assert.deepEqual(
    findRegressions(report([fail('login')]), []),
    [],
    'no history: not a regression',
  );
});

test('regressions: secrets are the values of secret-looking variables', () => {
  assert.deepEqual(secretsOf(project()), ['hunter2hunter2']);
});

/* ---------- notifications ---------- */
const msg: Message = { title: 'A <b>', lines: ['x & y'], level: 'error' };
test('notify: Slack text escapes, Teams gets an adaptive card, mail is plain text', () => {
  assert.equal(slackText(msg), '*A &lt;b&gt;*\n• x &amp; y');
  const card = teamsPayload(msg);
  assert.equal(card.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');
  assert.equal(card.attachments[0].content.body[0].text, 'A <b>');
  assert.equal(card.attachments[0].content.body[0].color, 'Attention');
});

function notifier(integrations: unknown, over: Record<string, unknown> = {}) {
  const dir = tmp();
  const secrets = new SecretStore(path.join(dir, 's.json'));
  const journal = new Journal();
  const sent = fakeFetch(() => 'ok');
  const mails: any[] = [];
  const projectObj = project();
  const n = new Notifier({
    settings: () => settings(integrations),
    secrets,
    journal,
    project: (id) => (id === 'p1' ? projectObj : undefined),
    loadCampaign: async () => detail('c-now', []),
    media: { screenshot: async () => 'data:image/png;base64,iVBOR', video: async () => null },
    fetchImpl: sent.impl,
    mail: (async (o: any) => void mails.push(o)) as never,
    ...over,
  });
  return { n, secrets, journal, sent, mails, project: projectObj };
}
const slackOn = {
  notifications: {
    slack: { enabled: true },
    events: { stepFailed: true, regression: true, progress: false, runFinished: false },
  },
};

test('notify: nothing is sent when no channel is on or the secret is missing (and the journal says why)', async () => {
  const off = notifier({});
  await off.n.onRun(report([entry({ status: 'failed' })], { status: 'running' }));
  assert.equal(off.sent.calls.length, 0);
  const missing = notifier(slackOn);
  await missing.n.onRun(report([entry({ status: 'failed' })], { status: 'running' }));
  assert.equal(missing.sent.calls.length, 0);
  assert.equal(missing.journal.list()[0].ok, false);
  assert.match(missing.journal.list()[0].message, /webhook Slack/);
});

test('notify: failing tests are capped per run, never repeated, and secrets are masked', async () => {
  const t = notifier({ notifications: { ...slackOn.notifications, maxFailuresPerRun: 2 } });
  await t.secrets.set('slackWebhook', 'https://hooks.slack.test/T/B/secret');
  const fails = [1, 2, 3, 4].map((i) =>
    entry({
      id: 'e' + i,
      nodeId: 's' + i,
      nodeName: 'Étape ' + i,
      status: 'failed',
      message: i === 1 ? 'mot de passe hunter2hunter2 refusé' : 'boom',
    }),
  );
  const r = report(fails, { status: 'running' });
  await t.n.onRun(r);
  await t.n.onRun(r);
  assert.equal(t.sent.calls.length, 2, 'two sent, the rest suppressed, no repeats');
  assert.ok(t.sent.calls.every((c) => c.url === 'https://hooks.slack.test/T/B/secret'));
  assert.ok(
    !JSON.stringify(t.sent.calls[0].json).includes('hunter2'),
    'secret variable values never leave',
  );
  assert.match(t.sent.calls[0].json.text, /REDACTED/);
  await t.n.onFinished({
    report: { ...r, status: 'failed' },
    project: t.project,
    campaignLabel: 'C',
    regressions: [],
    secrets: [],
  });
  assert.equal(t.sent.calls.length, 2, 'run summary is off by default');
});

test('notify: a regression sends one message per run with the analysis only when asked', async () => {
  const t = notifier(slackOn);
  await t.secrets.set('slackWebhook', 'https://hooks.slack.test/x');
  const r = report([
    entry({
      id: 'bad',
      status: 'failed',
      message: 'KO',
      analysisData: {
        verdict: 'regression',
        summary: 'Le bouton a changé',
        evidence: [],
        fix: 'ajouter un id',
      },
    }),
  ]);
  const regressions = [
    {
      os: 'android' as const,
      nodeId: 'step1',
      name: 'Se connecter',
      message: 'KO',
      entryId: 'bad',
      history: 'passed 9 of 10',
      analysis: 'Le bouton a changé',
      fix: 'ajouter un id',
      verdict: 'regression',
    },
  ];
  await t.n.onFinished({
    report: r,
    project: t.project,
    campaignLabel: 'Nuit',
    regressions,
    secrets: [],
  });
  assert.equal(t.sent.calls.length, 1);
  assert.match(t.sent.calls[0].json.text, /Régression/);
  assert.match(t.sent.calls[0].json.text, /Le bouton a changé/);
  const noAnalysis = notifier({
    notifications: { ...slackOn.notifications, include: { analysis: false } },
  });
  await noAnalysis.secrets.set('slackWebhook', 'https://hooks.slack.test/x');
  await noAnalysis.n.onFinished({
    report: r,
    project: noAnalysis.project,
    campaignLabel: 'Nuit',
    regressions,
    secrets: [],
  });
  assert.ok(!noAnalysis.sent.calls[0].json.text.includes('Le bouton a changé'));
  const none = notifier(slackOn);
  await none.secrets.set('slackWebhook', 'https://hooks.slack.test/x');
  await none.n.onFinished({
    report: r,
    project: none.project,
    campaignLabel: 'Nuit',
    regressions: [],
    secrets: [],
  });
  assert.equal(none.sent.calls.length, 0, 'no regression: silence');
});

test('notify: progress is announced once per threshold, a jump is one message', async () => {
  const percents = [4, 12, 18, 35, 100];
  let i = 0;
  const t = notifier(
    {
      notifications: {
        slack: { enabled: true },
        events: { progress: true, regression: false, stepFailed: false, runFinished: false },
        progressStep: 10,
      },
    },
    {
      loadCampaign: async () => {
        const percent = percents[Math.min(i++, percents.length - 1)];
        // 20 planned results: the share finished gives the percentage.
        const done = Math.round((percent / 100) * 20);
        const nodes: ScenarioNode[] = [
          {
            id: 'sc',
            kind: 'scenario',
            name: 'S',
            children: Array.from({ length: 20 }, (_, k) => ({
              id: 't' + k,
              kind: 'test',
              name: 't' + k,
              children: [],
              variants: { android: { selector: { using: 'id', value: 'x' } } },
              tags: [],
              platforms: undefined,
            })),
          } as never,
        ];
        t.project.nodes = nodes;
        t.project.platforms = ['android'];
        return detail('c-now', [
          report(
            Array.from({ length: done }, (_, k) => entry({ id: 'd' + k, nodeId: 't' + k })),
            { snapshot: nodes },
          ),
        ]);
      },
    },
  );
  await t.secrets.set('slackWebhook', 'https://hooks.slack.test/x');
  const live = (n: number) =>
    report(
      Array.from({ length: n }, (_, k) => entry({ id: 'd' + k, nodeId: 't' + k })),
      { status: 'running', id: 'live', platforms: ['android'] },
    );
  const realNow = Date.now;
  let clock = 1_000_000;
  Date.now = () => (clock += 10_000);
  try {
    for (const n of [1, 3, 4, 7, 20]) await t.n.onRun(live(n));
  } finally {
    Date.now = realNow;
  }
  const titles = t.sent.calls.map((c) => c.json.text.split('\n')[0]);
  assert.ok(titles.length >= 1 && titles.length <= 3, titles.join(' | '));
  assert.equal(new Set(titles).size, titles.length, 'no threshold announced twice');
  assert.ok(
    titles.every((x) => !x.includes('100')),
    '100 % is the end-of-run message',
  );
});

test('notify: e-mail carries the analysis and attachments; Slack and Teams never get files', async () => {
  const t = notifier({
    notifications: {
      slack: { enabled: true },
      email: {
        enabled: true,
        host: 'smtp.test',
        port: 587,
        from: 'qa@x.io',
        to: 'a@x.io; b@x.io',
        username: 'u',
      },
      events: { stepFailed: true },
      include: { screenshot: true, analysis: true },
    },
  });
  await t.secrets.set('slackWebhook', 'https://hooks.slack.test/x');
  await t.secrets.set('smtpPassword', 'pw-secret');
  const bad = entry({ id: 'e1', status: 'failed', message: 'KO' });
  await t.n.onRun(report([bad], { status: 'running', id: '11111111-1111-4111-8111-111111111111' }));
  assert.equal(t.mails.length, 1);
  assert.deepEqual(t.mails[0].to, ['a@x.io', 'b@x.io']);
  assert.equal(t.mails[0].password, 'pw-secret');
  assert.equal(t.mails[0].attachments.length, 1);
  assert.equal(t.mails[0].attachments[0].contentType, 'image/png');
  assert.match(t.mails[0].subject, /^\[Cybermonkey\]/);
  assert.equal(t.sent.calls.length, 1);
  assert.ok(!('attachments' in t.sent.calls[0].json));
});

test('notify: the test button reaches only the chosen channel', async () => {
  const t = notifier({ notifications: { slack: { enabled: true }, teams: { enabled: true } } });
  await t.secrets.set('slackWebhook', 'https://hooks.slack.test/x');
  await t.secrets.set('teamsWebhook', 'https://teams.test/y');
  const r = await t.n.test('teams');
  assert.equal(r.ok, true);
  assert.deepEqual(
    t.sent.calls.map((c) => c.url),
    ['https://teams.test/y'],
  );
  const bad = await notifier({}).n.test('slack');
  assert.equal(bad.ok, false);
  assert.ok(
    failureMessage(
      t.project,
      report([]),
      entry({ status: 'failed' }),
      { analysis: true, screenshot: false, video: false },
      false,
    ).title.startsWith('Failed'),
  );
});

/* ---------- SMTP ---------- */
function smtpServer(options: { authCode?: number } = {}) {
  const received = { commands: [] as string[], data: '' };
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    socket.write('220 test ESMTP\r\n');
    let buffer = '';
    let inData = false;
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          received.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          socket.write('250 queued\r\n');
          continue;
        }
        const i = buffer.indexOf('\r\n');
        if (i < 0) return;
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        received.commands.push(line);
        if (/^EHLO/.test(line)) socket.write('250-test\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (/^AUTH PLAIN/.test(line)) socket.write(`${options.authCode ?? 235} auth\r\n`);
        else if (/^(MAIL|RCPT)/.test(line)) socket.write('250 ok\r\n');
        else if (line === 'DATA') {
          inData = true;
          socket.write('354 go\r\n');
        } else if (line === 'QUIT') {
          socket.write('221 bye\r\n');
          socket.end();
        } else socket.write('500 ?\r\n');
      }
    });
  });
  return new Promise<{ port: number; received: typeof received; close: () => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: (server.address() as net.AddressInfo).port,
        received,
        close: () => server.close(),
      }),
    ),
  );
}

test('smtp: sends a UTF-8 message with an attachment through a real socket', async () => {
  const server = await smtpServer();
  try {
    await sendMail({
      host: '127.0.0.1',
      port: server.port,
      security: 'none',
      username: 'u',
      password: 'p',
      from: 'Cybermonkey <qa@x.io>',
      to: ['a@x.io', 'B <b@x.io>'],
      subject: 'Régression ✘',
      text: 'Étape « Se connecter » échoue\n.\nligne avec point',
      attachments: [
        { filename: 'capture.png', contentType: 'image/png', data: Buffer.from('PNGDATA') },
      ],
    });
    const c = server.received.commands;
    assert.ok(c.some((l) => l.startsWith('AUTH PLAIN')));
    assert.ok(c.includes('MAIL FROM:<qa@x.io>'));
    assert.ok(c.includes('RCPT TO:<a@x.io>') && c.includes('RCPT TO:<b@x.io>'));
    assert.ok(c.includes('QUIT'));
    const data = server.received.data;
    assert.match(data, /Subject: =\?UTF-8\?B\?/);
    assert.match(data, /multipart\/mixed/);
    assert.match(data, /filename="capture\.png"/);
    assert.ok(data.includes(Buffer.from('PNGDATA').toString('base64')));
    const textPart = data.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0];
    assert.match(
      Buffer.from(textPart.replace(/\r\n/g, ''), 'base64').toString(),
      /Se connecter » échoue\n\.\nligne avec point/,
    );
  } finally {
    server.close();
  }
});

test('smtp: bad credentials, bad addresses and clear-text passwords are refused with a clear message', async () => {
  const refusing = await smtpServer({ authCode: 535 });
  try {
    await assert.rejects(
      sendMail({
        host: '127.0.0.1',
        port: refusing.port,
        security: 'none',
        username: 'u',
        password: 'wrong',
        from: 'a@x.io',
        to: ['b@x.io'],
        subject: 's',
        text: 't',
      }),
      /identifiants/,
    );
  } finally {
    refusing.close();
  }
  await assert.rejects(
    sendMail({
      host: 'smtp.example.com',
      port: 25,
      security: 'none',
      username: 'u',
      password: 'p',
      from: 'a@x.io',
      to: ['b@x.io'],
      subject: 's',
      text: 't',
    }),
    /sans chiffrement/,
  );
  await assert.rejects(
    sendMail({
      host: 'localhost',
      port: 1,
      security: 'none',
      from: 'nope',
      to: ['b@x.io'],
      subject: 's',
      text: 't',
    }),
    /expéditeur invalide/,
  );
  await assert.rejects(
    sendMail({
      host: 'localhost',
      port: 1,
      security: 'none',
      from: 'a@x.io',
      to: [],
      subject: 's',
      text: 't',
    }),
    /destinataire/,
  );
  assert.equal(addressOf('Qui <q@x.io>'), 'q@x.io');
  assert.ok(
    !buildMessage({
      host: '',
      port: 1,
      security: 'none',
      from: 'a@x.io',
      to: ['b@x.io'],
      subject: 'Hi\r\nBcc: evil@x.io',
      text: 't',
    }).includes('\r\nBcc:'),
    'header injection',
  );
});

/* ---------- tickets ---------- */
const reg = (over: Record<string, unknown> = {}) => ({
  os: 'android' as const,
  nodeId: 'login',
  name: 'Se connecter',
  message: 'introuvable',
  entryId: 'e1',
  history: 'passed 9 of the last 10 runs',
  analysis: 'Sélecteur modifié',
  fix: 'ajouter un id',
  verdict: 'regression',
  ...over,
});
const finished = (regressions = [reg()], over: Record<string, unknown> = {}) => ({
  report: report([entry({ id: 'e1', nodeId: 'login', status: 'failed' })]),
  project: project(),
  campaignLabel: 'Nuit',
  regressions,
  secrets: ['hunter2hunter2'],
  ...over,
});

test('tickets: drafts follow the tracker markup and never leak variable values', () => {
  const f = finished([reg({ message: 'mot de passe hunter2hunter2' })]);
  const gh = draftOf(f, f.regressions, 'github', true);
  const jira = draftOf(f, f.regressions, 'jira', true);
  assert.match(gh.title, /Régression : Se connecter \(Android\)/);
  assert.match(gh.body, /### Étapes/);
  assert.match(jira.body, /h3\. Étapes/);
  assert.match(jira.body, /\*\* passed 9/);
});

test('tickets: Jira payload merges fixed fields, lets the AI add custom fields, and forbids it project / issuetype', () => {
  const c = integrationsSchema.parse({
    tickets: {
      jira: {
        projectKey: 'APP',
        issueType: 'Bug',
        labels: 'qa, mobile',
        extraFields: '{"customfield_10010":"Mobile","labels":["extra"]}',
      },
    },
  }).tickets.jira;
  const { payload, dropped } = jiraPayload(
    c,
    { title: 'T', body: 'B' },
    {
      summary: 'Titre IA',
      description: 'Desc IA',
      fields: {
        customfield_10201: { value: 'QA' },
        project: { key: 'HACK' },
        issuetype: { name: 'Epic' },
        reporter: { id: 'x' },
        priority: { name: 'High' },
        labels: ['ia'],
      },
    },
  );
  const f = payload.fields as any;
  assert.deepEqual(f.project, { key: 'APP' });
  assert.deepEqual(f.issuetype, { name: 'Bug' });
  assert.equal(f.summary, 'Titre IA');
  assert.equal(f.customfield_10010, 'Mobile');
  assert.deepEqual(f.customfield_10201, { value: 'QA' });
  assert.deepEqual(f.priority, { name: 'High' });
  assert.deepEqual(f.labels.sort(), ['extra', 'ia', 'mobile', 'qa']);
  assert.deepEqual(dropped.sort(), ['issuetype', 'project', 'reporter']);
  assert.throws(() => parseExtraFields('{oops'), /JSON invalide/);
  assert.throws(() => parseExtraFields('[1]'), /objet JSON/);
  assert.deepEqual(parseExtraFields(''), {});
  assert.deepEqual(
    githubPayload(
      integrationsSchema.parse({}).tickets.github,
      { title: 'T', body: 'B' },
      { labels: ['ia'] },
    ).labels,
    ['bug', 'cybermonkey', 'ia'],
  );
});

test('tickets: the key is stable per set of regressions', () => {
  const a = ticketKey('p', 'github', [reg(), reg({ nodeId: 'pay' })]);
  assert.equal(a, ticketKey('p', 'github', [reg({ nodeId: 'pay' }), reg()]));
  assert.notEqual(a, ticketKey('p', 'jira', [reg(), reg({ nodeId: 'pay' })]));
  assert.notEqual(a, ticketKey('p', 'github', [reg()]));
});

function tickets(
  integrations: unknown,
  script: (url: string, init: RequestInit) => unknown,
  extra: Record<string, unknown> = {},
) {
  const dir = tmp();
  const secrets = new SecretStore(path.join(dir, 's.json'));
  const journal = new Journal();
  const http = fakeFetch(script);
  const service = new TicketService({
    settings: () => settings(integrations),
    secrets,
    journal,
    ledgerFile: path.join(dir, 'tickets.json'),
    fetchImpl: http.impl,
    ...extra,
  });
  return { service, secrets, journal, http };
}
const github = {
  tickets: { mode: 'auto', provider: 'github', github: { owner: 'acme', repo: 'app' } },
};

test('tickets: GitHub issue created once, never duplicated while open, recreated once closed', async () => {
  let state = 'open';
  const t = tickets(github, (url, init) => {
    if (init.method === 'POST' && url.endsWith('/issues'))
      return { number: 42, html_url: 'https://github.com/acme/app/issues/42' };
    if (url.endsWith('/issues/42')) return { state };
    return {};
  });
  await t.secrets.set('githubToken', 'ghp_secret_token');
  await t.service.onFinished(finished() as never);
  const create = t.http.calls.find((c) => c.init.method === 'POST')!;
  assert.equal(create.url, 'https://api.github.com/repos/acme/app/issues');
  assert.equal((create.init.headers as any).Authorization, 'Bearer ghp_secret_token');
  assert.match(create.json.title, /Régression/);
  assert.ok(!JSON.stringify(create.json).includes('hunter2'));
  assert.deepEqual(create.json.labels, ['bug', 'cybermonkey']);
  assert.match(t.journal.list()[0].message, /issues\/42/);
  await t.service.onFinished(finished() as never);
  assert.equal(
    t.http.calls.filter((c) => c.init.method === 'POST').length,
    1,
    'open ticket: no duplicate',
  );
  assert.match(t.journal.list()[0].message, /déjà ouvert/);
  state = 'closed';
  await t.service.onFinished(finished() as never);
  assert.equal(
    t.http.calls.filter((c) => c.init.method === 'POST').length,
    2,
    'closed: a new regression deserves a new ticket',
  );
});

test('tickets: nothing without regressions, when off, or on a cancelled run; errors never echo the token', async () => {
  const off = tickets({ tickets: { mode: 'off' } }, () => ({}));
  await off.service.onFinished(finished() as never);
  assert.equal(off.http.calls.length, 0);
  const t = tickets(
    github,
    () => new Response('{"message":"Bad credentials ghp_secret_token"}', { status: 401 }),
  );
  await t.secrets.set('githubToken', 'ghp_secret_token');
  await t.service.onFinished(finished([]) as never);
  await t.service.onFinished(
    finished([reg()], { report: report([], { status: 'cancelled' }) }) as never,
  );
  assert.equal(t.http.calls.length, 0);
  await t.service.onFinished(finished() as never);
  const last = t.journal.list()[0];
  assert.equal(last.ok, false);
  assert.match(last.message, /401/);
  assert.ok(!last.message.includes('ghp_secret_token'));
  const noToken = tickets(github, () => ({}));
  await noToken.service.onFinished(finished() as never);
  assert.match(noToken.journal.list()[0].message, /Jeton GitHub/);
});

test('tickets: « ask » shows the exact payload, honors edits, a refusal and the absence of a window', async () => {
  const ask = {
    tickets: { mode: 'ask', provider: 'github', github: { owner: 'acme', repo: 'app' } },
  };
  const seen: any[] = [];
  const editing = tickets(
    ask,
    (url, init) => (init.method === 'POST' ? { number: 7, html_url: 'u' } : {}),
    {
      confirm: async (r: any) => (
        seen.push(r),
        { accepted: true, edited: JSON.stringify({ title: 'Titre édité', body: 'b' }) }
      ),
    },
  );
  await editing.secrets.set('githubToken', 'tok-tok-tok');
  await editing.service.onFinished(finished() as never);
  assert.equal(seen[0].kind, 'ticket');
  assert.match(seen[0].editable.value, /"title"/);
  assert.equal(editing.http.calls.find((c) => c.init.method === 'POST')!.json.title, 'Titre édité');

  const broken = tickets(ask, () => ({}), {
    confirm: async () => ({ accepted: true, edited: '{not json' }),
  });
  await broken.secrets.set('githubToken', 'tok-tok-tok');
  await broken.service.onFinished(finished() as never);
  assert.equal(broken.http.calls.length, 0);
  assert.match(broken.journal.list()[0].message, /JSON invalide/);

  const refused = tickets(ask, () => ({}), { confirm: async () => ({ accepted: false }) });
  await refused.secrets.set('githubToken', 'tok-tok-tok');
  await refused.service.onFinished(finished() as never);
  assert.equal(refused.http.calls.length, 0);

  const headless = tickets(ask, () => ({}));
  await headless.secrets.set('githubToken', 'tok-tok-tok');
  await headless.service.onFinished(finished() as never);
  assert.equal(headless.http.calls.length, 0);
  assert.match(headless.journal.list()[0].message, /aucune fenêtre/);
});

test('tickets: Jira ticket with AI-written custom fields, attachment, and a fallback when the AI fails', async () => {
  const jira = {
    tickets: {
      mode: 'auto',
      provider: 'jira',
      useAi: true,
      instructions: 'Équipe: customfield_10201 = {"value":"Mobile QA"}',
      jira: {
        url: 'https://acme.atlassian.net/',
        email: 'qa@acme.io',
        projectKey: 'APP',
        issueType: 'Bug',
      },
    },
  };
  const aiReply = {
    summary: 'Login cassé',
    description: 'h3. Détail',
    fields: { customfield_10201: { value: 'Mobile QA' }, project: { key: 'EVIL' } },
  };
  const prompts: string[] = [];
  const hub = {
    converse: async (_s: string, _sig: AbortSignal, run: (c: any) => Promise<unknown>) =>
      run({ send: async (p: string) => (prompts.push(p), JSON.stringify(aiReply)) }),
  };
  const t = tickets(
    jira,
    (url, init) => {
      if (url.endsWith('/rest/api/2/issue') && init.method === 'POST') return { key: 'APP-9' };
      return {};
    },
    { hub, screenshot: async () => 'data:image/png;base64,iVBORw0KGgo=' },
  );
  await t.secrets.set('jiraToken', 'jira-api-token');
  await t.service.onFinished(finished() as never);
  const create = t.http.calls.find((c) => c.url === 'https://acme.atlassian.net/rest/api/2/issue')!;
  assert.equal(
    (create.init.headers as any).Authorization,
    'Basic ' + Buffer.from('qa@acme.io:jira-api-token').toString('base64'),
  );
  assert.deepEqual(create.json.fields.project, { key: 'APP' }, 'the AI cannot change the project');
  assert.deepEqual(create.json.fields.customfield_10201, { value: 'Mobile QA' });
  assert.equal(create.json.fields.summary, 'Login cassé');
  assert.match(prompts[0], /customfield_10201/);
  assert.ok(!prompts[0].includes('hunter2hunter2'));
  const attach = t.http.calls.find((c) => c.url.endsWith('/APP-9/attachments'))!;
  assert.equal((attach.init.headers as any)['X-Atlassian-Token'], 'no-check');
  assert.ok(t.journal.list().some((e) => /browse\/APP-9/.test(e.message)));

  const failingHub = {
    converse: async () => {
      throw new Error('quota');
    },
  };
  const fallback = tickets(jira, (url, init) => (init.method === 'POST' ? { key: 'APP-10' } : {}), {
    hub: failingHub,
  });
  await fallback.secrets.set('jiraToken', 'jira-api-token');
  await fallback.service.onFinished(finished() as never);
  const created = fallback.http.calls.find((c) => c.init.method === 'POST')!;
  assert.match(created.json.fields.summary, /Régression/, 'default draft when the AI fails');
  assert.ok(fallback.journal.list().some((e) => !e.ok && /sans l’IA/.test(e.message)));
});

test('tickets: connection test proves access and rejects bad extra fields', async () => {
  const t = tickets(
    {
      tickets: {
        provider: 'jira',
        jira: {
          url: 'https://acme.atlassian.net',
          email: 'a@b.io',
          projectKey: 'APP',
          extraFields: '{bad',
        },
      },
    },
    () => ({ displayName: 'Bob' }),
  );
  await t.secrets.set('jiraToken', 'jira-api-token');
  const r = await t.service.test();
  assert.equal(r.ok, false);
  assert.match(r.message, /JSON invalide/);
  const ok = tickets(
    { tickets: { provider: 'github', github: { owner: 'a', repo: 'b' } } },
    () => ({ full_name: 'a/b', has_issues: true }),
  );
  await ok.secrets.set('githubToken', 'tok-tok-tok');
  assert.equal((await ok.service.test()).ok, true);
});

/* ---------- test-management tools ---------- */
const scenario = (
  id: string,
  name: string,
  source?: { tool: string; id: string },
  steps = ['s1'],
) =>
  ({
    id,
    kind: 'scenario',
    name,
    source,
    tags: [],
    children: steps.map((s) => ({
      id: id + s,
      kind: 'test',
      name: s,
      children: [],
      tags: [],
      variants: {},
    })),
  }) as unknown as ScenarioNode;

test('trackers: the case id comes from the scenario source; ids like C123 and plain numbers both work', () => {
  assert.equal(caseIdFor(scenario('a', 'A', { tool: 'testrail', id: 'C123' }), 'testrail'), '123');
  assert.equal(caseIdFor(scenario('a', 'A', { tool: 'TestRail', id: '45' }), 'testrail'), '45');
  assert.equal(caseIdFor(scenario('a', 'A', { tool: 'azure', id: '77' }), 'azure'), '77');
  assert.equal(caseIdFor(scenario('a', 'A', { tool: 'azure', id: '77' }), 'testrail'), undefined);
  assert.equal(
    caseIdFor(scenario('a', 'A', { tool: 'testrail', id: 'abc' }), 'testrail'),
    undefined,
  );
  assert.equal(caseIdFor(scenario('a', 'A'), 'testrail'), undefined);
});

test('trackers: one verdict per linked scenario, both OS folded, unlinked and unrun scenarios left out', () => {
  const snapshot = [
    scenario('s1', 'Login', { tool: 'testrail', id: 'C1' }, ['a', 'b']),
    scenario('s2', 'Panier', { tool: 'testrail', id: 'C2' }),
    scenario('s3', 'Libre'),
    scenario('s4', 'Pas joué', { tool: 'testrail', id: 'C4' }),
  ];
  const r = report(
    [
      entry({ nodeId: 's1a', platform: 'android' }),
      entry({ nodeId: 's1b', platform: 'ios', status: 'failed', message: 'KO ios secret-xyz' }),
      entry({ nodeId: 's2s1', platform: 'android' }),
      entry({ nodeId: 's2s1', platform: 'ios' }),
      entry({ nodeId: 's3s1' }),
    ],
    { snapshot, environment: 'recette' },
  );
  const { results, unlinked } = collectResults(r, 'testrail', ['secret-xyz']);
  assert.deepEqual(
    results.map((x) => [x.caseId, x.status]),
    [
      ['1', 'failed'],
      ['2', 'passed'],
    ],
  );
  assert.equal(unlinked, 1);
  assert.match(results[0].comment, /\[ios\] Se connecter/);
  assert.ok(!results[0].comment.includes('secret-xyz'));
  assert.match(results[0].comment, /recette/);
});

test('trackers: TestRail run is created with the linked cases, then their results are added', async () => {
  const http = fakeFetch((url) =>
    url.includes('add_run') ? { id: 99, url: 'https://x.testrail.io/index.php?/runs/view/99' } : {},
  );
  const url = await pushTestrail(
    integrationsSchema.parse({
      trackers: {
        testrail: {
          url: 'https://x.testrail.io/',
          username: 'qa@x.io',
          projectId: '5',
          suiteId: '8',
        },
      },
    }).trackers.testrail,
    'api-key',
    'Run Cybermonkey',
    [
      { caseId: '1', scenario: 'Login', status: 'failed', elapsedS: 12, comment: 'KO' },
      { caseId: '2', scenario: 'Panier', status: 'passed', elapsedS: 3, comment: 'OK' },
    ],
    http.impl,
  );
  assert.equal(url, 'https://x.testrail.io/index.php?/runs/view/99');
  assert.equal(http.calls[0].url, 'https://x.testrail.io/index.php?/api/v2/add_run/5');
  assert.deepEqual(http.calls[0].json, {
    name: 'Run Cybermonkey',
    suite_id: 8,
    include_all: false,
    case_ids: [1, 2],
  });
  assert.equal(
    http.calls[1].url,
    'https://x.testrail.io/index.php?/api/v2/add_results_for_cases/99',
  );
  assert.deepEqual(
    http.calls[1].json.results.map((r: any) => [r.case_id, r.status_id]),
    [
      [1, 5],
      [2, 1],
    ],
  );
  assert.equal(
    (http.calls[0].init.headers as any).Authorization,
    'Basic ' + Buffer.from('qa@x.io:api-key').toString('base64'),
  );
});

test('trackers: Azure Test Plans finds the points, creates the run, then completes each result', async () => {
  const http = fakeFetch((url, init) => {
    if (url.includes('/TestPoint?testCaseId=10')) return { value: [{ id: 501 }, { id: 502 }] };
    if (url.includes('/TestPoint?testCaseId=11')) return { value: [] };
    if (url.includes('/test/runs?') && init.method === 'POST') return { id: 7 };
    if (url.includes('/test/Runs/7/results') && init.method === 'GET')
      return {
        value: [
          { id: 100000, testCase: { id: '10' } },
          { id: 100001, testCase: { id: '10' } },
        ],
      };
    return {};
  });
  const c = integrationsSchema.parse({
    trackers: {
      azure: { url: 'https://dev.azure.com/acme', project: 'App', planId: '3', suiteId: '4' },
    },
  }).trackers.azure;
  await pushAzure(
    c,
    'pat',
    'Run',
    [
      { caseId: '10', scenario: 'A', status: 'failed', elapsedS: 2, comment: 'KO' },
      { caseId: '11', scenario: 'B', status: 'passed', elapsedS: 1, comment: 'OK' },
    ],
    http.impl,
  );
  const create = http.calls.find((x) => x.url.includes('/test/runs?') && x.init.method === 'POST')!;
  assert.deepEqual(
    create.json.pointIds,
    [501, 502],
    'the case with no point in the suite is left out',
  );
  assert.deepEqual(create.json.plan, { id: 3 });
  const patch = http.calls.find((x) => x.init.method === 'PATCH' && x.url.includes('/results'))!;
  assert.deepEqual(
    patch.json.map((r: any) => [r.id, r.outcome, r.state]),
    [
      [100000, 'Failed', 'Completed'],
      [100001, 'Failed', 'Completed'],
    ],
  );
  assert.deepEqual(http.calls.at(-1)!.json, { state: 'Completed' });
  assert.equal(
    (http.calls[0].init.headers as any).Authorization,
    'Basic ' + Buffer.from(':pat').toString('base64'),
  );
  await assert.rejects(
    pushAzure(
      c,
      'pat',
      'Run',
      [{ caseId: '11', scenario: 'B', status: 'passed', elapsedS: 1, comment: '' }],
      http.impl,
    ),
    /aucun des cas/,
  );
});

test('trackers: service skips unlinked runs, asks in « ask » mode, and pushes in « auto »', async () => {
  const mk = (mode: string, confirm?: any) => {
    const dir = tmp();
    const secrets = new SecretStore(path.join(dir, 's.json'));
    const journal = new Journal();
    const http = fakeFetch((url) =>
      url.includes('add_run') ? { id: 1, url: 'https://tr/run/1' } : {},
    );
    const service = new TrackerService({
      settings: () =>
        settings({
          trackers: {
            mode,
            kind: 'testrail',
            testrail: { url: 'https://tr', username: 'u', projectId: '1' },
          },
        }),
      secrets,
      journal,
      confirm,
      fetchImpl: http.impl,
    });
    return { service, secrets, journal, http };
  };
  const linked = report([entry({ nodeId: 's1s1' })], {
    snapshot: [scenario('s1', 'Login', { tool: 'testrail', id: 'C1' })],
  });
  const unlinked = report([entry({ nodeId: 's3s1' })], { snapshot: [scenario('s3', 'Libre')] });
  const auto = mk('auto');
  await auto.secrets.set('testrailApiKey', 'key');
  await auto.service.onFinished(finished([], { report: unlinked }) as never);
  assert.equal(auto.http.calls.length, 0);
  assert.match(auto.journal.list()[0].message, /Aucun scénario lié/);
  await auto.service.onFinished(finished([], { report: linked }) as never);
  assert.equal(auto.http.calls.length, 2);
  const asked: any[] = [];
  const ask = mk('ask', async (r: any) => (asked.push(r), { accepted: true, edited: 'Mon run' }));
  await ask.secrets.set('testrailApiKey', 'key');
  await ask.service.onFinished(finished([], { report: linked }) as never);
  assert.equal(asked[0].kind, 'tracker');
  assert.equal(ask.http.calls[0].json.name, 'Mon run');
  const off = mk('off');
  await off.service.onFinished(finished([], { report: linked }) as never);
  assert.equal(off.http.calls.length, 0);
});

/* ---------- hub: events in, integrations out ---------- */
test('hub: a finished run with a regression notifies, once, from the app’s own events', async () => {
  const dir = tmp();
  const proj = project();
  const old = detail(
    'c-old',
    Array.from({ length: 3 }, (_, i) =>
      report([entry({ nodeId: 'login', nodeName: 'Se connecter' })], {
        id: 'old' + i,
        campaignId: 'c-old',
        startedAt: `2026-01-0${i + 1}`,
      }),
    ),
  );
  const bad = report(
    [
      entry({
        id: 'bad',
        nodeId: 'login',
        nodeName: 'Se connecter',
        status: 'failed',
        message: 'introuvable',
      }),
    ],
    { id: 'run-now', startedAt: '2026-02-01' },
  );
  const now = detail('c-now', [bad]);
  const http = fakeFetch(() => 'ok');
  const hub = new IntegrationHub({
    userData: dir,
    settings: () => settings({ notifications: { slack: { enabled: true } } }),
    store: { state: { projects: [proj] } } as never,
    campaigns: {
      list: async () => [now.campaign, old.campaign],
      screenshot: async () => null,
      video: async () => null,
    } as never,
    loadCampaign: async (_p, id) => (id === 'c-now' ? now : old),
    isBusy: () => false,
    ai: {
      converse: async () => {
        throw new Error('no ai');
      },
    } as never,
    emit: () => {},
    interactive: false,
    fetchImpl: http.impl,
  });
  await hub.secrets.set('slackWebhook', 'https://hooks.slack.test/hub');
  hub.handle({ type: 'run', report: { ...bad, status: 'running' } });
  hub.handle({ type: 'run', report: bad as never });
  hub.handle({ type: 'run', report: bad as never });
  await hub.settled();
  const slack = http.calls.filter((c) => c.url === 'https://hooks.slack.test/hub');
  assert.equal(
    slack.length,
    1,
    'one regression message, however many times the final state is emitted',
  );
  assert.match(slack[0].json.text, /Se connecter/);
  const status = await hub.status();
  assert.equal(status.interactive, false);
  assert.ok(status.journal.some((e) => e.target === 'slack' && e.ok));
  const test = await hub.test(
    'slack',
    integrationsSchema.parse({ notifications: { slack: { enabled: true } } }),
  );
  assert.equal(test.ok, true);
  assert.equal((await hub.test('github', integrationsSchema.parse({}))).ok, false);
  assert.equal((await hub.setSecret('jiraToken', 'abc-token')).secrets.jiraToken, true);
});

/* ---------- language of the activity log ---------- */
test('activity log and errors follow the app language', async () => {
  const { followLanguage } = await import('../src/main/integrations/i18n.js');
  const english = settings(
    { tickets: { mode: 'auto', provider: 'github', github: { owner: 'acme', repo: 'app' } } },
    { language: 'en' },
  );
  try {
    const dir = tmp();
    const secrets = new SecretStore(path.join(dir, 's.json'));
    const journal = new Journal();
    const http = fakeFetch(() => new Response('{"message":"Bad credentials"}', { status: 401 }));
    const service = new TicketService({
      settings: () => english,
      secrets,
      journal,
      ledgerFile: path.join(dir, 't.json'),
      fetchImpl: http.impl,
    });
    followLanguage(() => english.language);
    await service.onFinished(finished() as never);
    assert.match(journal.list()[0].message, /GitHub token not set/);
    await secrets.set('githubToken', 'tok-tok-tok');
    await service.onFinished(finished() as never);
    assert.match(journal.list()[0].message, /HTTP 401/);

    const ok = fakeFetch((url, init) =>
      init.method === 'POST' ? { number: 3, html_url: 'https://x/3' } : {},
    );
    const created = new TicketService({
      settings: () => english,
      secrets,
      journal,
      ledgerFile: path.join(dir, 't2.json'),
      fetchImpl: ok.impl,
    });
    await created.onFinished(finished() as never);
    assert.match(journal.list()[0].message, /^Ticket created: /);
    assert.match(
      draftOf(finished() as never, [reg()], 'github', false).body,
      /Steps that no longer pass/,
    );

    await assert.rejects(
      sendMail({
        host: 'localhost',
        port: 1,
        security: 'none',
        from: 'nope',
        to: ['b@x.io'],
        subject: 's',
        text: 't',
      }),
      /Invalid sender address/,
    );
    const timedOut = fakeFetch(() => {
      throw Object.assign(new Error('x'), { name: 'TimeoutError' });
    });
    const { request } = await import('../src/main/integrations/http.js');
    await assert.rejects(request('https://x', { fetchImpl: timedOut.impl }), /Timed out/);

    const sync = gitSync(tmp(), []);
    assert.equal((await inspect(path.join(tmp(), 'missing'))).error, 'Folder not found.');
    assert.ok(sync);
  } finally {
    followLanguage(() => 'fr');
  }
  assert.match((await inspect(path.join(tmp(), 'missing'))).error ?? '', /Dossier introuvable/);
});
