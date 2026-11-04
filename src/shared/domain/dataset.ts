import { MAX_DATASET_ROWS } from './scenario.js';
import { variableName } from './variables.js';

const SEPARATORS = ['\t', ';', ','];
/** Table text → rows. First line = column names (variable names); separators: tab, ; or ,. */
export function parseDataset(text: string): { rows: Record<string, string>[] } | { error: string } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim());
  if (lines.length < 2) return { error: 'logic.datasetNeedsRow' };
  const sep = SEPARATORS.find((s) => lines[0].includes(s)) ?? ',';
  const columns = lines[0].split(sep).map((c) => c.trim());
  const bad = columns.find((c) => !variableName.safeParse(c).success);
  if (bad !== undefined) return { error: 'logic.datasetBadColumn' };
  if (new Set(columns).size !== columns.length) return { error: 'logic.datasetBadColumn' };
  if (lines.length - 1 > MAX_DATASET_ROWS) return { error: 'logic.datasetTooMany' };
  return {
    rows: lines.slice(1).map((line) => {
      const cells = line.split(sep);
      return Object.fromEntries(columns.map((c, i) => [c, (cells[i] ?? '').trim()]));
    }),
  };
}
