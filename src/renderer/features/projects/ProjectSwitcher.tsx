import { ChevronDown, FolderOpen, Plus, Pencil, Upload, Trash2 } from 'lucide-react';
import { call } from '../../shared/api';
import { useT } from '../../shared/i18n';
import { PlatformIcon } from '../../shared/ui/icons';
import { Menu } from '../../shared/ui/overlays';
import { useActions, useApp } from '../../app/store';
import { useUi } from '../../app/ui';

export function ProjectSwitcher() {
  const t = useT();
  const { workspace, project } = useApp();
  const actions = useActions();
  const ui = useUi();
  return (
    <div className="project-switcher">
      <div className="eyebrow">{t('proj.current')}</div>
      <Menu
        trigger={(toggle) => (
          <button className="proj-btn" onClick={toggle}>
            <FolderOpen size={16} color="var(--accent)" />
            <span className="grow ellipsis" style={{ textAlign: 'left' }}>
              <b>{project?.name ?? t('proj.none')}</b>
              <span className="row note" style={{ gap: 4 }}>
                {project?.platforms.map((o) => (
                  <PlatformIcon key={o} os={o} size={11} />
                ))}
                {project?.applicationDetails.android?.name ||
                  project?.applicationDetails.ios?.name ||
                  ''}
              </span>
            </span>
            <ChevronDown size={14} />
          </button>
        )}
      >
        {(close) => (
          <div style={{ minWidth: 250 }}>
            {workspace?.projects.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  close();
                  void actions.selectProject(p.id);
                }}
                style={{ fontWeight: p.id === project?.id ? 700 : 400 }}
              >
                {p.name}
              </button>
            ))}
            {!!workspace?.projects.length && <hr />}
            <button
              onClick={() => {
                close();
                ui.openProject('new');
              }}
            >
              <Plus size={13} /> {t('proj.new')}
            </button>
            <button
              disabled={!project}
              onClick={() => {
                close();
                ui.openProject('edit');
              }}
            >
              <Pencil size={13} /> {t('proj.edit')}
            </button>
            <button
              disabled={!project}
              onClick={() => {
                close();
                void call('projects.reveal', project!.id);
              }}
            >
              <FolderOpen size={13} /> {t('proj.reveal')}
            </button>
            <button
              disabled={!project}
              style={{ color: 'var(--danger)' }}
              onClick={() => {
                close();
                if (project && confirm(t('proj.confirmRemove', { name: project.name })))
                  void call('projects.remove', project.id).then(() => actions.refreshWorkspace());
              }}
            >
              <Trash2 size={13} /> {t('proj.remove')}
            </button>
          </div>
        )}
      </Menu>
    </div>
  );
}
