import { HelpCircle } from 'lucide-react';
import { useState } from 'react';
import { call } from '../../shared/api';
import { useT } from '../../shared/i18n';
import { Button } from '../../shared/ui/controls';
import { Modal } from '../../shared/ui/overlays';
import { useActions, useApp } from '../../app/store';

/** The AI paused the exploration to ask something (or to create a variable). Closing cancels the exploration. */
export function QuestionDialog() {
  const t = useT();
  const { question, project } = useApp();
  const actions = useActions();
  const [answer, setAnswer] = useState('');
  if (!question || !project) return null;
  const send = async (value: string) => {
    await call('creation.answer', {
      projectId: project.id,
      questionId: question.questionId,
      answer: value,
    }).catch(() => {});
    actions.setQuestion(null);
    setAnswer('');
  };
  const cancel = () => {
    void call('creation.cancel', project.id);
    actions.setQuestion(null);
  };
  return (
    <Modal
      title={question.variableName ? t('q.variable') : t('q.title')}
      icon={<HelpCircle size={16} color="var(--accent)" />}
      size="narrow"
      onClose={cancel}
      footer={
        question.variableName ? (
          <>
            <Button onClick={() => void send('decline')}>{t('q.decline')}</Button>
            <Button variant="primary" onClick={() => void send('approve')}>
              {t('q.approve')}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={cancel}>{t('q.stop')}</Button>
            <Button variant="primary" disabled={!answer.trim()} onClick={() => void send(answer)}>
              {t('q.send')}
            </Button>
          </>
        )
      }
    >
      <p style={{ whiteSpace: 'pre-wrap' }}>{question.question}</p>
      {question.variableName ? (
        <p className="note">{t('q.variableHint', { name: question.variableName })}</p>
      ) : (
        <textarea
          autoFocus
          rows={3}
          value={answer}
          placeholder={t('q.placeholder')}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && answer.trim()) void send(answer);
          }}
        />
      )}
    </Modal>
  );
}
