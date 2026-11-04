import type { Settings } from '../../shared/domain/settings.js';

/** Minimal bilingual helper for messages produced by the engine (warnings, step messages). */
export const translator = (settings: () => Settings) => (fr: string, en: string) =>
  settings().language === 'en' ? en : fr;
export type Translate = ReturnType<typeof translator>;
