import type { AccessibilityIssue } from '../../../shared/domain/report.js';

type OsName = 'android' | 'ios';

/** Smallest comfortable touch target: 44 pt on iOS (Apple), 48 dp on Android (Material). */
const MIN_TARGET = { ios: 44, android: 48 } as const;
/**
 * Android reports pixels, not dp. Phones are 360-412 dp wide whatever their density, so the screen width gives a good
 * enough estimate of the density; a target is only reported when it is clearly under the minimum (15 % margin).
 */
const ANDROID_DP_WIDTH = 390;
const MARGIN = 0.85;
const MAX_ISSUES = 80;

const IOS_INTERACTIVE =
  /^(XCUIElementType)?(Button|Switch|Link|Toggle|Slider|Segmented|MenuItem|Picker|Tab)\b/;
const SYSTEM_PACKAGES =
  /^(com\.android\.systemui|com\.google\.android\.inputmethod|com\.samsung\.android\.honeyboard)/;
/** snake_case or dotted identifiers, file names and icon codes: what a developer typed, not what a person reads. */
const TECHNICAL =
  /^([a-z][a-z0-9]*([_.][a-z0-9]+)+|(ic|icon|btn|img|iv|tv)[_-][\w-]+|[\w-]+\.(png|jpe?g|svg|webp|xml))$/i;

const short = (type: string) =>
  type
    .replace(/^XCUIElementType/, '')
    .replace(/^android\.(widget|view)\./, '')
    .replace(/^.*\./, '');

/**
 * Looks for the accessibility problems a page source can prove: a control with no name for the screen reader, a name
 * that is a code identifier, a touch target that is too small. It reads the tree already downloaded for the inspection.
 * What it cannot see (colour contrast, text size, reading order) is not guessed.
 */
export function auditAccessibility(
  doc: Document,
  os: OsName,
  screenWidth: number,
  screenHeight: number,
): AccessibilityIssue[] {
  const issues: AccessibilityIssue[] = [];
  const seen = new Set<string>();
  const scale = os === 'android' ? Math.max(1, screenWidth / ANDROID_DP_WIDTH) : 1;

  const attr = (el: Element, k: string) => el.getAttribute(k) ?? '';
  const nameOf = (el: Element) =>
    os === 'android'
      ? attr(el, 'content-desc') || attr(el, 'text')
      : attr(el, 'label') || attr(el, 'name') || attr(el, 'value');
  const hasName = (el: Element): boolean => {
    if (nameOf(el).trim()) return true;
    for (let i = 0; i < el.childNodes.length; i++) {
      const child = el.childNodes[i];
      if (child.nodeType === 1 && hasName(child as unknown as Element)) return true;
    }
    return false;
  };
  const rectOf = (el: Element) => {
    const b = attr(el, 'bounds').match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
    return b
      ? { x: +b[1], y: +b[2], width: +b[3] - +b[1], height: +b[4] - +b[2] }
      : {
          x: Number(attr(el, 'x')),
          y: Number(attr(el, 'y')),
          width: Number(attr(el, 'width')),
          height: Number(attr(el, 'height')),
        };
  };
  const add = (issue: AccessibilityIssue, key: string) => {
    if (issues.length >= MAX_ISSUES || seen.has(key)) return;
    seen.add(key);
    issues.push(issue);
  };

  const walk = (el: Element) => {
    const type = attr(el, 'type') || attr(el, 'class') || el.tagName;
    if (os === 'android' && SYSTEM_PACKAGES.test(attr(el, 'package'))) return;
    if (os === 'ios' && /Keyboard|StatusBar/.test(type)) return;
    const interactive =
      os === 'android'
        ? attr(el, 'clickable') === 'true' || attr(el, 'checkable') === 'true'
        : IOS_INTERACTIVE.test(type);
    const r = rectOf(el);
    const visible =
      attr(el, 'visible') !== 'false' &&
      attr(el, 'displayed') !== 'false' &&
      r.width > 0 &&
      r.height > 0;
    if (interactive && visible && attr(el, 'enabled') !== 'false' && screenWidth > 0) {
      const at = {
        x: Math.min(1, Math.max(0, (r.x + r.width / 2) / screenWidth)),
        y: Math.min(1, Math.max(0, (r.y + r.height / 2) / Math.max(1, screenHeight))),
      };
      const place = `${Math.round(at.x * 40)}:${Math.round(at.y * 40)}`;
      const component = short(type);
      const label = nameOf(el).trim();
      if (!hasName(el)) {
        add({ rule: 'missing-label', severity: 'error', component, at }, `L|${component}|${place}`);
      } else if (
        label &&
        TECHNICAL.test(label) &&
        // The visible text of an Android button is what it shows; only the description is « said ».
        (os === 'ios' || attr(el, 'content-desc'))
      ) {
        add(
          { rule: 'technical-label', severity: 'warning', component, label, at },
          `T|${label}|${place}`,
        );
      }
      const width = Math.round(r.width / scale);
      const height = Math.round(r.height / scale);
      const min = MIN_TARGET[os];
      if (Math.min(width, height) < min * MARGIN && Math.min(r.width, r.height) >= 8)
        add(
          {
            rule: 'small-target',
            severity: 'warning',
            component,
            ...(label ? { label } : {}),
            size: { width, height },
            at,
          },
          `S|${component}|${place}`,
        );
    }
    for (let i = 0; i < el.childNodes.length; i++) {
      const child = el.childNodes[i];
      if (child.nodeType === 1) walk(child as unknown as Element);
    }
  };
  if (doc.documentElement) walk(doc.documentElement);
  return issues;
}
