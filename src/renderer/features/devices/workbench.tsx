import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { call, onEvent } from '../../shared/api';
import type { Component, Screen } from '../../../shared/domain/devices';
import type { OS } from '../../../shared/domain/scenario';

/** A component the user clicked on a phone mirror; the editor and the step composer consume it. */
export interface Picked {
  os: OS;
  deviceId: string;
  component: Component;
  screen: Screen;
}
interface Workbench {
  picked: Picked | null;
  pick(p: Picked | null): void;
  aiPrefill: { text: string; nodeId?: string; n: number } | null;
  prefillAi(text: string, nodeId?: string): void;
}
const Ctx = createContext<Workbench>({
  picked: null,
  pick: () => {},
  aiPrefill: null,
  prefillAi: () => {},
});
export const useWorkbench = () => useContext(Ctx);
export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [aiPrefill, setPrefill] = useState<Workbench['aiPrefill']>(null);
  // Picking in a detached devices window must reach the editor window: relay through the main process.
  useEffect(
    () =>
      onEvent((e) => {
        if (e.type === 'pick') setPicked((e.picked as Picked | null) ?? null);
      }),
    [],
  );
  const pick = (p: Picked | null) => {
    setPicked(p);
    void call('workbench.pick', p).catch(() => {});
  };
  const value = useMemo(
    () => ({
      picked,
      pick,
      aiPrefill,
      prefillAi: (text: string, nodeId?: string) =>
        setPrefill((p) => ({ text, nodeId, n: (p?.n ?? 0) + 1 })),
    }),
    [picked, aiPrefill],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
