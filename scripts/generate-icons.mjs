import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const svg = await readFile(new URL('../public/cybermonkey.svg', import.meta.url));
await mkdir(new URL('../build/', import.meta.url), { recursive: true });
const blocks = [];
for (const [type, size] of [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
]) {
  const png = await sharp(svg).resize(size, size).png().toBuffer();
  if (size === 1024) await writeFile(new URL('../build/icon.png', import.meta.url), png);
  const header = Buffer.alloc(8);
  header.write(type);
  header.writeUInt32BE(png.length + 8, 4);
  blocks.push(header, png);
}
const header = Buffer.alloc(8);
header.write('icns');
header.writeUInt32BE(8 + blocks.reduce((n, block) => n + block.length, 0), 4);
await writeFile(new URL('../build/icon.icns', import.meta.url), Buffer.concat([header, ...blocks]));
console.log('Generated Cybermonkey PNG and macOS ICNS icons');
