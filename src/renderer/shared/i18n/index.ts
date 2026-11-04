import { createContext, createElement, useContext, type ReactNode } from 'react';
import { fr, en, type Key } from './dictionary';

export type Language = 'fr' | 'en';
export type { Key };
type Params = Record<string, string | number>;
const format = (text: string, params?: Params) =>
  params ? text.replace(/\{(\w+)\}/g, (_m, k) => String(params[k] ?? '')) : text;
export type TFn = (key: Key, params?: Params) => string;
export const translate =
  (language: Language): TFn =>
  (key, params) =>
    format((language === 'en' ? en[key] : fr[key]) ?? fr[key] ?? key, params);

const LanguageContext = createContext<Language>('fr');
export const LanguageProvider = ({
  language,
  children,
}: {
  language: Language;
  children: ReactNode;
}) => createElement(LanguageContext.Provider, { value: language }, children);
export const useLanguage = () => useContext(LanguageContext);
export const useT = (): TFn => translate(useContext(LanguageContext));
