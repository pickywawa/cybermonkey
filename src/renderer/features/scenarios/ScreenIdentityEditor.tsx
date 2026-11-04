import { Crosshair, Trash2 } from 'lucide-react';
import type { Locator, OS, ScreenDefinition } from '../../../shared/domain/scenario';
import { newId } from '../../../shared/domain/scenario';
import { useT } from '../../shared/i18n';
import { Button, Field } from '../../shared/ui/controls';
import { PlatformIcon } from '../../shared/ui/icons';
import { useWorkbench } from '../devices/workbench';

/** Destination (or start) screen identity: a name + distinctive markers per OS. */
export function ScreenIdentityEditor({
  title,
  value,
  oses,
  onChange,
}: {
  title: string;
  value: ScreenDefinition | undefined;
  oses: OS[];
  onChange: (v: ScreenDefinition | undefined) => void;
}) {
  const t = useT();
  const { picked } = useWorkbench();
  const def: ScreenDefinition = value ?? { id: newId(), name: '', variants: {} };
  const markers = (os: OS): Locator[] => def.variants[os]?.markers ?? [];
  const setMarkers = (os: OS, list: Locator[]) => {
    const variants = { ...def.variants, [os]: list.length ? { markers: list } : undefined };
    if (!list.length) delete (variants as Record<string, unknown>)[os];
    onChange(Object.keys(variants).length || def.name ? { ...def, variants } : undefined);
  };
  return (
    <div className="screen-identity">
      <div className="eyebrow">{title}</div>
      <div className="grid2">
        <Field label={t('ed.screenName')}>
          <input value={def.name} onChange={(e) => onChange({ ...def, name: e.target.value })} />
        </Field>
        <Field label={t('ed.screenId')}>
          <input
            className="mono"
            value={def.id}
            onChange={(e) => onChange({ ...def, id: e.target.value })}
          />
        </Field>
      </div>
      {oses.map((os) => (
        <div key={os} className="stack" style={{ gap: 4 }}>
          <div className="row">
            <PlatformIcon os={os} />
            <span className="label grow">{t('ed.markers')}</span>
            <Button
              size="sm"
              disabled={
                !picked || picked.os !== os || !picked.component.locator || def.name.trim() === ''
              }
              icon={<Crosshair size={12} />}
              title={def.name ? '' : t('ed.nameFirst')}
              onClick={() =>
                picked?.component.locator &&
                setMarkers(os, [...markers(os), picked.component.locator])
              }
            >
              {t('ed.addMarker')}
            </Button>
          </div>
          {markers(os).map((m, i) => (
            <div key={i} className="row">
              <code className="grow ellipsis" title={m.value}>
                {m.using} · {m.value}
              </code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setMarkers(
                    os,
                    markers(os).filter((_, j) => j !== i),
                  )
                }
              >
                <Trash2 size={12} />
              </Button>
            </div>
          ))}
          {!markers(os).length && <span className="note">{t('ed.noMarkers')}</span>}
        </div>
      ))}
    </div>
  );
}
