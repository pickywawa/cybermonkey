/**
 * Language of what the integrations tell the person (activity log, errors, test results): the app's own language.
 * The hub points this at the settings; French until then.
 */
let current: () => string = () => 'fr';
export const followLanguage = (get: () => string) => {
  current = get;
};
export const tr = (fr: string, en: string) => (current() === 'en' ? en : fr);
