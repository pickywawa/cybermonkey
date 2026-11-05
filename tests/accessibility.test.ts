import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from '@xmldom/xmldom';
import { parseScreen } from '../src/main/infra/appium/source.js';
import { auditAccessibility } from '../src/main/infra/appium/accessibility.js';
import { accessibilityOf } from '../src/shared/domain/accessibility.js';
import type { CampaignDetail, RunReport } from '../src/shared/domain/report.js';

const android = (body: string) =>
  `<hierarchy><android.widget.FrameLayout package="com.app" bounds="[0,0][1080,2000]">${body}</android.widget.FrameLayout></hierarchy>`;
const node = (cls: string, attrs: string, inner = '') =>
  `<${cls} package="com.app" ${attrs}>${inner}</${cls}>`;

const audit = (xml: string, os: 'android' | 'ios', w: number, h: number) =>
  auditAccessibility(
    new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document,
    os,
    w,
    h,
  );

test('accessibility: an Android button with no name is an error, one named by its child text is fine', () => {
  const xml = android(
    node(
      'android.widget.ImageButton',
      'clickable="true" enabled="true" text="" content-desc="" bounds="[0,100][200,300]"',
    ) +
      node(
        'android.view.ViewGroup',
        'clickable="true" enabled="true" bounds="[0,400][500,600]"',
        node('android.widget.TextView', 'text="Payer" bounds="[10,410][300,590]"'),
      ),
  );
  const issues = audit(xml, 'android', 1080, 2000);
  const missing = issues.filter((i) => i.rule === 'missing-label');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].severity, 'error');
  assert.equal(missing[0].component, 'ImageButton');
});

test('accessibility: technical descriptions and small targets are warnings; tolerance for the dp estimate', () => {
  const xml = android(
    // 1080 px wide ≈ 2.77x: 100 px ≈ 36 dp (too small), 140 px ≈ 51 dp (fine)
    node(
      'android.widget.ImageView',
      'clickable="true" enabled="true" content-desc="ic_close_24" bounds="[0,0][100,100]"',
    ) +
      node(
        'android.widget.Button',
        'clickable="true" enabled="true" text="OK" bounds="[0,200][140,340]"',
      ),
  );
  const issues = audit(xml, 'android', 1080, 2000);
  assert.deepEqual(issues.map((i) => i.rule).sort(), ['small-target', 'technical-label']);
  const small = issues.find((i) => i.rule === 'small-target')!;
  assert.ok(small.size!.width < 41 && small.size!.width > 30);
  assert.ok(issues.every((i) => i.severity === 'warning'));
});

test('accessibility: iOS targets are read in points; keyboards, disabled and hidden elements are ignored', () => {
  const xml = `<AppiumAUT><XCUIElementTypeApplication type="XCUIElementTypeApplication" x="0" y="0" width="390" height="844">
    <XCUIElementTypeButton type="XCUIElementTypeButton" name="Valider" label="Valider" x="10" y="10" width="30" height="30" visible="true" enabled="true"/>
    <XCUIElementTypeButton type="XCUIElementTypeButton" name="" label="" x="10" y="100" width="60" height="60" visible="true" enabled="true"/>
    <XCUIElementTypeButton type="XCUIElementTypeButton" name="Grise" label="Grise" x="10" y="200" width="20" height="20" visible="true" enabled="false"/>
    <XCUIElementTypeButton type="XCUIElementTypeButton" name="Cache" label="Cache" x="10" y="300" width="20" height="20" visible="false" enabled="true"/>
    <XCUIElementTypeKeyboard type="XCUIElementTypeKeyboard" x="0" y="500" width="390" height="300"><XCUIElementTypeButton type="XCUIElementTypeButton" x="0" y="500" width="10" height="10" visible="true" enabled="true"/></XCUIElementTypeKeyboard>
  </XCUIElementTypeApplication></AppiumAUT>`;
  const issues = audit(xml, 'ios', 390, 844);
  assert.deepEqual(issues.map((i) => [i.rule, i.component]).sort(), [
    ['missing-label', 'Button'],
    ['small-target', 'Button'],
  ]);
});

test('accessibility: parseScreen attaches the audit to the screen', () => {
  const screen = parseScreen(
    android(
      node('android.widget.ImageButton', 'clickable="true" enabled="true" bounds="[0,0][300,300]"'),
    ),
    'android:abc',
  );
  assert.equal(screen.a11y?.[0].rule, 'missing-label');
});

test('accessibility: the campaign keeps the last audit of each screen and counts by severity', () => {
  const report = (id: string, at: string, issues: number): RunReport =>
    ({
      id,
      projectId: 'p',
      startedAt: at,
      status: 'passed',
      entries: [],
      snapshot: [],
      accessibility: [
        {
          os: 'android',
          screenId: 'login',
          screenName: 'Connexion',
          at,
          issues: Array.from({ length: issues }, () => ({
            rule: 'missing-label' as const,
            severity: 'error' as const,
            component: 'Button',
          })),
        },
        { os: 'ios', screenId: 'login', screenName: 'Connexion', at, issues: [] },
      ],
    }) as RunReport;
  const detail = {
    campaign: {},
    reports: [report('a', '2026-01-01', 3), report('b', '2026-01-02', 1)],
  } as unknown as CampaignDetail;
  const summary = accessibilityOf(detail);
  assert.equal(summary.errors, 1, 'the newer audit replaces the older one');
  assert.equal(summary.clean, 1);
  assert.equal(summary.screens[0].os, 'android', 'worst screen first');
  assert.deepEqual(accessibilityOf(null), { screens: [], errors: 0, warnings: 0, clean: 0 });
});
