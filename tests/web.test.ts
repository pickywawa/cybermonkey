import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScreen } from '../src/main/infra/appium/source.js';
import { cellToPoint } from '../src/main/infra/devices/grid.js';
import { parseDecision } from '../src/shared/ai/protocol.js';

const xml = `<AppiumAUT><XCUIElementTypeApplication type="XCUIElementTypeApplication" x="0" y="0" width="440" height="956">
  <XCUIElementTypeButton type="XCUIElementTypeButton" name="Back" x="0" y="66" width="48" height="48" visible="true"/>
  <XCUIElementTypeWebView type="XCUIElementTypeWebView" x="0" y="118" width="440" height="838">
    <XCUIElementTypeWebView type="XCUIElementTypeWebView" x="0" y="118" width="440" height="838"/>
  </XCUIElementTypeWebView>
</XCUIElementTypeApplication></AppiumAUT>`;

test('a web view whose content is not in the accessibility tree is reported as an opaque region (once)', () => {
  const screen = parseScreen(xml, 'sim:1');
  assert.equal(screen.components.length, 1);
  assert.deepEqual(
    screen.opaque?.map((o) => [o.type, o.y, o.height]),
    [['WebView', 118, 838]],
  );
});

test('a web view exposing its content is not opaque', () => {
  const exposed = xml.replace(
    '<XCUIElementTypeWebView type="XCUIElementTypeWebView" x="0" y="118" width="440" height="838"/>',
    '<XCUIElementTypeTextField type="XCUIElementTypeTextField" name="Login" x="10" y="200" width="300" height="40" visible="true"/>',
  );
  assert.equal(parseScreen(exposed, 'sim:1').opaque, undefined);
});

test('grid cells map to the center of the cell as screen fractions', () => {
  const size = { width: 440, height: 960 };
  assert.deepEqual(cellToPoint('A1', size, 40), { x: 20 / 440, y: 20 / 960 });
  assert.deepEqual(cellToPoint('c2', size, 40), { x: 100 / 440, y: 60 / 960 });
  assert.equal(cellToPoint('Z99', size), undefined);
  assert.equal(cellToPoint('7C', size), undefined);
});

test('perform decisions accept a grid cell instead of a component id', () => {
  const r = parseDecision(
    '{"tool":"perform","deviceId":"d","cell":"C7","operation":"type","value":"${LOGIN}","componentId":null}',
  );
  assert.ok(
    r.ok &&
      r.decision.tool === 'perform' &&
      r.decision.cell === 'C7' &&
      r.decision.componentId === undefined,
  );
});
