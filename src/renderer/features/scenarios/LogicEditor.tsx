import { GitBranch, Repeat, ShieldAlert, Workflow } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  MAX_DATASET_ROWS,
  OS_LIST,
  datasetColumns,
  newId,
  type OS,
  type ScenarioNode,
  type Variant,
} from '../../../shared/domain/scenario';
import { parseDataset } from '../../../shared/domain/dataset';
import { useT } from '../../shared/i18n';
import { Check, Field } from '../../shared/ui/controls';
import { ScreenIdentityEditor } from './ScreenIdentityEditor';
import { VariantEditor } from './VariantEditor';

/** "Only if…": a per-OS assertion checked right before the step; not met = skipped, never failed. */
export function ConditionEditor({
  node,
  oses,
  onChange,
}: {
  node: ScenarioNode;
  oses: OS[];
  onChange: (when: ScenarioNode['when']) => void;
}) {
  const t = useT();
  const on = !!node.when;
  return (
    <div className="stack">
      <Check checked={on} onChange={(v) => onChange(v ? {} : undefined)}>
        <span className="row" style={{ gap: 4 }}>
          <GitBranch size={13} /> {t('logic.when')}
        </span>
      </Check>
      {on && (
        <>
          <p className="note">{t('logic.whenHint')}</p>
          {OS_LIST.filter(
            (o) => oses.includes(o) && (!node.platforms || node.platforms.includes(o)),
          ).map((os) => (
            <VariantEditor
              key={os}
              os={os}
              kind="test"
              variant={node.when?.[os]}
              onChange={(v: Variant | undefined) =>
                onChange({
                  ...node.when,
                  // A condition must answer fast when the element is absent.
                  [os]: v && !node.when?.[os] ? { ...v, timeoutMs: 1500 } : v,
                })
              }
            />
          ))}
        </>
      )}
    </div>
  );
}

/** Reuse another scenario in place of this step. */
export function CallEditor({
  node,
  scenarios,
  onChange,
}: {
  node: ScenarioNode;
  scenarios: ScenarioNode[];
  onChange: (call: string | undefined) => void;
}) {
  const t = useT();
  return (
    <div className="stack">
      <Check
        checked={!!node.call}
        onChange={(v) => onChange(v ? (scenarios[0]?.id ?? '') : undefined)}
      >
        <span className="row" style={{ gap: 4 }}>
          <Workflow size={13} /> {t('logic.call')}
        </span>
      </Check>
      {node.call !== undefined && (
        <Field label={t('logic.callTarget')} hint={t('logic.callHint')}>
          <select value={node.call} onChange={(e) => onChange(e.target.value)}>
            {scenarios.length === 0 && <option value="">{t('ed.none')}</option>}
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      )}
    </div>
  );
}

const toText = (d: NonNullable<ScenarioNode['dataset']>) => {
  const columns = datasetColumns(d);
  return [columns.join(';'), ...d.rows.map((r) => columns.map((c) => r[c] ?? '').join(';'))].join(
    '\n',
  );
};

/** Play the scenario once per row of a table; each column is a variable. */
export function DatasetEditor({
  node,
  onChange,
}: {
  node: ScenarioNode;
  onChange: (dataset: ScenarioNode['dataset']) => void;
}) {
  const t = useT();
  const [text, setText] = useState(node.dataset ? toText(node.dataset) : '');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText(node.dataset ? toText(node.dataset) : '');
    setError(null);
  }, [node.id]);
  const on = node.dataset !== undefined || text !== '';
  const commit = (value: string) => {
    if (!value.trim()) return void (setError(null), onChange(undefined));
    const parsed = parseDataset(value);
    if ('error' in parsed) return setError(parsed.error);
    setError(null);
    onChange(parsed);
  };
  return (
    <div className="stack">
      <Check
        checked={on}
        onChange={(v) => {
          if (v) setText('Variable;Autre\nvaleur 1;valeur 2');
          else {
            setText('');
            commit('');
          }
        }}
      >
        <span className="row" style={{ gap: 4 }}>
          <Repeat size={13} /> {t('logic.dataset')}
        </span>
      </Check>
      {on && (
        <>
          <p className="note">{t('logic.datasetHint', { max: MAX_DATASET_ROWS })}</p>
          <textarea
            className="mono"
            rows={Math.min(10, Math.max(4, text.split('\n').length + 1))}
            value={text}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => commit(text)}
          />
          {error && (
            <p className="note" style={{ color: 'var(--danger, #c0392b)' }}>
              {t(error as never)}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Make a scenario an interruption handler: what is on screen when the interruption shows (a popup, the login screen after
 * a session expiry…), and what to do afterwards. The scenario's own steps are the answer.
 */
export function HandlerEditor({
  node,
  oses,
  onChange,
}: {
  node: ScenarioNode;
  oses: OS[];
  onChange: (handler: ScenarioNode['handler']) => void;
}) {
  const t = useT();
  const h = node.handler;
  return (
    <div className="stack">
      <Check
        checked={!!h}
        onChange={(v) =>
          onChange(
            v
              ? {
                  when: { id: newId(), name: node.name, variants: {} },
                  resume: 'return',
                  maxPerRun: 5,
                }
              : undefined,
          )
        }
      >
        <span className="row" style={{ gap: 4 }}>
          <ShieldAlert size={13} /> {t('logic.handler')}
        </span>
      </Check>
      {h && (
        <>
          <p className="note">{t('logic.handlerHint')}</p>
          <ScreenIdentityEditor
            title={t('logic.handlerWhen')}
            value={h.when}
            oses={oses}
            onChange={(when) => when && onChange({ ...h, when })}
          />
          <Field label={t('logic.handlerResume')} hint={t('logic.handlerResumeHint')}>
            <select
              value={h.resume}
              onChange={(e) => onChange({ ...h, resume: e.target.value as 'retry' | 'return' })}
            >
              <option value="return">{t('logic.resume.return')}</option>
              <option value="retry">{t('logic.resume.retry')}</option>
            </select>
          </Field>
        </>
      )}
    </div>
  );
}
