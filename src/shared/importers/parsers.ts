import {
  externalCaseSchema,
  type ExternalCase,
  type ExternalStep,
  type ImportFormat,
  type ImportResult,
} from '../domain/external.js';

/* ---------- low-level readers ---------- */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, '');
  const first = input.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [';', '\t', ',']
    .map((d) => [d, first.split(d).length] as const)
    .sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') ((cell += '"'), i++);
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) (row.push(cell), (cell = ''));
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}
const strip = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Header aliases covering Squash TM, TestRail and Azure Test Plans exports plus generic spreadsheets. */
const ALIASES: Record<string, string[]> = {
  id: [
    'id',
    'tcreference',
    'tcid',
    'reference',
    'ref',
    'key',
    'caseid',
    'testcaseid',
    'workitemid',
  ],
  title: ['title', 'name', 'tcname', 'nom', 'titre', 'summary', 'testcase', 'scenario'],
  description: ['description', 'tcdescription', 'objective', 'objectif'],
  preconditions: ['preconditions', 'precondition', 'tcprecondition', 'prerequis', 'prerequisites'],
  priority: ['priority', 'priorite', 'tcimportance', 'importance'],
  tags: ['tags', 'labels', 'references', 'tcnature'],
  action: [
    'stepaction',
    'tcstepaction',
    'action',
    'teststep',
    'steps',
    'stepsstep',
    'step',
    'etape',
    'etapes',
    'steptext',
  ],
  expected: [
    'stepexpected',
    'tcstepresult',
    'expectedresult',
    'stepsexpectedresult',
    'expected',
    'result',
    'resultat',
    'resultatattendu',
    'attendu',
  ],
  data: ['stepdata', 'data', 'donnees', 'testdata'],
};
function columns(header: string[]) {
  const index = new Map<string, number>();
  header.forEach((h, i) => {
    const n = norm(h);
    for (const [field, names] of Object.entries(ALIASES))
      if (names.includes(n) && !index.has(field)) index.set(field, i);
  });
  return index;
}
const splitSteps = (blob: string): string[] =>
  blob
    .split(/\r?\n+/)
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
    .filter(Boolean);

/** Rows → cases: a row with an id/title starts a case; id-less rows continue it with one more step. */
export function casesFromTable(rows: string[][], tool: string, warnings: string[]): ExternalCase[] {
  if (rows.length < 2) return [];
  const col = columns(rows[0]);
  const get = (row: string[], f: string) => strip(row[col.get(f) ?? -1] ?? '');
  const cases: ExternalCase[] = [];
  let current: ExternalCase | undefined;
  rows.slice(1).forEach((row, n) => {
    const id = get(row, 'id'),
      title = get(row, 'title');
    if (id || title) {
      current = {
        id: id || `${tool}-${cases.length + 1}`,
        title: title || id,
        tool,
        description: get(row, 'description'),
        preconditions: get(row, 'preconditions'),
        priority: get(row, 'priority'),
        tags: get(row, 'tags')
          .split(/[;,|]/)
          .map((t) => t.trim())
          .filter(Boolean),
        steps: [],
      };
      cases.push(current);
    } else if (!current) {
      warnings.push(`Ligne ${n + 2} ignorée : aucun cas de test avant cette ligne.`);
      return;
    }
    const action = get(row, 'action'),
      expected = get(row, 'expected'),
      data = get(row, 'data');
    if (!action && !expected) return;
    const actions = action.includes('\n') ? splitSteps(action) : [action];
    const expecteds = expected.includes('\n') ? splitSteps(expected) : [expected];
    const count = Math.max(actions.length, actions.length > 1 ? expecteds.length : 1);
    for (let i = 0; i < count; i++)
      current!.steps.push({
        action: actions[i] ?? '',
        expected: actions.length > 1 ? (expecteds[i] ?? '') : expected,
        data,
      });
  });
  for (const c of cases)
    if (!c.steps.length) warnings.push(`« ${c.title} » : aucune étape détectée.`);
  return cases;
}

