import {
  makeNode,
  makeVariant,
  type Locator,
  type OS,
  type ScenarioNode,
  type ScreenDefinition,
  type Operation,
} from './scenario.js';

/** One step inferred by the recorder while the user drives the phone. */
export interface RecordedStep {
  id: string;
  at: string;
  platform: OS;
  deviceId: string;
  operation: Extract<Operation, 'tap' | 'type' | 'clear' | 'back' | 'swipe'>;
  name: string;
  locator?: Locator;
  hint: string;
  value: string;
  secure: boolean;
  /** Screen reached after the step, when it could be identified. */
  destination?: ScreenDefinition;
  /** How the step was inferred. */
  source: 'diff' | 'ai' | 'mirror';
  confidence: 'high' | 'medium' | 'low';
  /** Candidates for ambiguous taps; the user picks one in the review list. */
  candidates?: { locator: Locator; hint: string }[];
  /** Optional assertion proposed on the destination screen. */
  assertion?: { locator: Locator; hint: string };
}

/** Convert recorded steps to scenario nodes (one variant for the recorded OS). */
export function stepsToNodes(
  steps: RecordedStep[],
  variableFor: (step: RecordedStep) => string,
): ScenarioNode[] {
  const nodes: ScenarioNode[] = [];
  for (const s of steps) {
    const navigation = !!s.destination && s.operation !== 'type';
    const node = makeNode(navigation ? 'navigation' : 'action', s.name, []);
    node.variants[s.platform] = makeVariant({
      operation: s.operation,
      locator: s.operation === 'back' || s.operation === 'swipe' ? undefined : s.locator,
      hint: s.hint,
      value: s.operation === 'type' ? (s.secure ? variableFor(s) : s.value) : '',
    });
    if (navigation) node.screen = s.destination;
    nodes.push(node);
    if (s.assertion) {
      const test = makeNode('test', 'Vérifier : ' + s.assertion.hint, []);
      test.variants[s.platform] = makeVariant({
        operation: 'assert',
        assertion: 'visible',
        locator: s.assertion.locator,
        hint: s.assertion.hint,
      });
      nodes.push(test);
    }
  }
  return nodes;
}
