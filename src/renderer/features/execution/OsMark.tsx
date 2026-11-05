import type { ElementState } from '../../../shared/domain/campaign';
import type { OS } from '../../../shared/domain/scenario';
import { PlatformIcon, osName } from '../../shared/ui/icons';

export type MarkState = ElementState | 'partial' | 'none';
const LABEL: Record<MarkState, [string, string]> = {
  partial: ['partiellement testé', 'partly tested'],
  none: ['aucun test', 'no test'],
  passed: ['réussi', 'passed'],
  failed: ['en échec', 'failed'],
  running: ['en cours', 'running'],
  other: ['ignoré ou bloqué', 'skipped or blocked'],
  pending: ['pas encore testé', 'not tested yet'],
};

/**
 * One OS of one element. The OS glyph is always white: only the small mark beside it says how the test went, so a green
 * Android robot is never mistaken for « passed on Android ».
 */
export function OsMark({
  os,
  state,
  size = 12,
  language = 'fr',
  slow,
}: {
  os: OS;
  state: MarkState;
  size?: number;
  language?: 'fr' | 'en';
  /** Passed, but slower than usual: the dot turns orange. */
  slow?: boolean;
}) {
  const word =
    LABEL[state][language === 'en' ? 1 : 0] +
    (slow ? (language === 'en' ? ' · slower than usual' : ' · plus lent que d’habitude') : '');
  return (
    <span className={`os-mark ${state}${slow ? ' slow' : ''}`} title={`${osName(os)} : ${word}`}>
      <PlatformIcon os={os} size={size} plain />
      <i />
    </span>
  );
}
