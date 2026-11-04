import { useEffect, useState } from 'react';
import type { ConfirmRequest } from '../../../shared/domain/integrations';
import { call, onEvent } from '../../shared/api';
import { useT } from '../../shared/i18n';
import { Button } from '../../shared/ui/controls';
import { Modal } from '../../shared/ui/overlays';

/**
 * The confirmation window behind every automatic action that leaves the machine (git push, ticket, results…).
 * Requests queue up and are answered one at a time; closing the window means « later », never « yes ».
 */
export function IntegrationConfirm() {
  const t = useT();
  const [queue, setQueue] = useState<ConfirmRequest[]>([]);
  const current = queue[0];
  const [text, setText] = useState('');
  useEffect(
    () =>
      onEvent((e) => {
        if (e.type === 'confirm') setQueue((q) => [...q, e.request]);
      }),
    [],
  );
  useEffect(() => setText(current?.editable?.value ?? ''), [current?.id]);
  if (!current) return null;
  const answer = async (accepted: boolean) => {
    setQueue((q) => q.slice(1));
    await call('integrations.answer', {
      id: current.id,
      accepted,
      edited: current.editable && accepted ? text : undefined,
    }).catch(() => {});
  };
  return (
    <Modal
      size="wide"
      title={current.title}
      onClose={() => void answer(false)}
      footer={
        current.informational ? (
          <Button variant="primary" onClick={() => void answer(false)}>
            {t('int.confirm.ok')}
          </Button>
        ) : (
          <>
            <Button onClick={() => void answer(false)}>{t('int.confirm.later')}</Button>
            <Button variant="primary" onClick={() => void answer(true)}>
              {current.confirmLabel}
            </Button>
          </>
        )
      }
    >
      <div className="stack">
        <p>{current.message}</p>
        {current.details.length > 0 && (
          <ul className="int-details mono">
            {current.details.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        )}
        {current.editable && (
          <div className="field">
            <label>{current.editable.label}</label>
            <textarea
              className={current.editable.mono ? 'mono' : ''}
              rows={current.editable.rows ?? 3}
              spellCheck={false}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        )}
        {queue.length > 1 && <span className="note">+{queue.length - 1}</span>}
      </div>
    </Modal>
  );
}
