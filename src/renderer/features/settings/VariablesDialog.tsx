import { Check, Eye, EyeOff, Layers, Plus, Trash2, Variable } from 'lucide-react';
import { useState } from 'react';
import type { Environment } from '../../../shared/domain/project';
import { variableName } from '../../../shared/domain/variables';
import { useT } from '../../shared/i18n';
import { Button } from '../../shared/ui/controls';
import { Modal } from '../../shared/ui/overlays';
import { useActions, useApp } from '../../app/store';

const COMMON = 'common';

/**
 * Project variables referenced as ${NAME} in scenarios, in the common set and per environment (staging, pre-production…).
 * The selected environment's variables override the common ones. Stored locally in the project: NOT an encrypted vault.
 */
export function VariablesDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { project } = useApp();
  const actions = useActions();
  const [scope, setScope] = useState<string>(project?.activeEnvironmentId ?? COMMON);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [newEnv, setNewEnv] = useState<string | null>(null);
  const [shown, setShown] = useState<Set<string>>(new Set());
  if (!project) return null;
  const envs = project.environments ?? [];
  const env = envs.find((e) => e.id === scope);
  const common = project.variables;
  const vars = env ? env.variables : common;
  const inherited = env
    ? Object.entries(common).filter(([k]) => !Object.hasOwn(env.variables, k))
    : [];
  const save = (next: Record<string, string>) =>
    env
      ? void actions.updateProject({
          environments: envs.map((e) => (e.id === env.id ? { ...e, variables: next } : e)),
        })
      : void actions.updateProject({ variables: next });
  const valid = variableName.safeParse(name).success && !Object.hasOwn(vars, name);
  const nameTaken = (n: string, except?: string) =>
    envs.some((e) => e.id !== except && e.name.trim().toLowerCase() === n.trim().toLowerCase());
  const createEnv = () => {
    const n = (newEnv ?? '').trim();
    if (!n || nameTaken(n)) return;
    const created: Environment = { id: crypto.randomUUID(), name: n, variables: {} };
    void actions.updateProject({ environments: [...envs, created] });
    setScope(created.id);
    setNewEnv(null);
  };
  const toggle = (k: string) =>
    setShown((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  return (
    <Modal
      title={t('var.title')}
      icon={<Variable size={16} color="var(--accent)" />}
      onClose={onClose}
    >
      <div className="stack">
        <p className="note">{t('var.hint')}</p>
        <div className="row wrap" style={{ gap: 6 }}>
          <Button
            size="sm"
            variant={scope === COMMON ? 'primary' : 'ghost'}
            icon={<Layers size={12} />}
            onClick={() => setScope(COMMON)}
          >
            {t('env.common')}
          </Button>
          {envs.map((e) => (
            <Button
              key={e.id}
              size="sm"
              variant={scope === e.id ? 'primary' : 'ghost'}
              icon={e.id === project.activeEnvironmentId ? <Check size={12} /> : undefined}
              onClick={() => setScope(e.id)}
            >
              {e.name}
            </Button>
          ))}
          {newEnv === null ? (
            <Button
              size="sm"
              variant="ghost"
              icon={<Plus size={12} />}
              onClick={() => setNewEnv('')}
            >
              {t('env.new')}
            </Button>
          ) : (
            <span className="row" style={{ gap: 4 }}>
              <input
                autoFocus
                style={{ width: 150 }}
                placeholder={t('env.namePlaceholder')}
                value={newEnv}
                onChange={(e) => setNewEnv(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createEnv()}
              />
              <Button size="sm" disabled={!newEnv.trim() || nameTaken(newEnv)} onClick={createEnv}>
                {t('var.add')}
              </Button>
            </span>
          )}
        </div>
        {env && (
          <div className="row" style={{ gap: 8 }}>
            <input
              style={{ width: 200 }}
              value={env.name}
              maxLength={60}
              onChange={(e) =>
                !nameTaken(e.target.value, env.id) &&
                void actions.updateProject({
                  environments: envs.map((x) =>
                    x.id === env.id ? { ...x, name: e.target.value } : x,
                  ),
                })
              }
            />
            <Button
              size="sm"
              disabled={env.id === project.activeEnvironmentId}
              onClick={() => void actions.updateProject({ activeEnvironmentId: env.id })}
            >
              {env.id === project.activeEnvironmentId ? t('env.selected') : t('env.use')}
            </Button>
            <span className="grow" />
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 size={12} />}
              onClick={() => {
                if (!confirm(t('env.confirmDelete', { name: env.name }))) return;
                void actions.updateProject({ environments: envs.filter((x) => x.id !== env.id) });
                setScope(COMMON);
              }}
            >
              {t('env.delete')}
            </Button>
          </div>
        )}
        {env && <p className="note">{t('env.overrideHint')}</p>}
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
            <Button size="sm" variant="ghost" onClick={() => toggle(k)}>
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
        {inherited.map(([k, v]) => (
          <div key={k} className="row" style={{ opacity: 0.6 }}>
            <code style={{ width: 170 }} className="ellipsis" title={k}>
              {'${' + k + '}'}
            </code>
            <input className="mono" type="password" value={v} readOnly />
            <Button size="sm" variant="ghost" onClick={() => save({ ...vars, [k]: v })}>
              {t('env.override')}
            </Button>
          </div>
        ))}
        {!Object.keys(vars).length && !inherited.length && (
          <div className="empty note">{t('var.empty')}</div>
        )}
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

/** Sidebar selector of the project's environment: applies to creation and execution alike. */
export function EnvironmentPicker({ onManage }: { onManage: () => void }) {
  const t = useT();
  const { project } = useApp();
  const actions = useActions();
  if (!project) return null;
  const envs = project.environments ?? [];
  if (!envs.length)
    return (
      <button className="side-foot" onClick={onManage}>
        <Layers size={14} /> {t('env.add')}
      </button>
    );
  return (
    <div className="side-foot env-picker" title={t('env.pickerHint')}>
      <Layers size={14} />
      <select
        value={project.activeEnvironmentId ?? ''}
        onChange={(e) =>
          void actions.updateProject({ activeEnvironmentId: e.target.value || null })
        }
      >
        <option value="">{t('env.none')}</option>
        {envs.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
      <button className="icon-btn" onClick={onManage} title={t('env.manage')}>
        <Variable size={13} />
      </button>
    </div>
  );
}
