import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { campaignFrames, outcomeOf } from '../../../shared/domain/campaign';
import { call } from '../../shared/api';
import { useT } from '../../shared/i18n';
import { IconButton } from '../../shared/ui/controls';
import { useApp } from '../../app/store';

/** Scrub through every step with its capture; the phone mirrors show the matching history while tests keep running. */
export function Timeline() {
  const t = useT();
  const { detail, replay, project } = useApp();
  const frames = useMemo(() => campaignFrames(detail), [detail]);
  const index = replay ? frames.findIndex((f) => f.entry.id === replay.entry.id) : -1;
  const [playing, setPlaying] = useState(false);
  const go = (i: number) => {
    const f = frames[Math.max(0, Math.min(frames.length - 1, i))];
    if (f && project) void call('replay.select', { projectId: project.id, frame: f });
  };
  useEffect(() => {
    if (!playing) return;
    if (index >= frames.length - 1) return setPlaying(false);
    const timer = setTimeout(() => go(index + 1), 1100);
    return () => clearTimeout(timer);
  }, [playing, index, frames.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!frames.length) return null;
  return (
    <div className="timeline">
      <IconButton
        label={t('tl.prev')}
        disabled={index <= 0 && index !== -1}
        onClick={() => go(index < 0 ? frames.length - 2 : index - 1)}
      >
        <SkipBack size={14} />
      </IconButton>
      <IconButton
        label={playing ? t('tl.pause') : t('tl.play')}
        on={playing}
        onClick={() => {
          if (index < 0 || index >= frames.length - 1) go(0);
          setPlaying((p) => !p);
        }}
      >
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </IconButton>
      <IconButton
        label={t('tl.next')}
        disabled={index >= frames.length - 1}
        onClick={() => go(index + 1)}
      >
        <SkipForward size={14} />
      </IconButton>
      <div className="track grow">
        {frames.map((f, i) => (
          <button
            key={f.entry.id}
            title={`${f.entry.nodeName} · ${f.entry.platform}`}
            className={`tick ${outcomeOf(f.entry)} ${i === index ? 'cur' : ''}`}
            onClick={() => go(i)}
          />
        ))}
      </div>
      <span className="note" style={{ width: 52, textAlign: 'right' }}>
        {index < 0 ? t('tl.live') : `${index + 1}/${frames.length}`}
      </span>
    </div>
  );
}
