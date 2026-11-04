import sharp from 'sharp';

export interface VisualDiff {
  comparable: boolean;
  /** Share of the screen (0-100) that looks different, ignoring the status bar and anti-aliasing. */
  changedPercent: number;
  /** Changed areas, normalized to the screen (0..1), biggest first. */
  regions: { x: number; y: number; w: number; h: number; share: number }[];
  /** The failing capture with the changed areas outlined (JPEG data URL). */
  diff?: string;
  reason?: string;
}

const WIDTH = 360;
const GRID_X = 12;
const GRID_Y = 24;
/** Top of the screen holds the clock and signal: always different, never meaningful. */
const IGNORED_TOP = 0.045;
const PIXEL_THRESHOLD = 60; // sum of |ΔR|+|ΔG|+|ΔB| out of 765
const CELL_THRESHOLD = 0.12;

const raw = (data: Buffer, width: number, height?: number) =>
  sharp(data)
    .resize(height ? { width, height, fit: 'fill' } : { width })
    .removeAlpha()
    .blur(1.2)
    .raw()
    .toBuffer({ resolveWithObject: true });

const decode = (url: string) => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');

/** Where, in words: "middle-left", "bottom-center"… */
export function describeRegion(r: { x: number; y: number; w: number; h: number }): string {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const v = cy < 0.33 ? 'top' : cy < 0.66 ? 'middle' : 'bottom';
  const h = cx < 0.33 ? 'left' : cx < 0.66 ? 'center' : 'right';
  return `${v}-${h}`;
}

/** Compares two captures of the same step (data URLs) and outlines what changed on the second one. */
export async function compareImages(baselineUrl: string, currentUrl: string): Promise<VisualDiff> {
  const current = await raw(decode(currentUrl), WIDTH);
  const { width, height } = current.info;
  const meta = await sharp(decode(baselineUrl)).metadata();
  const aspect = (meta.width ?? 1) / (meta.height ?? 1);
  if (Math.abs(aspect / (width / height) - 1) > 0.06)
    return {
      comparable: false,
      changedPercent: 0,
      regions: [],
      reason: 'The two captures do not have the same shape (another device or orientation).',
    };
  const base = await raw(decode(baselineUrl), width, height);
  const changed = new Uint8Array(width * height);
  const top = Math.floor(height * IGNORED_TOP);
  let count = 0;
  for (let y = top; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const d =
        Math.abs(current.data[i] - base.data[i]) +
        Math.abs(current.data[i + 1] - base.data[i + 1]) +
        Math.abs(current.data[i + 2] - base.data[i + 2]);
      if (d > PIXEL_THRESHOLD) {
        changed[y * width + x] = 1;
        count++;
      }
    }
  // Cells where enough pixels changed, grouped into connected regions.
  const cw = width / GRID_X;
  const ch = height / GRID_Y;
  const cells = new Uint8Array(GRID_X * GRID_Y);
  for (let gy = 0; gy < GRID_Y; gy++)
    for (let gx = 0; gx < GRID_X; gx++) {
      let n = 0;
      let total = 0;
      for (let y = Math.floor(gy * ch); y < Math.floor((gy + 1) * ch); y++)
        for (let x = Math.floor(gx * cw); x < Math.floor((gx + 1) * cw); x++) {
          total++;
          n += changed[y * width + x];
        }
      if (total && n / total >= CELL_THRESHOLD) cells[gy * GRID_X + gx] = 1;
    }
  const seen = new Uint8Array(cells.length);
  const regions: VisualDiff['regions'] = [];
  for (let start = 0; start < cells.length; start++) {
    if (!cells[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let minX = GRID_X,
      minY = GRID_Y,
      maxX = 0,
      maxY = 0,
      size = 0;
    while (stack.length) {
      const c = stack.pop()!;
      const gx = c % GRID_X;
      const gy = Math.floor(c / GRID_X);
      size++;
      minX = Math.min(minX, gx);
      maxX = Math.max(maxX, gx);
      minY = Math.min(minY, gy);
      maxY = Math.max(maxY, gy);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = gx + dx;
        const ny = gy + dy;
        const n = ny * GRID_X + nx;
        if (nx >= 0 && nx < GRID_X && ny >= 0 && ny < GRID_Y && cells[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    regions.push({
      x: minX / GRID_X,
      y: minY / GRID_Y,
      w: (maxX - minX + 1) / GRID_X,
      h: (maxY - minY + 1) / GRID_Y,
      share: +(size / (GRID_X * GRID_Y)).toFixed(3),
    });
  }
  regions.sort((a, b) => b.share - a.share);
  const changedPercent = +((count / (width * (height - top))) * 100).toFixed(1);
  let diff: string | undefined;
  if (regions.length) {
    const full = await sharp(decode(currentUrl)).metadata();
    const W = full.width ?? width;
    const H = full.height ?? height;
    const stroke = Math.max(4, Math.round(W / 90));
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
      regions
        .map(
          (r) =>
            `<rect x="${Math.round(r.x * W)}" y="${Math.round(r.y * H)}" width="${Math.round(r.w * W)}" height="${Math.round(r.h * H)}" fill="rgba(255,40,40,0.16)" stroke="rgb(255,40,40)" stroke-width="${stroke}"/>`,
        )
        .join('') +
      '</svg>';
    const out = await sharp(decode(currentUrl))
      .composite([{ input: Buffer.from(svg) }])
      .jpeg({ quality: 78 })
      .toBuffer();
    diff = 'data:image/jpeg;base64,' + out.toString('base64');
  }
  return { comparable: true, changedPercent, regions, diff };
}
