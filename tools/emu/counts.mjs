#!/usr/bin/env node
// Per-frame count of differing video and RAM bytes between the original and the engine (dev aid).
//   node tools/emu/counts.mjs from to [script]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Host } from './host.mjs';
import { Machine } from '../../src/game/machine.js';
import { inputs, stepBoth } from './diff.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tables = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tables.json'), 'utf8'));
const [from, to, kind] = process.argv.slice(2);
const h = new Host().boot(), g = new Machine(tables);
const inp = inputs(kind || 'attract');
for (let f = 0; f < Number(to); f++) {
  const gm = stepBoth(h, g, inp(f));
  if (f < Number(from)) continue;
  let v = 0, first = -1; for (let a = 0x2400; a < 0x4000; a++) if (h.mem[a] !== gm[a]) { v++; if (first < 0) first = a; }
  const r = []; for (let a = 0x2000; a < 0x2400; a++) if (h.mem[a] !== gm[a]) r.push(a.toString(16));
  console.log(f, 'vram', v, first >= 0 ? first.toString(16) : '', 'ram', r.slice(0, 12).join(' '), 'pc', h.cpu.pc.toString(16));
}
