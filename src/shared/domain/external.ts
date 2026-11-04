import { z } from 'zod';

/** Neutral shape every test-management tool is converted to before AI scenario generation. */
export const externalStepSchema = z.object({
  action: z.string().max(4000),
  expected: z.string().max(4000).default(''),
  data: z.string().max(4000).default(''),
});
export const externalCaseSchema = z.object({
  id: z.string().max(200),
  title: z.string().max(400),
  tool: z.string().max(60),
  description: z.string().max(8000).default(''),
  preconditions: z.string().max(8000).default(''),
  priority: z.string().max(60).default(''),
  tags: z.array(z.string().max(80)).max(40).default([]),
  steps: z.array(externalStepSchema).max(200).default([]),
});
export type ExternalCase = z.infer<typeof externalCaseSchema>;
export type ExternalStep = z.infer<typeof externalStepSchema>;

export const IMPORT_FORMATS = [
  'auto',
  'squash',
  'testrail',
  'azure',
  'gherkin',
  'csv',
  'json',
  'markdown',
] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];
export interface ImportResult {
  format: Exclude<ImportFormat, 'auto'>;
  cases: ExternalCase[];
  warnings: string[];
}

/** Turn imported cases into the natural-language brief given to the AI creation agent. */
export function casesToPrompt(cases: ExternalCase[], language: 'fr' | 'en' = 'fr'): string {
  const fr = language === 'fr';
  const head = fr
    ? 'Crée des scénarios Cybermonkey automatisables correspondant à ces cas de test importés. Un scénario par cas, nommé comme le cas. Chaque étape « attendu » doit devenir un test (assertion) vérifiable.'
    : 'Create automatable Cybermonkey scenarios for these imported test cases. One scenario per case, named after it. Each “expected” result must become a verifiable test (assertion).';
  const body = cases
    .map((c) => {
      const steps = c.steps
        .map(
          (s, i) =>
            `  ${i + 1}. ${s.action}${s.data ? ` [${fr ? 'données' : 'data'}: ${s.data}]` : ''}${s.expected ? ` → ${fr ? 'attendu' : 'expected'}: ${s.expected}` : ''}`,
        )
        .join('\n');
      return `### [${c.tool}:${c.id}] ${c.title}\n${c.preconditions ? `${fr ? 'Préconditions' : 'Preconditions'}: ${c.preconditions}\n` : ''}${c.description ? c.description + '\n' : ''}${steps}`;
    })
    .join('\n\n');
  return `${head}\n\n${body}`;
}

/** Offline conversion (no AI): one scenario per case, one action per step, one test per expected result. */
export function casesToSkeleton(
  cases: ExternalCase[],
  makeNode: (
    kind: 'scenario' | 'action' | 'test',
    name: string,
  ) => import('./scenario.js').ScenarioNode,
) {
  return cases.map((c) => {
    const scenario = makeNode('scenario', c.title.slice(0, 180) || c.id);
    scenario.description = [c.description, c.preconditions && `Préconditions : ${c.preconditions}`]
      .filter(Boolean)
      .join('\n');
    scenario.tags = c.tags.slice(0, 20);
    scenario.source = { tool: c.tool, id: c.id, title: c.title };
    for (const step of c.steps) {
      if (step.action) {
        const action = makeNode('action', step.action.slice(0, 180));
        action.description = step.data ? `Données : ${step.data}` : '';
        scenario.children.push(action);
      }
      if (step.expected) scenario.children.push(makeNode('test', step.expected.slice(0, 180)));
    }
    return scenario;
  });
}
