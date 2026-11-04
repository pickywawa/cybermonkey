import { useRef, useState, type HTMLAttributes } from 'react';
import type { Settings } from '../../shared/domain/settings';
import { useActions, useApp } from './store';

/** Drag handle resizing a persisted dimension (sidebar width, device panel width, chat height). */
export function useSplitter(
  key: 'leftWidth' | 'rightWidth' | 'chatHeight',
  direction: 1 | -1,
  min: number,
  max: number,
  axis: 'x' | 'y' = 'x',
) {
  const { settings } = useApp();
  const actions = useActions();
  const [size, setSize] = useState<number | null>(null);
  const latest = useRef(0);
  const onPointerDown = (event: React.PointerEvent) => {
    event.preventDefault();
    const origin = axis === 'x' ? event.clientX : event.clientY;
    const initial = settings![key];
    const move = (e: PointerEvent) => {
      latest.current = Math.round(
        Math.max(
          min,
          Math.min(max, initial + ((axis === 'x' ? e.clientX : e.clientY) - origin) * direction),
        ),
      );
      setSize(latest.current);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (latest.current)
        void actions
          .saveSettings({ [key]: latest.current } as Partial<Settings>)
          .finally(() => setSize(null));
      else setSize(null);
      latest.current = 0;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const props: HTMLAttributes<HTMLDivElement> = {
    className: `splitter ${axis === 'y' ? 'h' : ''} ${size !== null ? 'drag' : ''}`,
    onPointerDown,
    role: 'separator',
  };
  return { props, size };
}
