import type { Locator, OS, Variant } from './scenario.js';

export type SelectorQuality = 'durable' | 'fair' | 'fragile' | 'position';
export interface SelectorReview {
  quality: SelectorQuality;
  /** Why, in one sentence. */
  reason: string;
}

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.:/-]*$/;
/** XPath that depends on the position in the hierarchy rather than on an attribute. */
const POSITIONAL =
  /\[\d+\]|\[last\(\)|(\/[^/]+){5,}|following-sibling|preceding-sibling|parent::|\.\.\//;

/** How long a selector is likely to survive UI changes, copy changes and translations. */
export function reviewLocator(locator: Locator | undefined, point = false): SelectorReview {
  if (!locator)
    return point
      ? {
          quality: 'position',
          reason: 'Screen position: breaks with any layout, size or language change.',
        }
      : { quality: 'fragile', reason: 'No selector.' };
  const v = locator.value;
  if (locator.using === 'xpath') {
    if (POSITIONAL.test(v))
      return {
        quality: 'fragile',
        reason: 'XPath based on the position in the hierarchy: any layout change breaks it.',
      };
    if (
      /@(resource-id|content-desc|name|label|value)\s*=/.test(v) &&
      !/contains\(|text\(\)/.test(v)
    )
      return {
        quality: 'fair',
        reason: 'XPath on an attribute: acceptable, but an id selector is simpler and faster.',
      };
    return {
      quality: 'fragile',
      reason: 'XPath on text or structure: breaks when the copy or the layout changes.',
    };
  }
  if (locator.using === 'id') return { quality: 'durable', reason: 'Technical id.' };
  // accessibility id: a developer identifier is durable, a displayed sentence is not
  if (
    IDENTIFIER.test(v) &&
    (/[_.:/-]/.test(v) || /[a-z][A-Z]/.test(v) || v === v.toLowerCase()) &&
    v.split(/[\s]+/).length === 1 &&
    v.length <= 60
  )
    return { quality: 'durable', reason: 'Developer identifier.' };
  return {
    quality: 'fair',
    reason: 'Accessibility label = displayed text: breaks when the copy is edited or translated.',
  };
}
export const reviewVariant = (v: Variant): SelectorReview =>
  reviewLocator(v.locator, !!v.point && !v.locator);

const strip = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
/** A proposed identifier for the app's developers, from what the step is about. */
export function suggestIdentifier(name: string, hint = ''): string {
  const base = strip(hint || name)
    .split('_')
    .filter(Boolean)
    .slice(0, 4)
    .join('_');
  return base || 'element';
}
/** How a developer adds an identifier on each stack. */
export function howToAddIdentifier(os: OS, id: string): string {
  return os === 'ios'
    ? `iOS: element.accessibilityIdentifier = "${id}" (SwiftUI: .accessibilityIdentifier("${id}"); Flutter: Semantics(identifier: '${id}', …)).`
    : `Android: android:id="@+id/${id}" (Compose: Modifier.testTag("${id}") with testTagsAsResourceId = true; Flutter: Semantics(identifier: '${id}', …)).`;
}
