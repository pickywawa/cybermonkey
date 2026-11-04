import { useEffect, useRef, useState } from 'react';
import type { Component, Screen } from '../../../shared/domain/devices';
import { call, onEvent } from '../../shared/api';

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
}) {
  const [shot, setShot] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const [hover, setHover] = useState<string | null>(null);
  const failures = useRef(0);

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

  const src = image ?? shot;
  if (!src) return <div className="mirror-empty muted">…</div>;
  return (
    <div className="mirror">
      <img src={src} alt="" draggable={false} />
      {screen && !image && (
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