export function parseGherkin(text: string, warnings: string[]): ExternalCase[] {
  const cases: ExternalCase[] = [];
  let feature = '',
    background: ExternalStep[] = [],
    current: ExternalCase | undefined,
    inBackground = false;
  const tags: string[] = [];
  let lastKeyword = 'Given';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('@')) {
      tags.push(...line.split(/\s+/).map((t) => t.replace(/^@/, '')));
      continue;
    }
    const f = line.match(/^(?:Feature|Fonctionnalité|Fonctionnalite):\s*(.*)$/i);
    if (f) {
      feature = f[1];
      tags.length = 0;
      continue;
    }
    if (/^(?:Background|Contexte):/i.test(line)) {
      inBackground = true;
      current = undefined;
      continue;
    }
    const s = line.match(
      /^(?:Scenario(?: Outline)?|Scénario|Scenario Template|Plan du scénario):\s*(.*)$/i,
    );
    if (s) {
      inBackground = false;
      current = {
        id: `${feature ? feature.slice(0, 20) + '#' : ''}${cases.length + 1}`,
        title: s[1] || `Scénario ${cases.length + 1}`,
        tool: 'gherkin',
        description: feature,
        preconditions: '',
        priority: '',
        tags: [...tags],
        steps: background.map((b) => ({ ...b })),
      };
      tags.length = 0;
      cases.push(current);
      continue;
    }
    const step = line.match(
      /^(Given|When|Then|And|But|Étant donné|Etant donné|Soit|Quand|Lorsque|Alors|Et|Mais)\s+(.*)$/i,
    );
    if (!step) continue;
    const keyword = /^(and|but|et|mais)$/i.test(step[1]) ? lastKeyword : step[1];
    lastKeyword = keyword;
    const isThen = /^(then|alors)$/i.test(keyword);
    const target = inBackground ? background : current?.steps;
    if (!target) continue;
    if (isThen && target.length)
      target[target.length - 1].expected +=
        (target[target.length - 1].expected ? ' ; ' : '') + step[2];
    else target.push({ action: `${step[1]} ${step[2]}`, expected: '', data: '' });
  }
  if (!cases.length) warnings.push('Aucun scénario Gherkin détecté.');
  return cases;
}

export function parseMarkdown(text: string, warnings: string[]): ExternalCase[] {
  const cases: ExternalCase[] = [];
  let current: ExternalCase | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const heading = raw.match(/^#{1,4}\s+(.*)$/);
    if (heading) {
      current = {
        id: `md-${cases.length + 1}`,
        title: heading[1].replace(/^\[(.*?)\]\s*/, '').trim(),
        tool: 'markdown',
        description: '',
        preconditions: '',
        priority: '',
        tags: [],
        steps: [],
      };
      const ref = heading[1].match(/^\[(.*?)\]/);
      if (ref) current.id = ref[1];
      cases.push(current);
      continue;
    }
    const item = raw.match(/^\s*(?:\d+[.)]|[-*])\s+(.*)$/);
    if (item && current) {
      const [action, expected = ''] = item[1].split(/\s*(?:→|->|=>)\s*/);
      current.steps.push({ action, expected, data: '' });
    } else if (raw.trim() && current && !current.steps.length)
      current.description += (current.description ? '\n' : '') + raw.trim();
  }
  for (const c of cases)
    if (!c.steps.length) warnings.push(`« ${c.title} » : aucune étape détectée.`);
  return cases;
}

export function parseJsonCases(text: string, warnings: string[]): ExternalCase[] {
  const data = JSON.parse(text);
  const list: any[] = Array.isArray(data)
    ? data
    : (data.cases ?? data.testCases ?? data.tests ?? []);
  return list.flatMap((item, i) => {
    const parsed = externalCaseSchema.safeParse({
      tool: 'json',
      ...item,
      id: String(item.id ?? item.key ?? i + 1),
      title: String(item.title ?? item.name ?? `Cas ${i + 1}`),
      steps: (item.steps ?? []).map((s: any) =>
        typeof s === 'string'
          ? { action: s }
          : {
              action: String(s.action ?? s.step ?? ''),
              expected: String(s.expected ?? s.result ?? ''),
              data: String(s.data ?? ''),
            },
      ),
    });
    if (!parsed.success) {
      warnings.push(`Élément ${i + 1} ignoré : ${parsed.error.issues[0]?.message}`);
      return [];
    }
    return [parsed.data];
  });
}

export function detectFormat(
  filename: string | undefined,
  content: string,
): Exclude<ImportFormat, 'auto'> {
  const name = (filename ?? '').toLowerCase();
  if (name.endsWith('.feature')) return 'gherkin';
  if (name.endsWith('.json') || /^\s*[[{]/.test(content)) return 'json';
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'markdown';
  if (/^\s*(?:Feature|Fonctionnalit)/im.test(content)) return 'gherkin';
  const header = (content.split(/\r?\n/, 1)[0] ?? '').toLowerCase();
  if (/tc_step|tc_reference|tc_name/.test(header)) return 'squash';
  if (/work item type|step action|step expected/.test(header)) return 'azure';
  if (/section/.test(header) && /(expected result|steps)/.test(header)) return 'testrail';
  return 'csv';
}

export function importCases(
  format: ImportFormat,
  filename: string | undefined,
  content: string,
): ImportResult {
  const warnings: string[] = [];
  const resolved = format === 'auto' ? detectFormat(filename, content) : format;
  let cases: ExternalCase[];
  if (resolved === 'gherkin') cases = parseGherkin(content, warnings);
  else if (resolved === 'markdown') cases = parseMarkdown(content, warnings);
  else if (resolved === 'json') cases = parseJsonCases(content, warnings);
  else cases = casesFromTable(parseCsv(content), resolved === 'csv' ? 'csv' : resolved, warnings);
  if (!cases.length)
    warnings.push('Aucun cas de test reconnu : vérifiez le format et les en-têtes de colonnes.');
  return { format: resolved, cases: cases.slice(0, 500), warnings: warnings.slice(0, 50) };
}
