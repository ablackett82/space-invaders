#!/usr/bin/env node
// Renders a frame to PNG, from the engine (default) or the original program
// in the reference emulator (--ref), after running it for a number of frames
// with an optional scripted input: coin in, then 1P start, then the fire
// button tapped and the cannon swept left and right.
//   node tools/shot.mjs out.png 900 [--ref] [--play]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Raster } from './png.js';
import { Screen, SCREEN_W, SCREEN_H } from '../src/render/screen.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const out = args[0] || 'shot.png';
const frames = Number(args[1] || 600);
const ref = args.includes('--ref');
const play = args.includes('--play');

/** Scripted inputs for frame f: port 1 bits (coin 0x01, 1P start 0x04, fire 0x10, left 0x20, right 0x40). */
export function script(f) {
  let in1 = 0;
  if (f >= 60 && f < 64) in1 |= 0x01;
  if (f >= 120 && f < 130) in1 |= 0x04;
  if (f >= 200) {
    if ((f >> 3) & 1) in1 |= 0x10;
    in1 |= ((f >> 7) & 1) ? 0x20 : 0x40;
  }
  return in1;
}

let m, step;
if (ref) {
  const { Host } = await import('./emu/host.mjs');
  const h = new Host();
  m = h.mem;
  step = (f) => h.frame(play ? script(f) : 0);
} else {
  const { Machine } = await import('../src/game/machine.js');
  const tables = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tables.json'), 'utf8'));
  const g = new Machine(tables);
  m = g.m;
  step = (f) => g.frame(play ? script(f) : 0);
}
for (let f = 0; f < frames; f++) step(f);
const r = new Raster(SCREEN_W, SCREEN_H).fromRGBA(new Screen().draw(m));
fs.writeFileSync(out, r.encode(2));
console.log(`wrote ${out}`);
