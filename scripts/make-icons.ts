/** Writes the PNG icons the manifest and iOS need (spec 3 §9): a pull-up bar on a dark square.
 *  No image library: a PNG is a zlib stream of filtered scanlines plus four chunks. */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x11, 0x18, 0x27];
const BAR = [0xf5, 0x9e, 0x0b];
const POST = [0xe5, 0xe7, 0xeb];

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) crc = (CRC_TABLE[(crc ^ b) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function pixel(x: number, y: number, size: number): number[] {
  const u = x / size;
  const v = y / size;
  const inBar = v >= 0.28 && v < 0.375 && u >= 0.16 && u < 0.84;
  const inPost = v >= 0.28 && v < 0.75 && ((u >= 0.22 && u < 0.31) || (u >= 0.69 && u < 0.78));
  const corner = Math.min(u, 1 - u, v, 1 - v) < 0.19 && (() => {
    const cx = u < 0.5 ? 0.19 : 0.81;
    const cy = v < 0.5 ? 0.19 : 0.81;
    return Math.min(u, 1 - u) < 0.19 && Math.min(v, 1 - v) < 0.19 && Math.hypot(u - cx, v - cy) > 0.19;
  })();
  if (corner) return [0, 0, 0, 0];
  if (inBar) return [...BAR, 255];
  if (inPost) return [...POST, 255];
  return [...BG, 255];
}

function png(size: number): Uint8Array {
  const raw = new Uint8Array(size * (1 + size * 4));
  for (let y = 0; y < size; y += 1) {
    raw[y * (1 + size * 4)] = 0;
    for (let x = 0; x < size; x += 1) raw.set(pixel(x, y, size), y * (1 + size * 4) + 1 + x * 4);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, size);
  v.setUint32(4, size);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

for (const [name, size] of [['public/icon-192.png', 192], ['public/icon-512.png', 512], ['public/apple-touch-icon.png', 180]] as const) {
  writeFileSync(name, png(size));
  console.log(`wrote ${name}`);
}
