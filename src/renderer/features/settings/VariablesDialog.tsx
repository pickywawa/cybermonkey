import { Eye, EyeOff, Plus, Trash2, Variable } from 'lucide-react';
import { useState } from 'react';
import { variableName } from '../../../shared/domain/variables';
import { useT } from '../../shared/i18n';
import { Button } from '../../shared/ui/controls';
import { Modal } from '../../shared/ui/overlays';
import { useActions, useApp } from '../../app/store';

/** Project variables referenced as ${NAME} in scenarios. Stored locally in the project: NOT an encrypted vault. */
export function VariablesDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { project } = useApp();
  const actions = useActions();
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [shown, setShown] = useState<Set<string>>(new Set());
  if (!project) return null;
  const vars = project.variables;
  const save = (next: Record<string, string>) => void actions.updateProject({ variables: next });
  const valid = variableName.safeParse(name).success && !Object.hasOwn(vars, name);
  return (
    <Modal
      title={t('var.title')}
      icon={<Variable size={16} color="var(--accent)" />}
      onClose={onClose}
    >
      <div className="stack">
        <p className="note">{t('var.hint')}</p>
        {Object.entries(vars).map(([k, v]) => (
          <div key={k} className="row">
            <code style={{ width: 170 }} className="ellipsis" title={k}>
              {'${' + k + '}'}
            </code>
            <input
              className="mono"
              type={shown.has(k) ? 'text' : 'password'}
              value={v}
              onChange={(e) => save({ ...vars, [k]: e.target.value })}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setShown((s) => {
                  const n = new Set(s);
                  n.has(k) ? n.delete(k) : n.add(k);
                  return n;
                })
              }
            >
              {shown.has(k) ? <EyeOff size={13} /> : <Eye size={13} />}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const { [k]: _gone, ...rest } = vars;
                void _gone;
                save(rest);
              }}
            >
              <Trash2 size={13} />
            </Button>
          </div>
        ))}
        {!Object.keys(vars).length && <div className="empty note">{t('var.empty')}</div>}
        <div className="row">
          <input
            style={{ width: 170 }}
            className="mono"
            placeholder="PASSWORD"
            value={name}
            onChange={(e) => setName(e.target.value.toUpperCase())}
          />
          <input
            className="mono"
            type="password"
            placeholder={t('var.value')}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button
            size="sm"
            disabled={!valid}
            icon={<Plus size={13} />}
            onClick={() => {
              save({ ...vars, [name]: value });
              setName('');
              setValue('');
            }}
          >
            {t('var.add')}
          </Button>
        </div>
        <p className="note">{t('var.ai')}</p>
      </div>
    </Modal>
  );
}
