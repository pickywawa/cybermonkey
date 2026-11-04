import sharp from 'sharp';

export const GRID_CELL_PT = 32;
const letters = (n: number): string =>
  (n >= 26 ? letters(Math.floor(n / 26) - 1) : '') + String.fromCharCode(65 + (n % 26));

/**
 * Screenshot with a labeled grid ("set of marks"): a model that can see the image designates a target by cell
 * (e.g. "C7") instead of inventing pixel coordinates. Cells are in device points, so they map 1:1 to taps.
 */
export async function annotateGrid(
  dataUrl: string,
  screen: { width: number; height: number },
  cell = GRID_CELL_PT,
) {
  const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  const meta = await sharp(png).metadata();
  const w = meta.width ?? screen.width,
    h = meta.height ?? screen.height;
  const k = w / screen.width;
  const cols = Math.ceil(screen.width / cell),
    rows = Math.ceil(screen.height / cell);
  const font = Math.max(10, Math.round(cell * k * 0.26));
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`;
  for (let c = 0; c <= cols; c++)
    svg += `<line x1="${c * cell * k}" y1="0" x2="${c * cell * k}" y2="${h}" stroke="#ff2d95" stroke-opacity=".45" stroke-width="1"/>`;
  for (let r = 0; r <= rows; r++)
    svg += `<line x1="0" y1="${r * cell * k}" x2="${w}" y2="${r * cell * k}" stroke="#ff2d95" stroke-opacity=".45" stroke-width="1"/>`;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      svg += `<text x="${c * cell * k + 3}" y="${r * cell * k + font + 1}" font-family="Helvetica,Arial,sans-serif" font-size="${font}" font-weight="700" fill="#ff2d95" stroke="#fff" stroke-width="2.5" paint-order="stroke">${letters(c)}${r + 1}</text>`;
  svg += '</svg>';
  // Rasterize the overlay at the exact screenshot size, composite first, then shrink (sharp resizes before compositing).
  const overlay = await sharp(Buffer.from(svg), { density: 72 })
    .resize(w, h, { fit: 'fill' })
    .png()
    .toBuffer();
  const merged = await sharp(png)
    .composite([{ input: overlay }])
    .png()
    .toBuffer();
  const image = await sharp(merged)
    .resize({ width: Math.min(w, 900) })
    .png()
    .toBuffer();
  return { data: image.toString('base64'), mime: 'image/png' as const, cols, rows, cell };
}

/** Center of a grid cell as fractions of the screen, or undefined when the label is malformed / outside the screen. */
export function cellToPoint(
  label: string,
  screen: { width: number; height: number },
  cell = GRID_CELL_PT,
) {
  const m = /^([A-Z]+)(\d+)$/.exec(label.trim().toUpperCase());
  if (!m) return undefined;
  const col = [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const row = Number(m[2]) - 1;
  const x = (col + 0.5) * cell,
    y = (row + 0.5) * cell;
  if (col < 0 || row < 0 || x > screen.width || y > screen.height) return undefined;
  return { x: Math.min(1, x / screen.width), y: Math.min(1, y / screen.height) };
}
