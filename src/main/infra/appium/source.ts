import { DOMParser } from '@xmldom/xmldom';
import { createHash } from 'node:crypto';
import type { Component, Screen } from '../../../shared/domain/devices.js';
import type { Locator } from '../../../shared/domain/scenario.js';
import { auditAccessibility } from './accessibility.js';
import { IOS_ANONYMOUS_INPUT_SELECTOR } from './ios-config.js';

export function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value
    .split("'")
    .map((s) => `'${s}'`)
    .join(',"\'",')})`;
}

/** Convert an Appium page source into the accessible components the app can interact with. */
export function parseScreen(xml: string, deviceId: string): Screen {
  const components: Component[] = [];
  const os = deviceId.startsWith('android:') ? 'android' : 'ios';
  const doc = new DOMParser({ onError: () => {} }).parseFromString(xml, 'text/xml');
  const iosNames = new Map<string, number>();
  if (os === 'ios') {
    const all = doc.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      const name = all[i].getAttribute('name');
      if (name) iosNames.set(name, (iosNames.get(name) ?? 0) + 1);
    }
  }
  let width = 0,
    height = 0;
  const opaque: NonNullable<Screen['opaque']> = [];
  const walk = (el: Element) => {
    const a = (k: string) => el.getAttribute(k) ?? '';
    const type = a('type') || a('class') || el.tagName;
    const text = a('text') || a('label') || a('value');
    const label = a('content-desc') || a('name') || a('label') || text;
    let rect = {
      x: Number(a('x')),
      y: Number(a('y')),
      width: Number(a('width')),
      height: Number(a('height')),
    };
    const bounds = a('bounds').match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
    if (bounds)
      rect = {
        x: +bounds[1],
        y: +bounds[2],
        width: +bounds[3] - +bounds[1],
        height: +bounds[4] - +bounds[2],
      };
    width = Math.max(width, rect.x + rect.width);
    height = Math.max(height, rect.y + rect.height);
    const secure = a('password') === 'true' || type.includes('SecureText');
    let locator: Locator | undefined;
    if (os === 'android' && a('resource-id')) locator = { using: 'id', value: a('resource-id') };
    else if (os === 'android' && a('content-desc'))
      locator = { using: 'accessibility id', value: a('content-desc') };
    else if (
      os === 'ios' &&
      /^XCUIElementType(TextField|SecureTextField)$/.test(type) &&
      ((!label && !text) || /^[|​‌‍]+$/.test(a('name')))
    )
      // Flutter exposes its caret as the name and swaps TextField for SecureTextField on focus.
      locator = { using: 'xpath', value: IOS_ANONYMOUS_INPUT_SELECTOR };
    else if (os === 'ios' && a('name'))
      locator =
        (iosNames.get(a('name')) ?? 0) > 1 && /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(type)
          ? { using: 'xpath', value: `//${type}[@name=${xpathLiteral(a('name'))}]` }
          : { using: 'accessibility id', value: a('name') };
    else if (text && type)
      locator = {
        using: 'xpath',
        value:
          os === 'android'
            ? `//*[@class=${xpathLiteral(type)} and @text=${xpathLiteral(text)}]`
            : `//${type}[@label=${xpathLiteral(text)} or @value=${xpathLiteral(text)}]`,
      };
    else if (
      os === 'ios' &&
      /^XCUIElementType(TextField|SecureTextField|TextView|SearchField)$/.test(type)
    )
      locator = { using: 'xpath', value: `//${type}` };
    if (
      locator &&
      rect.width > 0 &&
      rect.height > 0 &&
      a('visible') !== 'false' &&
      a('displayed') !== 'false'
    )
      components.push({
        id: createHash('sha256').update(JSON.stringify(locator)).digest('hex').slice(0, 20),
        type,
        label: secure ? '[secure field]' : label,
        text: secure ? '[secure]' : text,
        locator,
        rect,
        enabled: a('enabled') !== 'false',
        password: secure,
        interactive:
          os === 'android'
            ? a('clickable') === 'true' ||
              a('checkable') === 'true' ||
              a('long-clickable') === 'true'
            : /Button|Cell|Switch|Link|Toggle|Tab|Key|Slider|Segmented|MenuItem|Picker/.test(type),
        selected:
          a('selected') === 'true' ||
          a('checked') === 'true' ||
          (os === 'ios' && /Switch|Toggle/.test(type) && a('value') === '1'),
      });
    const before = components.length;
    for (let i = 0; i < el.childNodes.length; i++) {
      const child = el.childNodes[i];
      if (child.nodeType === 1) walk(child as unknown as Element);
    }
    // A web view whose descendants contributed nothing: its content is invisible to the accessibility tree.
    if (
      /WebView/i.test(type) &&
      components.length === before &&
      rect.width > 40 &&
      rect.height > 40
    ) {
      const same = opaque.some(
        (o) =>
          o.x === rect.x && o.y === rect.y && o.width === rect.width && o.height === rect.height,
      );
      if (!same) opaque.push({ ...rect, type: type.replace(/^XCUIElementType/, '') });
    }
  };
  if (doc.documentElement) walk(doc.documentElement as unknown as Element);
  const a11y = doc.documentElement
    ? auditAccessibility(doc as unknown as Document, os, width, height)
    : [];
  return {
    deviceId,
    components,
    ...(a11y.length ? { a11y } : {}),
    width,
    height,
    capturedAt: new Date().toISOString(),
    ...(opaque.length ? { opaque } : {}),
  };
}
