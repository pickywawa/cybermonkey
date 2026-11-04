import { Crosshair, Play, Plus, Trash2, TriangleAlert, Variable } from 'lucide-react';
import { useState } from 'react';
import {
  ASSERTIONS,
  DIRECTIONS,
  OPERATIONS,
  makeVariant,
  needsComponent,
  type Locator,
  type NodeKind,
  type OS,
  type Variant,
} from '../../../shared/domain/scenario';
import { effectiveVariables } from '../../../shared/domain/project';
import { reviewVariant } from '../../../shared/domain/selectors';
import { call } from '../../shared/api';
import { useT } from '../../shared/i18n';
import { Button, Field } from '../../shared/ui/controls';
import { PlatformIcon, osName } from '../../shared/ui/icons';
import { ErrorNotice } from '../../shared/ui/notices';
import { useToast } from '../../shared/ui/overlays';
import { useApp } from '../../app/store';
import { useWorkbench } from '../devices/workbench';

const USING: Locator['using'][] = ['accessibility id', 'id', 'xpath'];

/** Editor of ONE OS implementation of a step; the shared step keeps the business intent. */
export function VariantEditor({
  os,
  kind,
  variant,
  onChange,
}: {
  os: OS;
  kind: NodeKind;
  variant: Variant | undefined;
  onChange: (v: Variant | undefined) => void;
}) {
  const t = useT();
  const toast = useToast();
  const { project, devices } = useApp();
  const { picked } = useWorkbench();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const deviceId = project?.deviceIds[os];
  const ready = devices.devices.some((d) => d.id === deviceId && d.status === 'ready');
  const pickedHere = picked?.os === os ? picked.component : null;

  if (!variant)
    return (
      <div className="variant empty-variant">
        <PlatformIcon os={os} />{' '}
        <span className="grow muted">{t('ed.noVariant', { os: osName(os) })}</span>
        <Button
          size="sm"
          icon={<Plus size={13} />}
          onClick={() =>
            onChange(
              makeVariant({
                operation: kind === 'test' ? 'assert' : 'tap',
                ...(pickedHere?.locator
                  ? { locator: pickedHere.locator, hint: pickedHere.label }
                  : {}),
              }),
            )
          }
        >
          {t('ed.addVariant')}
        </Button>
      </div>
    );
  const set = (patch: Partial<Variant>) => onChange({ ...variant, ...patch });
  const isTest = kind === 'test';
  const ops = isTest ? (['assert'] as const) : OPERATIONS.filter((o) => o !== 'assert');
  const needsLocator = (isTest || needsComponent(variant.operation)) && !variant.point;
  const loc = variant.locator;
  const run = async () => {
    if (!deviceId) return;
    setBusy(true);
    setError(null);
    try {
      await call('devices.perform', { deviceId, projectId: project?.id, variant, kind });
      toast(t('ed.runOk'), 'ok');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="variant">
      <div className="row">
        <PlatformIcon os={os} />
        <b className="grow">{osName(os)}</b>
        <Button
          size="sm"
          icon={<Play size={12} />}
          busy={busy}
          disabled={!ready}
          onClick={run}
          title={ready ? '' : t('ed.noDevice')}
        >
          {t('ed.try')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Trash2 size={12} />}
          onClick={() => onChange(undefined)}
        >
          {t('ed.removeVariant')}
        </Button>
      </div>
      {error != null && <ErrorNotice error={error} />}
      <div className="grid2">
        {!isTest && (
          <Field label={t('ed.operation')}>
            <select
              value={variant.operation}
              onChange={(e) => set({ operation: e.target.value as Variant['operation'] })}
            >
              {ops.map((o) => (
                <option key={o} value={o}>
                  {t(`op.${o}` as never)}
                </option>
              ))}
            </select>
          </Field>
        )}
        {isTest && (
          <Field label={t('ed.assertion')}>
            <select
              value={variant.assertion}
              onChange={(e) => set({ assertion: e.target.value as Variant['assertion'] })}
            >
              {ASSERTIONS.map((a) => (
                <option key={a} value={a}>
                  {t(`as.${a}` as never)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t('ed.hint')}>
          <input
            value={variant.hint}
            placeholder={t('ed.hintPh')}
            onChange={(e) => set({ hint: e.target.value })}
          />
        </Field>
      </div>
      {variant.point && (
        <div className="notice">
          <div className="grow">
            {t('ed.point', {
              x: Math.round(variant.point.x * 100),
              y: Math.round(variant.point.y * 100),
            })}
            <div className="note">{t('ed.pointHint')}</div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => set({ point: undefined })}>
            {t('ed.removePoint')}
          </Button>
        </div>
      )}
      {(needsLocator || variant.point) && (loc || variant.point) && (
        <SelectorQuality variant={variant} />
      )}
      {needsLocator && (
        <>
          <div className="grid2" style={{ gridTemplateColumns: '150px 1fr auto' }}>
            <Field label={t('ed.selector')}>
              <select
                value={loc?.using ?? 'accessibility id'}
                onChange={(e) =>
                  set({
                    locator: { using: e.target.value as Locator['using'], value: loc?.value ?? '' },
                  })
                }
              >
                {USING.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </Field>
            <Field label="​">
              <input
                className="mono"
                value={loc?.value ?? ''}
                placeholder="…"
                onChange={(e) =>
                  set({
                    locator: e.target.value
                      ? { using: loc?.using ?? 'accessibility id', value: e.target.value }
                      : undefined,
                  })
                }
              />
            </Field>
            <Field label="​">
              <Button
                disabled={!pickedHere?.locator}
                icon={<Crosshair size={13} />}
                title={t('ed.usePickedHint')}
                onClick={() =>
                  set({ locator: pickedHere!.locator, hint: variant.hint || pickedHere!.label })
                }
              >
                {t('ed.usePicked')}
              </Button>
            </Field>
          </div>
          {variant.fallbacks.length > 0 && (
            <div className="stack" style={{ gap: 4 }}>
              <span className="label">{t('ed.fallbacks')}</span>
              {variant.fallbacks.map((f, i) => (
                <div key={i} className="row">
                  <code className="grow ellipsis" title={f.value}>
                    {f.using} · {f.value}
                  </code>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => set({ fallbacks: variant.fallbacks.filter((_, j) => j !== i) })}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              ))}
            </div>
          )}
          {pickedHere?.locator &&
            loc &&
            JSON.stringify(pickedHere.locator) !== JSON.stringify(loc) &&
            variant.fallbacks.length < 5 && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Plus size={12} />}
                onClick={() => set({ fallbacks: [...variant.fallbacks, pickedHere.locator!] })}
              >
                {t('ed.addFallback')}
              </Button>
            )}
        </>
      )}
      {!isTest && variant.operation === 'type' && (
        <Field label={t('ed.value')} hint={t('ed.valueHint')}>
          <div className="row">
            <input
              className="mono"
              value={variant.value}
              placeholder="${PASSWORD}"
              onChange={(e) => set({ value: e.target.value })}
            />
            {Object.keys(project ? effectiveVariables(project) : {})
              .slice(0, 4)
              .map((k) => (
                <Button
                  key={k}
                  size="sm"
                  variant="ghost"
                  icon={<Variable size={11} />}
                  onClick={() => set({ value: '${' + k + '}' })}
                >
                  {k}
                </Button>
              ))}
          </div>
        </Field>
      )}
      {!isTest && variant.operation === 'wait' && (
        <Field label={t('ed.waitMs')}>
          <input
            type="number"
            min={0}
            value={variant.value}
            onChange={(e) => set({ value: e.target.value })}
          />
        </Field>
      )}
      {!isTest && (variant.operation === 'longpress' || variant.operation === 'background') && (
        <Field label={t(variant.operation === 'longpress' ? 'ed.durationMs' : 'ed.seconds')}>
          <input
            type="number"
            min={0}
            placeholder={variant.operation === 'longpress' ? '1000' : '2'}
            value={variant.value}
            onChange={(e) => set({ value: e.target.value })}
          />
        </Field>
      )}
      {!isTest && variant.operation === 'capture' && (
        <>
          <Field label={t('ed.captureVariable')} hint={t('ed.captureHint')}>
            <input
              className="mono"
              value={variant.value}
              placeholder="NUMERO_COMMANDE"
              onChange={(e) => set({ value: e.target.value })}
            />
          </Field>
          <Field label={t('ed.captureRegex')} hint={t('ed.captureRegexHint')}>
            <input
              className="mono"
              value={variant.expected}
              placeholder="n°(\d+)"
              onChange={(e) => set({ expected: e.target.value })}
            />
          </Field>
        </>
      )}
      {!isTest && variant.operation === 'deeplink' && (
        <Field label={t('ed.link')} hint={t('ed.linkHint')}>
          <input
            className="mono"
            value={variant.value}
            placeholder="monapp://commande/42"
            onChange={(e) => set({ value: e.target.value })}
          />
        </Field>
      )}
      {!isTest && variant.operation === 'alert' && (
        <Field label={t('ed.alertAnswer')} hint={t('ed.alertHint')}>
          <input
            value={variant.value}
            placeholder="accept"
            onChange={(e) => set({ value: e.target.value })}
          />
        </Field>
      )}
      {!isTest && variant.operation === 'orientation' && (
        <Field label={t('ed.orientationValue')}>
          <select
            value={variant.value || 'portrait'}
            onChange={(e) => set({ value: e.target.value })}
          >
            <option value="portrait">Portrait</option>
            <option value="landscape">Paysage / Landscape</option>
          </select>
        </Field>
      )}
      {!isTest && ['launch', 'relaunch', 'terminate'].includes(variant.operation) && (
        <Field label={t('ed.otherApp')} hint={t('ed.otherAppHint')}>
          <input
            className="mono"
            value={variant.value}
            onChange={(e) => set({ value: e.target.value })}
          />
        </Field>
      )}
      {!isTest && variant.operation === 'scroll' && (
        <Field label={t('ed.maxScrolls')}>
          <input
            type="number"
            min={1}
            max={40}
            placeholder="8"
            value={variant.value}
            onChange={(e) => set({ value: e.target.value })}
          />
        </Field>
      )}
      {!isTest && (variant.operation === 'swipe' || variant.operation === 'scroll') && (
        <Field label={t('ed.direction')}>
          <select
            value={variant.direction}
            onChange={(e) => set({ direction: e.target.value as Variant['direction'] })}
          >
            {DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {t(`dir.${d}` as never)}
              </option>
            ))}
          </select>
        </Field>
      )}
      {isTest && ['text', 'contains', 'matches', 'count'].includes(variant.assertion) && (
        <Field
          label={t(
            variant.assertion === 'matches'
              ? 'ed.expectedRegex'
              : variant.assertion === 'count'
                ? 'ed.expectedCount'
                : 'ed.expected',
          )}
          hint={variant.assertion === 'count' ? t('ed.countHint') : undefined}
        >
          <input
            className={
              variant.assertion === 'text' || variant.assertion === 'contains' ? '' : 'mono'
            }
            value={variant.expected}
            onChange={(e) => set({ expected: e.target.value })}
          />
        </Field>
      )}
      <Field label={t('ed.timeout')}>
        <input
          type="number"
          min={0}
          max={120000}
          step={500}
          value={variant.timeoutMs}
          onChange={(e) => set({ timeoutMs: Number(e.target.value) })}
        />
      </Field>
    </div>
  );
}

/** Tells how long the selector will survive UI changes; silent when it is a good one. */
function SelectorQuality({ variant }: { variant: Variant }) {
  const t = useT();
  const r = reviewVariant(variant);
  if (r.quality === 'durable') return null;
  return (
    <div className={`notice ${r.quality === 'fair' ? '' : 'warn'}`} style={{ padding: '6px 10px' }}>
      <TriangleAlert size={14} style={{ marginTop: 2 }} />
      <div className="grow">
        <div className="note">
          <b>{t(`sel.${r.quality}` as never)}</b> {r.reason}
        </div>
        {r.quality !== 'fair' && <div className="note">{t('sel.ask')}</div>}
      </div>
    </div>
  );
}
