import { flatten } from './scenario.js';
import type { CampaignDetail, RunEntry } from './report.js';
import type { Project } from './project.js';
import { buildScreenGraph, campaignFrames, campaignProgress, outcomeOf } from './campaign.js';

export const EXPORT_FORMATS = [
  'text',
  'csv',
  'markdown',
  'confluence',
  'html',
  'junit',
  'json',
] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const EXPORT_EXTENSIONS: Record<ExportFormat, [string, string]> = {
  text: ['txt', 'text/plain'],
  csv: ['csv', 'text/csv'],
  markdown: ['md', 'text/markdown'],
  confluence: ['txt', 'text/plain'],
  html: ['html', 'text/html'],
  junit: ['xml', 'application/xml'],
  json: ['json', 'application/json'],
};

const HEADERS = [
  'Run',
  'OS',
  'Step',
  'Screen',
  'Result',
  'Duration (s)',
  'Message',
  'Healing',
  'Analysis',
];
const osName = (os: string) => (os === 'ios' ? 'iOS' : 'Android');
const oneLine = (v: string) => v.replace(/[\r\n\t]+/g, ' ');
const duration = (e: RunEntry) =>
  e.finishedAt
    ? String(Math.max(0, Date.parse(e.finishedAt) - Date.parse(e.startedAt)) / 1000)
    : '';
const screenName = (e: RunEntry) =>
  (e.kind === 'navigation' ? (e.screenAfter ?? e.screenBefore) : (e.screenBefore ?? e.screenAfter))
    ?.name ?? '';

export function rows(detail: CampaignDetail): string[][] {
  return detail.reports.flatMap((r) =>
    r.entries
      .filter((e) => e.kind !== 'scenario' && !e.precondition && e.nodeId !== 'engine')
      .map((e) => [
        r.startedAt,
        osName(e.platform),
        e.nodeName,
        screenName(e),
        outcomeOf(e),
        duration(e),
        e.operationMessage ?? e.message,
        e.healing ? `${e.healing.from?.value ?? '?'} → ${e.healing.to.value}` : '',
        e.analysisData
          ? `${e.analysisData.verdict}: ${e.analysisData.summary}`
          : (e.analysis ?? ''),
      ]),
  );
}

export function summary(detail: CampaignDetail, project?: Pick<Project, 'nodes' | 'platforms'>) {
  const frames = campaignFrames(detail);
  const tests = frames.filter(({ entry }) => entry.kind === 'test');
  const passed = tests.filter(({ entry }) => outcomeOf(entry) === 'passed').length;
  const failed = tests.filter(({ entry }) => outcomeOf(entry) === 'failed').length;
  return {
    tests: tests.length,
    passed,
    failed,
    runs: detail.reports.length,
    progress: project ? campaignProgress(detail, project) : undefined,
  };
}

export function campaignText(
  detail: CampaignDetail,
  project?: Pick<Project, 'nodes' | 'platforms'>,
) {
  const { campaign, reports } = detail;
  const s = summary(detail, project);
  const graph = buildScreenGraph(detail, project ?? { nodes: [], platforms: ['android', 'ios'] });
  const lines = [
    `Campagne : ${oneLine(campaign.label)}`,
    `Créée le : ${campaign.createdAt}`,
    `État : ${campaign.status === 'completed' ? 'Terminée' : 'Ouverte'}`,
    `Exécutions : ${s.runs}`,
    `Vérifications : ${s.tests} — succès : ${s.passed} — échecs : ${s.failed}`,
  ];
  if (s.progress) {
    lines.push(
      `Avancement : ${s.progress.overall.percent}% (${s.progress.overall.passed + s.progress.overall.failed}/${s.progress.overall.total})`,
    );
    for (const [os, p] of Object.entries(s.progress.byOs))
      lines.push(
        `  ${osName(os)} : ${p!.percent}% — ${p!.passed} réussis, ${p!.failed} échecs, ${p!.pending} restants`,
      );
  }
  lines.push('', 'ÉCRANS');
  for (const sc of graph.screens)
    lines.push(
      `${sc.name} [${sc.id}] : ` +
        (['android', 'ios'] as const)
          .filter((o) => sc.stats[o])
          .map((o) => `${osName(o)} ${sc.stats[o]!.passed} ✓ ${sc.stats[o]!.failed} ✗`)
          .join(' · '),
    );
  lines.push(
    '',
    'TRANSITIONS OBSERVÉES',
    ...graph.edges
      .filter((e) => !e.planned || e.count)
      .map((e) => `${e.from} → ${e.to} (${e.count})`),
    '',
    'EXÉCUTIONS',
  );
  for (const report of reports) {
    lines.push(`${report.startedAt} · ${report.status} · ${report.id}`);
    const kinds = new Map(flatten(report.snapshot).map((n) => [n.id, n.kind]));
    for (const e of report.entries) {
      if (e.precondition || (e.kind ?? kinds.get(e.nodeId)) === 'scenario') continue;
      lines.push(
        `  ${e.platform} · ${oneLine(e.nodeName)} · ${outcomeOf(e)} · ${oneLine(screenName(e) || 'Écran non identifié')}`,
      );
      const message = e.operationMessage ?? e.message;
      if (message) lines.push('    ' + oneLine(message));
      if (e.healing) lines.push(`    Sélecteur réparé par l'IA : ${e.healing.to.value}`);
      if (e.screenshotError) lines.push('    Capture indisponible.');
      if (e.analysis) lines.push('    Analyse : ' + oneLine(e.analysis));
    }
  }
  return lines.join('\n');
}

