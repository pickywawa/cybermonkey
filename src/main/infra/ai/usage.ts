import path from 'node:path';
import type { TokenCount, TokenTotals } from '../../../shared/domain/settings.js';
import { Queue, readJson, writeJson } from '../storage/atomic.js';

interface Ledger {
  days: Record<string, TokenCount>;
}
const day = (at: Date) => at.toISOString().slice(0, 10);
const empty = (): TokenCount => ({ input: 0, output: 0 });
const sum = (a: TokenCount, b: TokenCount): TokenCount => ({
  input: a.input + b.input,
  output: a.output + b.output,
});
/** Days kept: a year is plenty for « this week » and a running total. */
const KEEP_DAYS = 400;

/** Tokens sent through the AI by this application, per day, kept in a small file next to the settings. */
export class UsageLedger {
  private queue = new Queue();
  private cache?: Ledger;
  constructor(private file: string) {}

  private async load(): Promise<Ledger> {
    if (!this.cache) {
      const saved = await readJson<Ledger>(this.file).catch(() => null);
      this.cache = saved && typeof saved.days === 'object' && saved.days ? saved : { days: {} };
    }
    return this.cache;
  }
  add(usage: TokenCount, now = new Date()) {
    if (!usage.input && !usage.output) return Promise.resolve();
    return this.queue.run(async () => {
      const ledger = await this.load();
      const key = day(now);
      ledger.days[key] = sum(ledger.days[key] ?? empty(), usage);
      for (const old of Object.keys(ledger.days).sort().slice(0, -KEEP_DAYS))
        delete ledger.days[old];
      await writeJson(this.file, ledger).catch(() => {});
    });
  }
  async totals(now = new Date()): Promise<TokenTotals> {
    const ledger = await this.load();
    const today = day(now);
    const weekStart = day(new Date(now.getTime() - 6 * 86_400_000));
    const out: TokenTotals = { today: empty(), week: empty(), total: empty() };
    for (const [d, u] of Object.entries(ledger.days)) {
      out.total = sum(out.total, u);
      if (d >= weekStart) out.week = sum(out.week, u);
      if (d === today) out.today = u;
    }
    return out;
  }
}
export const ledgerFile = (userData: string) => path.join(userData, 'ai-usage.json');
