import type { OS, ScenarioNode, Variant } from '../../../shared/domain/scenario.js';

/** Replays a proposal with the same precondition / blocking rules as a real run. Requires at least one assertion. */
export async function replayProposal(
  nodes: ScenarioNode[],
  platform: OS,
  perform: (variant: Variant, kind: ScenarioNode['kind']) => Promise<unknown>,
  record: (entry: unknown) => Promise<void>,
  signal: AbortSignal,
  verify?: (node: ScenarioNode) => Promise<void>,
  /** Called when a step fails: true = something in the way was dealt with, the step is replayed once. */
  recover?: (node: ScenarioNode, error: unknown) => Promise<boolean>,
) {
  let assertions = 0;
  const errors: string[] = [];
  const sequence = async (list: ScenarioNode[]): Promise<boolean> => {
    for (let index = 0; index < list.length; index++) {
      signal.throwIfAborted();
      const node = list[index];
      if (node.platforms && !node.platforms.includes(platform)) continue;
      let allowed = true;
      if (node.preconditionId) {
        const test = list[index - 1];
        try {
          const variant = test?.variants[platform];
          if (!variant || test.kind !== 'test' || test.id !== node.preconditionId)
            throw new Error('Précondition non configurée');
          await perform(variant, 'test');
          await record({
            type: 'replay-precondition',
            nodeId: test.id,
            platform,
            status: 'passed',
          });
        } catch (error) {
          signal.throwIfAborted();
          allowed = false;
          await record({
            type: 'replay-precondition',
            nodeId: node.preconditionId,
            platform,
            status: 'failed',
            message: String(error),
          });
        }
      }
      let failed = false;
      if (!allowed)
        await record({ type: 'replay-step', nodeId: node.id, platform, status: 'skipped' });
      else if (node.kind !== 'scenario') {
        try {
          const variant = node.variants[platform];
          if (!variant) throw new Error('Variante manquante : ' + node.name);
          const attempt = async () => {
            await perform(variant, node.kind);
            await verify?.(node);
          };
          try {
            await attempt();
          } catch (first) {
            signal.throwIfAborted();
            if (!recover || !(await recover(node, first))) throw first;
            await attempt();
          }
          if (node.kind === 'test') assertions++;
          await record({ type: 'replay-step', nodeId: node.id, platform, status: 'passed' });
        } catch (error) {
          signal.throwIfAborted();
          failed = true;
          errors.push(node.name + ': ' + String(error));
          await record({
            type: 'replay-step',
            nodeId: node.id,
            platform,
            status: 'failed',
            message: String(error),
          });
        }
      }
      if (failed && node.blocking) return true;
      if ((allowed || node.childrenOnPreconditionFailure) && (await sequence(node.children)))
        return true;
    }
    return false;
  };
  await sequence(nodes);
  if (errors.length) throw new Error(errors.join('\n'));
  if (!assertions) throw new Error('Aucune assertion pour confirmer le résultat métier.');
}