const xml = (v: string) =>
  v
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function campaignExport(
  detail: CampaignDetail,
  format: ExportFormat = 'text',
  project?: Pick<Project, 'nodes' | 'platforms'>,
): string {
  if (format === 'text') return campaignText(detail, project);
  if (format === 'json')
    return JSON.stringify(
      {
        campaign: detail.campaign,
        summary: summary(detail, project),
        rows: rows(detail).map((r) => Object.fromEntries(HEADERS.map((h, i) => [h, r[i]]))),
      },
      null,
      2,
    );
  const data = rows(detail);
  if (format === 'csv') {
    const cell = (v: string) =>
      '"' + (/^[=+@\-\t\r]/.test(v) ? "'" + v : v).replace(/"/g, '""') + '"';
    return '﻿' + [HEADERS, ...data].map((r) => r.map(cell).join(',')).join('\r\n');
  }
  if (format === 'junit') {
    const byOs = new Map<string, RunEntry[]>();
    for (const r of detail.reports)
      for (const e of r.entries)
        if (e.kind !== 'scenario' && !e.precondition && e.nodeId !== 'engine')
          byOs.set(e.platform, [...(byOs.get(e.platform) ?? []), e]);
    const suites = [...byOs].map(([os, list]) => {
      const failures = list.filter((e) => outcomeOf(e) === 'failed').length;
      const skipped = list.filter((e) =>
        ['skipped', 'blocked', 'na', 'cancelled'].includes(outcomeOf(e)),
      ).length;
      const cases = list.map((e) => {
        const o = outcomeOf(e);
        const body =
          o === 'failed'
            ? `<failure message="${xml(oneLine(e.message))}">${xml(e.analysis ?? '')}</failure>`
            : ['skipped', 'blocked', 'na', 'cancelled'].includes(o)
              ? `<skipped message="${xml(oneLine(e.message))}"/>`
              : '';
        return `    <testcase classname="${xml(osName(os))}" name="${xml(e.nodeName)}" time="${duration(e) || '0'}">${body}</testcase>`;
      });
      return `  <testsuite name="${xml(detail.campaign.label)} · ${osName(os)}" tests="${list.length}" failures="${failures}" skipped="${skipped}">\n${cases.join('\n')}\n  </testsuite>`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="${xml(detail.campaign.label)}">\n${suites.join('\n')}\n</testsuites>\n`;
  }
  if (format === 'html') {
    const s = summary(detail, project);
    const color: Record<string, string> = {
      passed: '#1a9d5c',
      failed: '#d8343b',
      skipped: '#8a8f9f',
      blocked: '#c98a12',
      cancelled: '#8a8f9f',
      na: '#8a8f9f',
    };
    const body = data
      .map(
        (r) =>
          `<tr><td>${xml(r[1])}</td><td>${xml(r[2])}</td><td>${xml(r[3])}</td><td style="color:${color[r[4]] ?? '#333'};font-weight:600">${xml(r[4])}</td><td>${xml(r[5])}</td><td>${xml(r[6])}</td><td>${xml(r[8])}</td></tr>`,
      )
      .join('\n');
    return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${xml(detail.campaign.label)}</title><style>body{font:14px system-ui;margin:32px;color:#1b1d29}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e4e6ee;padding:6px 10px;text-align:left;vertical-align:top}th{background:#f4f5f9}.k{display:inline-block;margin-right:24px}</style><h1>${xml(detail.campaign.label)}</h1><p><span class="k">Runs: <b>${s.runs}</b></span><span class="k">Checks: <b>${s.tests}</b></span><span class="k" style="color:#1a9d5c">Passed: <b>${s.passed}</b></span><span class="k" style="color:#d8343b">Failed: <b>${s.failed}</b></span>${s.progress ? `<span class="k">Progress: <b>${s.progress.overall.percent}%</b></span>` : ''}</p><table><tr><th>OS</th><th>Step</th><th>Screen</th><th>Result</th><th>s</th><th>Message</th><th>Analysis</th></tr>${body}</table></html>`;
  }
  const escape = (v: string) =>
    oneLine(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(format === 'confluence' ? /[{}\[\]\\]/g : /[\\`*_\[\]]/g, (c) => '\\' + c)
      .replace(/\|/g, format === 'markdown' ? '\\|' : '&#124;');
  const title = escape(detail.campaign.label);
  if (format === 'confluence')
    return (
      `h1. ${title}\n\n||${HEADERS.join('||')}||\n` +
      data.map((r) => '|' + r.map(escape).join('|') + '|').join('\n')
    );
  return (
    `# ${title}\n\n| ${HEADERS.join(' | ')} |\n| ${HEADERS.map(() => '---').join(' | ')} |\n` +
    data.map((r) => '| ' + r.map(escape).join(' | ') + ' |').join('\n')
  );
}
