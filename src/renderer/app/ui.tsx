import { createContext, useContext } from 'react';

export type SettingsTab = 'general' | 'ai' | 'creation' | 'execution' | 'devices' | 'updates';
/** Cross-cutting UI requests (dialogs owned by the shell) that any feature can trigger. */
export interface Ui {
  openSettings(tab?: SettingsTab): void;
  openProject(mode: 'new' | 'edit'): void;
  openVariables(): void;
  openImport(): void;
  /** Ask the AI creation panel to run a prompt right away. */
  runAi(prompt: string, nodeId?: string): void;
}
export const UiContext = createContext<Ui>({
  openSettings() {},
  openProject() {},
  openVariables() {},
  openImport() {},
  runAi() {},
});
export const useUi = () => useContext(UiContext);
