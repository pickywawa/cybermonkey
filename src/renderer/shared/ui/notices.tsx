import { Copy, Sparkles, TriangleAlert } from 'lucide-react';
import { classifyError } from '../../../shared/errors';
import { useT } from '../i18n';
import { Button } from './controls';
import { useToast } from './overlays';

/** Friendly, actionable error: a title, what to do, the raw detail on demand, and optional AI help. */
export function ErrorNotice({
  error,
  onAskAi,
  tone = 'err',
}: {
  error: unknown;
  onAskAi?: () => void;
  tone?: 'err' | 'warn';
}) {
  const t = useT();
  const toast = useToast();
  const raw = error instanceof Error ? error.message : String(error);
  const info = (error as { info?: ReturnType<typeof classifyError> })?.info ?? classifyError(raw);
  return (
    <div className={`notice ${tone}`} role="alert">
      <TriangleAlert size={16} style={{ marginTop: 2 }} />
      <div className="grow">
        <div className="title">{t(`err.${info.code}.title` as never)}</div>
        <div className="hint">{t(`err.${info.code}.hint` as never)}</div>
        {info.code !== 'cancelled' && (
          <details style={{ marginTop: 6 }}>
            <summary className="note" style={{ cursor: 'pointer' }}>
              {t('common.details')}
            </summary>
            <pre>{raw}</pre>
          </details>
        )}
        <div className="row wrap" style={{ marginTop: 6 }}>
          <Button
            size="sm"
            variant="ghost"
            icon={<Copy size={12} />}
            onClick={() =>
              navigator.clipboard.writeText(raw).then(() => toast(t('common.copied'), 'ok'))
            }
          >
            {t('common.copy')}
          </Button>
          {onAskAi && (
            <Button size="sm" variant="ghost" icon={<Sparkles size={12} />} onClick={onAskAi}>
              {t('common.askAi')}
            </Button>
          )}
          {info.docs && (
            <a className="note" href={info.docs} target="_blank" rel="noreferrer">
              {t('common.docs')}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
