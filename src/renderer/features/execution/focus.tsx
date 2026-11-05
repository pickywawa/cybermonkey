import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { buildResults, latestResults, type CampaignResults } from '../../../shared/domain/campaign';
import { useApp } from '../../app/store';

export type ExecView = 'results' | 'map';
type Origin = 'tree' | 'results' | 'map';
interface Focus {
  nodeId: string | null;
  from: Origin | null;
  /** Changes on every request: lets the other panel react to « the same element again ». */
  n: number;
}
interface Exec {
  /** Every element with its last result, per OS of the project. One source for the tree and the results. */
  results: CampaignResults;
  view: ExecView;
  setView(v: ExecView): void;
  focus: Focus;
  /** « Show me this element »: the panels that did not ask scroll to it and open it. */
  reveal(nodeId: string, from: Origin): void;
  /** Scenarios (and steps) folded in the tree. The results list folds the same scenarios: one state, two views. */
  collapsed: Set<string>;
  toggle(id: string): void;
  setCollapsed(ids: string[], collapsed: boolean): void;
  /** Fold (or unfold) every scenario whose elements all passed: what is done stops taking room. */
  foldPassed(): void;
  /** All the passed scenarios are folded right now. */
  passedFolded: boolean;
  /** Result rows opened to show their detail. */
  open: Set<string>;
  setOpen(id: string, open?: boolean): void;
}
const ExecContext = createContext<Exec | null>(null);

/** State shared by the scenario tree (left) and the campaign view (center) in execution mode. */
export function ExecProvider({ children }: { children: ReactNode }) {
  const { project, detail } = useApp();
  const [view, setView] = useState<ExecView>('results');
  const [focus, setFocus] = useState<Focus>({ nodeId: null, from: null, n: 0 });
  const [collapsed, setCollapsedState] = useState<Set<string>>(new Set());
  const [open, setOpenState] = useState<Set<string>>(new Set());
  const results = useMemo(
    () =>
      buildResults(
        project ?? { nodes: [], platforms: ['android', 'ios'] },
        detail,
        latestResults(detail),
      ),
    [project, detail],
  );
  const reveal = useCallback(
    (nodeId: string, from: Origin) => setFocus((f) => ({ nodeId, from, n: f.n + 1 })),
    [],
  );
  const toggle = useCallback(
    (id: string) =>
      setCollapsedState((s) => {
        const n = new Set(s);
        n.has(id) ? n.delete(id) : n.add(id);
        return n;
      }),
    [],
  );
  const setCollapsed = useCallback(
    (ids: string[], on: boolean) =>
      setCollapsedState((s) => {
        const n = new Set(s);
        for (const id of ids) on ? n.add(id) : n.delete(id);
        return n;
      }),
    [],
  );
  const setOpen = useCallback(
    (id: string, on?: boolean) =>
      setOpenState((s) => {
        const n = new Set(s);
        const next = on ?? !n.has(id);
        next ? n.add(id) : n.delete(id);
        return n;
      }),
    [],
  );
  const passedIds = useMemo(
    () => results.scenarios.filter((s) => s.status === 'passed').map((s) => s.scenario.id),
    [results],
  );
  const passedFolded = passedIds.length > 0 && passedIds.every((id) => collapsed.has(id));
  const foldPassed = useCallback(
    () => setCollapsed(passedIds, !passedFolded),
    [setCollapsed, passedIds, passedFolded],
  );
  const value = useMemo<Exec>(
    () => ({
      results,
      view,
      setView,
      focus,
      reveal,
      collapsed,
      toggle,
      setCollapsed,
      foldPassed,
      passedFolded,
      open,
      setOpen,
    }),
    [
      results,
      view,
      focus,
      reveal,
      collapsed,
      toggle,
      setCollapsed,
      foldPassed,
      passedFolded,
      open,
      setOpen,
    ],
  );
  return <ExecContext.Provider value={value}>{children}</ExecContext.Provider>;
}

export function useExec(): Exec {
  const ctx = useContext(ExecContext);
  if (!ctx) throw new Error('ExecProvider manquant');
  return ctx;
}
