import { randomUUID } from 'node:crypto';
import type { ConfirmRequest, JournalEntry } from '../../shared/domain/integrations.js';

export type ConfirmAnswer = { accepted: boolean; edited?: string };
/** Asks the person; resolves `null` when nobody can answer (command line), so callers skip instead of acting. */
export type Confirmer = (request: Omit<ConfirmRequest, 'id'>) => Promise<ConfirmAnswer | null>;

/** What the integrations did lately, shown in Settings → Integrations so a silent failure is never a mystery. */
export class Journal {
  private entries: JournalEntry[] = [];
  constructor(private onAdd?: (entry: JournalEntry) => void) {}
  add(target: string, ok: boolean, message: string) {
    const entry = { at: new Date().toISOString(), target, ok, message: message.slice(0, 400) };
    this.entries.unshift(entry);
    this.entries.length = Math.min(this.entries.length, 50);
    this.onAdd?.(entry);
  }
  list() {
    return [...this.entries];
  }
}

/** Pending confirmation windows, answered through the `integrations.answer` channel. */
export class ConfirmBroker {
  private pending = new Map<string, (a: ConfirmAnswer) => void>();
  constructor(private show: (request: ConfirmRequest) => void) {}
  ask: Confirmer = (request) =>
    new Promise((resolve) => {
      const id = randomUUID();
      this.pending.set(id, resolve);
      this.show({ ...request, id });
    });
  answer(id: string, answer: ConfirmAnswer) {
    const resolve = this.pending.get(id);
    this.pending.delete(id);
    resolve?.(answer);
  }
  /** App closing: nobody will answer. */
  cancelAll() {
    for (const resolve of this.pending.values()) resolve({ accepted: false });
    this.pending.clear();
  }
}

import type { Project } from '../../shared/domain/project.js';
import type { RunReport } from '../../shared/domain/report.js';
import type { Regression } from './regressions.js';

/** Everything a service needs once a run is over. */
export interface FinishedRun {
  report: RunReport;
  project: Project;
  campaignLabel: string;
  regressions: Regression[];
  /** Variable values that must never be written in a message. */
  secrets: string[];
}
