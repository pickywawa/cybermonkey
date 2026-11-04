import { Circle, Plus, Square, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { stepsToNodes, type RecordedStep } from '../../../shared/domain/recording';
import { appendChildren, makeNode } from '../../../shared/domain/scenario';
import { call } from '../../shared/api';
import { useT } from '../../shared/i18n';
import { Badge, Button, Check, Spinner } from '../../shared/ui/controls';
import { PlatformIcon, osName } from '../../shared/ui/icons';
import { ErrorNotice } from '../../shared/ui/notices';
import { useActions, useActiveDevices, useApp } from '../../app/store';

/**
 * Record by driving the phone yourself: Cybermonkey watches the screen, turns each settled change into a step,
 * lets the AI settle ambiguous taps, and you review the list before adding it to the project.
 */
export function RecorderPanel() {
  const t = useT();
  const { project, recorder, provider } = useApp();
  const actions = useActions();
  const devices = useActiveDevices();
  const osList = Object.keys(devices) as ('android' | 'ios')[];
  const [os, setOs] = useState(osList[0]);
  const [assertions, setAssertions] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [review, setReview] = useState<RecordedStep[] | null>(null);
  useEffect(() => {
    if (!os || !devices[os]) setOs(osList[0]);
  }, [osList.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const steps = review ?? recorder.steps;
  const patch = (id: string, p: Partial<RecordedStep>) =>
    setReview((list) => (list ?? []).map((s) => (s.id === id ? { ...s, ...p } : s)));
  const live = recorder.running;
  const ai = useMemo(() => !!provider?.authenticated, [provider]);
  if (!project) return null;

  const start = async () => {
    if (!os || !devices[os]) return;
    setBusy(true);
    setError(null);
    setReview(null);
    try {
      await call('recorder.start', {
        projectId: project.id,
        deviceId: devices[os]!,
        withAssertions: assertions,
      });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => setReview(await call('recorder.stop', project.id).catch(() => []));
  const commit = async () => {
    const list = (review ?? []).filter((s) => s.operation !== 'tap' || s.locator);
    const nodes = stepsToNodes(
      list,
      (s) => '${' + (s.hint.match(/pass|mot|pin/i) ? 'PASSWORD' : 'SECRET') + '}',
    );
    const root = makeNode(
      'scenario',
      t('rec.scenarioName', { date: new Date().toLocaleString() }),
      [],
    );
    root.children = nodes;
    await actions.updateProject({
      nodes: appendChildren(project.nodes, null, [root]),
      selectedNodeId: root.id,
    });
    setReview(null);
  };

  return (
    <div className="recorder">
      <div className="row wrap">
        <Circle
          size={14}
          color={live ? 'var(--danger)' : 'var(--dim)'}
          fill={live ? 'var(--danger)' : 'none'}
        />
        <b className="grow">
          {live ? t('rec.recording') : review ? t('rec.review') : t('rec.title')}
        </b>
        {!live && !review && osList.length > 1 && (
          <select
            style={{ width: 120 }}
            value={os}
            onChange={(e) => setOs(e.target.value as 'android' | 'ios')}
          >
            {osList.map((o) => (
              <option key={o} value={o}>
                {osName(o)}
              </option>
            ))}
          </select>
        )}
        {!live && !review && (
          <Button
            variant="primary"
            size="sm"
            busy={busy}
            disabled={!os}
            icon={<Circle size={12} />}
            onClick={start}
          >
            {t('rec.start')}
          </Button>
        )}
        {live && (
          <Button variant="danger" size="sm" icon={<Square size={12} />} onClick={stop}>
            {t('rec.stop')}
          </Button>
        )}
        {review && (
          <>
            <Button size="sm" onClick={() => setReview(null)}>
              {t('rec.discard')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!steps.length}
              icon={<Plus size={13} />}
              onClick={commit}
            >
              {t('rec.add', { n: steps.length })}
            </Button>
          </>
        )}
      </div>
      {error != null && <ErrorNotice error={error} />}
      {!os && <div className="notice warn">{t('rec.noDevice')}</div>}
      {!live && !review && (
        <>
          <p className="note">{t('rec.help')}</p>
          <Check checked={assertions} onChange={setAssertions}>
            {t('rec.assertions')}
          </Check>
          <span className="note">{ai ? t('rec.aiOn') : t('rec.aiOff')}</span>
        </>
      )}
      {live && (
        <p className="note">
          <Spinner size={11} /> {t('rec.liveHint')}
        </p>
      )}
      <div className="rec-steps">
        {steps.map((s, i) => (
          <div key={s.id} className="rec-step">
            <span className="n">{i + 1}</span>
            <PlatformIcon os={s.platform} size={12} />
            <div className="grow">
              {review ? (
                <input
                  className="inline"
                  value={s.name}
                  onChange={(e) => patch(s.id, { name: e.target.value })}
                />
              ) : (
                <b>{s.name}</b>
              )}
              <div className="note ellipsis">
                {t(`op.${s.operation}` as never)}
                {s.locator ? ` · ${s.locator.value}` : ''}
                {s.operation === 'type' && !s.secure ? ` · « ${s.value} »` : ''}
              </div>
              {review && s.candidates && s.candidates.length > 1 && (
                <select
                  value={s.locator?.value ?? ''}
                  onChange={(e) => {
                    const c = s.candidates!.find((x) => x.locator.value === e.target.value);
                    if (c)
                      patch(s.id, {
                        locator: c.locator,
                        hint: c.hint,
                        name: t('rec.tapName', { name: c.hint }),
                        confidence: 'medium',
                      });
                  }}
                >
                  {s.candidates.map((c) => (
                    <option key={c.locator.value} value={c.locator.value}>
                      {c.hint}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <Badge
              tone={s.confidence === 'high' ? 'ok' : s.confidence === 'medium' ? 'accent' : 'warn'}
            >
              {s.source === 'ai' ? <Wand2 size={10} /> : null}
              {t(`rec.conf.${s.confidence}` as never)}
            </Badge>
            {live ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void call('recorder.discard', { projectId: project.id, stepId: s.id })
                }
              >
                <Trash2 size={12} />
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setReview((l) => (l ?? []).filter((x) => x.id !== s.id))}
              >
                <Trash2 size={12} />
              </Button>
            )}
          </div>
        ))}
        {!steps.length && (live || review) && (
          <div className="empty note">{live ? t('rec.waiting') : t('rec.empty')}</div>
        )}
      </div>
    </div>
  );
}
