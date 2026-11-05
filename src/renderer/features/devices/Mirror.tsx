import { useEffect, useRef, useState } from 'react';
import type { Component, Screen } from '../../../shared/domain/devices';
import { call, onEvent } from '../../shared/api';
import { useT } from '../../shared/i18n';
import { Spinner } from '../../shared/ui/controls';

export type Gesture =
  | { kind: 'tap'; x: number; y: number }
  | { kind: 'swipe'; direction: 'up' | 'down' | 'left' | 'right' }
  | { kind: 'back' };

/** Live phone screenshot with an optional component overlay and the tap pointer the engine reports. */
export function Mirror({
  deviceId,
  live,
  busy,
  image,
  screen,
  selectedId,
  onSelect,
  onError,
  onReady,
  control,
}: {
  deviceId: string;
  live: boolean;
  /** A run or an AI exploration drives the device: poll less so mirroring never competes with it. */
  busy?: boolean;
  image?: string | null;
  screen?: Screen | null;
  selectedId?: string;
  onSelect?: (c: Component) => void;
  onError?: (e: unknown) => void;
  onReady?: (ok: boolean) => void;
  /** When set, the mirror is a remote control: a click taps, a drag swipes, a right click goes back. Resolves once the phone has acted. */
  control?: (gesture: Gesture) => Promise<void>;
}) {
  const [shot, setShot] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const [hover, setHover] = useState<string | null>(null);
  const failures = useRef(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [acting, setActing] = useState(false);
  const [slow, setSlow] = useState(false);
  const t = useT();
  // A gesture that takes long is almost always the first one: the phone session is still opening.
  useEffect(() => {
    if (!acting) return setSlow(false);
    const timer = setTimeout(() => setSlow(true), 700);
    return () => clearTimeout(timer);
  }, [acting]);

  useEffect(() => {
    if (!live || image) return;
    let stop = false,
      timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const next = await call('devices.screenshot', deviceId);
        if (stop) return;
        failures.current = 0;
        setShot(next);
        onReady?.(true);
      } catch (error) {
        failures.current++;
        if (failures.current === 3) {
          onReady?.(false);
          onError?.(error);
        }
      }
      if (!stop)
        timer = setTimeout(tick, Math.min(8000, (busy ? 3500 : 1400) + failures.current * 1200));
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [deviceId, live, image, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () =>
      onEvent((e) => {
        if (e.type !== 'pointer' || e.deviceId !== deviceId) return;
        setPointer({ x: e.x, y: e.y, w: e.width, h: e.height });
        setTimeout(() => setPointer(null), 1400);
      }),
    [deviceId],
  );

  const fraction = (e: React.PointerEvent<HTMLElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)),
      y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)),
    };
  };
  const release = async (e: React.PointerEvent<HTMLElement>) => {
    const from = start.current;
    start.current = null;
    if (!from || !control || acting) return;
    const to = fraction(e);
    const dx = to.x - from.x,
      dy = to.y - from.y;
    const gesture: Gesture =
      Math.hypot(dx, dy) < 0.03
        ? { kind: 'tap', x: from.x, y: from.y }
        : {
            kind: 'swipe',
            direction:
              Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up',
          };
    void perform(gesture);
  };
  const perform = async (gesture: Gesture) => {
    if (!control || acting) return;
    setActing(true);
    try {
      await control(gesture);
      setShot(await call('devices.screenshot', deviceId));
    } catch (error) {
      onError?.(error);
    } finally {
      setActing(false);
    }
  };

  const src = image ?? shot;
  if (!src) return <div className="mirror-empty muted">…</div>;
  return (
    <div className={`mirror ${control && !image ? 'control' : ''} ${acting ? 'acting' : ''}`}>
      <img src={src} alt="" draggable={false} />
      {acting && slow && (
        <div className="mirror-busy">
          <Spinner size={18} />
          <span>{t('dev.connecting')}</span>
        </div>
      )}
      {control && !image && (
        <div
          className="control-layer"
          onContextMenu={(e) => {
            e.preventDefault();
            void perform({ kind: 'back' });
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            start.current = fraction(e);
          }}
          onPointerUp={(e) => void release(e)}
          onPointerCancel={() => (start.current = null)}
        />
      )}
      {screen && !image && !control && (
        <div className="overlay">
          {screen.components
            .filter((c) => c.locator)
            .map((c) => (
              <button
                key={c.id + c.rect.x + c.rect.y}
                className={`box ${selectedId === c.id ? 'sel' : ''} ${hover === c.id ? 'hov' : ''}`}
                title={c.label || c.text || c.type}
                style={{
                  left: `${(c.rect.x / screen.width) * 100}%`,
                  top: `${(c.rect.y / screen.height) * 100}%`,
                  width: `${(c.rect.width / screen.width) * 100}%`,
                  height: `${(c.rect.height / screen.height) * 100}%`,
                }}
                onMouseEnter={() => setHover(c.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelect?.(c)}
              />
            ))}
        </div>
      )}
      {pointer && (
        <span
          className="pointer"
          style={{
            left: `${(pointer.x / pointer.w) * 100}%`,
            top: `${(pointer.y / pointer.h) * 100}%`,
          }}
        />
      )}
    </div>
  );
}
