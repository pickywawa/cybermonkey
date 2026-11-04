import { Circle, FileUp, PenLine, Sparkles } from 'lucide-react';
import { useT } from '../shared/i18n';
import { useWorkbench } from '../features/devices/workbench';

/** Empty state of the creation tab: four ways to start a scenario. */
export function CreationHome({ onNew }: { onNew: () => void }) {
  const t = useT();
  const { prefillAi } = useWorkbench();
  const cards = [
    {
      icon: <Sparkles size={22} />,
      title: t('home.ai'),
      text: t('home.aiText'),
      action: () => prefillAi(''),
    },
    {
      icon: <Circle size={22} />,
      title: t('home.record'),
      text: t('home.recordText'),
      action: () => window.dispatchEvent(new CustomEvent('cybermonkey:record')),
    },
    {
      icon: <FileUp size={22} />,
      title: t('home.import'),
      text: t('home.importText'),
      action: () => window.dispatchEvent(new CustomEvent('cybermonkey:import')),
    },
    {
      icon: <PenLine size={22} />,
      title: t('home.manual'),
      text: t('home.manualText'),
      action: onNew,
    },
  ];
  return (
    <div className="home">
      <h2>{t('home.title')}</h2>
      <p className="muted">{t('home.subtitle')}</p>
      <div className="home-grid">
        {cards.map((c) => (
          <button key={c.title} className="home-card" onClick={c.action}>
            <span className="ico">{c.icon}</span>
            <b>{c.title}</b>
            <span className="note">{c.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
