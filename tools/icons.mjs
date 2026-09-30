#!/usr/bin/env node
// Renders the home-screen icons: icons/icon-180.png (iOS), icon-192.png,
// icon-512.png. A crab invader (the 20-point alien, from the game's sprite
// table) in white above the player's cannon in green, on black, with big
// square pixels. Everything sits inside the middle 80% so the maskable crop
// is safe.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Raster } from './png.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tables = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tables.json'), 'utf8'));
const mem = new Uint8Array(0x2000);
for (const [a, hex] of tables.runs) for (let i = 0; i < hex.length; i += 2) mem[a + i / 2] = parseInt(hex.slice(i, i + 2), 16);

/** A sprite as rows of 0/1, top first: each byte is a column, bit 7 at the top. */
function sprite(addr, cols) {
  const rows = [];
  for (let r = 0; r < 8; r++) rows.push(Array.from({ length: cols }, (_, c) => (mem[addr + c] >> (7 - r)) & 1));
  // trim empty columns either side
  let l = 0, rr = cols - 1;
  while (l < cols && rows.every((row) => !row[l])) l++;
  while (rr > l && rows.every((row) => !row[rr])) rr--;
  return rows.map((row) => row.slice(l, rr + 1));
}

const crab = sprite(0x1c10, 16);   // alien type B, first frame
const cannon = sprite(0x1c60, 16); // the player
const WHITE = [255, 255, 255], GREEN = [40, 255, 60], BLACK = [0, 0, 0];

function icon(size) {
  const r = new Raster(size, size);
  r.fill(0, 0, size, size, BLACK);
  const cell = Math.floor(size * 0.62 / crab[0].length);
  const place = (spr, top, colour, scale) => {
    const w = spr[0].length * scale;
    const left = Math.round((size - w) / 2);
    spr.forEach((row, y) => row.forEach((on, x) => { if (on) r.fill(left + x * scale, top + y * scale, scale, scale, colour); }));
  };
  place(crab, Math.round(size * 0.2), WHITE, cell);
  const small = Math.max(1, Math.round(cell * 0.5));
  place(cannon, Math.round(size * 0.68), GREEN, small);
  return r.encode(1);
}

fs.mkdirSync(path.join(ROOT, 'icons'), { recursive: true });
for (const size of [180, 192, 512]) fs.writeFileSync(path.join(ROOT, `icons/icon-${size}.png`), icon(size));
console.log('wrote icons/icon-{180,192,512}.png');
