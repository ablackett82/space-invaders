#!/usr/bin/env node
// Runs the engine and the original program side by side with the same
// inputs and reports the first frame where video RAM or work RAM differ.
//   node tools/emu/diff.mjs [frames] [script]
// script: attract (no input), play (tools/shot.mjs's coin/start/sweep), or
// a seed number for random play after the coin and start.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Host } from './host.mjs';
import { Machine } from '../../src/game/machine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tables = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tables.json'), 'utf8'));

// RAM the engine keeps differently or that is timing noise: the stack, and
// $2000-$20FF bytes only the main loop's speed changes
const IGNORE = new Set([0x2099]); // extra-ship sound timer: counted per main-loop pass

/**
 * Advance both machines a frame with the same inputs. Returns the engine's
 * memory as it was just after its vblank handler, which is where the host
 * stops (see Host.frame).
 */
const snapBuf = new Uint8Array(0x4000);
export function stepBoth(h, g, i) {
  // player 2's controls (port 2) mirror player 1's, for two-player games
  const in2 = i & 0x70;
  h.frame(i, in2);
  g.frame(i, in2, (tag) => { if (tag === 'vbl') snapBuf.set(g.m.subarray(0x2000, 0x4000), 0x2000); });
  return snapBuf;
}

export function inputs(kind) {
  if (kind === 'attract') return () => 0;
  if (kind === 'play') {
    return (f) => {
      let in1 = 0;
      if (f >= 60 && f < 64) in1 |= 0x01;
      if (f >= 120 && f < 130) in1 |= 0x04;
      if (f >= 200) {
        if ((f >> 3) & 1) in1 |= 0x10;
        in1 |= ((f >> 7) & 1) ? 0x20 : 0x40;
      }
      return in1;
    };
  }
  // "2p:<seed>": two coins and the two-player start button, then random play
  const two = String(kind).startsWith('2p:');
  let s = Number(two ? kind.slice(3) : kind) >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s; };
  let hold = 0, cur = 0;
  return (f) => {
    if (f >= 60 && f < 64) return 0x01;
    if (two && f >= 90 && f < 94) return 0x01;
    if (f >= 120 && f < 130) return two ? 0x02 : 0x04;
    if (f < 200) return 0;
    if (!hold--) { hold = rnd() % 40; cur = [0, 0x20, 0x40][rnd() % 3] | (rnd() & 1 ? 0x10 : 0); }
    return cur;
  };
}

/**
 * The original's main thread takes real time to draw (a screenful of text can
 * spill into the next frame) where the engine's is instant, so a difference
 * only counts once it has lasted `patience` frames in a row.
 */
export function compare(frames, kind, { verbose = false, patience = 16 } = {}) {
  const h = new Host().boot(), g = new Machine(tables);
  const inp = inputs(kind);
  let run = 0;
  for (let f = 0; f < frames; f++) {
    const gm = stepBoth(h, g, inp(f));
    let vram = 0, firstV = -1;
    for (let a = 0x2400; a < 0x4000; a++) if (h.mem[a] !== gm[a]) { vram++; if (firstV < 0) firstV = a; }
    const ram = [];
    for (let a = 0x2000; a < 0x2300; a++) if (!IGNORE.has(a) && h.mem[a] !== gm[a]) ram.push(a);
    run = vram || ram.length ? run + 1 : 0;
    if (run >= patience) {
      if (verbose) {
        console.log(`frame ${f} (for ${run} frames): ${vram} video bytes differ${firstV >= 0 ? ` (first $${firstV.toString(16)})` : ''}; RAM: ${ram.slice(0, 16).map((a) => `$${a.toString(16)} ref ${h.mem[a].toString(16)} eng ${gm[a].toString(16)}`).join(', ')}`);
      }
      return { frame: f, vram, ram, h, g };
    }
  }
  return null;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const frames = Number(process.argv[2] || 3000);
  const kind = process.argv[3] || 'attract';
  const r = compare(frames, kind, { verbose: true });
  if (!r) console.log(`no differences in ${frames} frames (${kind})`);
}
