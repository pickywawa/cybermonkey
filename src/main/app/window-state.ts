import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface WindowState {
  bounds: Bounds;
  maximized: boolean;
}
export function restoreWindowState(
  file: string,
  key: string,
  areas: Bounds[],
  defaults: { width: number; height: number; minWidth: number; minHeight: number },
): { bounds: Partial<Bounds>; maximized: boolean } {
  try {
    const state = JSON.parse(readFileSync(file, 'utf8'))[key] as WindowState;
    const b = state.bounds;
    if (
      !b ||
      ![b.x, b.y, b.width, b.height].every(Number.isFinite) ||
      b.width <= 0 ||
      b.height <= 0
    )
      throw new Error('Invalid bounds');
    const area =
      areas.find(
        (a) =>
          b.x + b.width > a.x + 80 &&
          b.x < a.x + a.width - 80 &&
          b.y + b.height > a.y + 40 &&
          b.y < a.y + a.height - 40,
      ) ?? areas[0];
    if (!area) throw new Error('No display');
    const width = Math.min(area.width, Math.max(defaults.minWidth, Math.round(b.width)));
    const height = Math.min(area.height, Math.max(defaults.minHeight, Math.round(b.height)));
    return {
      bounds: {
        width,
        height,
        x: Math.max(area.x, Math.min(Math.round(b.x), area.x + area.width - width)),
        y: Math.max(area.y, Math.min(Math.round(b.y), area.y + area.height - height)),
      },
      maximized: state.maximized === true,
    };
  } catch {
    return { bounds: { width: defaults.width, height: defaults.height }, maximized: false };
  }
}
export function saveWindowState(file: string, key: string, state: WindowState) {
  let states: Record<string, WindowState> = {};
  try {
    states = JSON.parse(readFileSync(file, 'utf8'));
  } catch {}
  states[key] = state;
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp';
  writeFileSync(temporary, JSON.stringify(states));
  renameSync(temporary, file);
}
