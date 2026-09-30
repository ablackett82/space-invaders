#!/usr/bin/env node
// Prints chosen RAM bytes from the original (left) and the engine (right)
// frame by frame, to chase a difference found by diff.mjs.
//   node tools/emu/trace.mjs from to script addr...   (addresses in hex)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Host } from './host.mjs';
import { Machine } from '../../src/game/machine.js';
import { inputs, stepBoth } from './diff.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tables = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tables.json'), 'utf8'));
const [from, to, kind, ...rest] = process.argv.slice(2);
const addrs = rest.map((a) => parseInt(a, 16));
const h = new Host().boot(), g = new Machine(tables);
const inp = inputs(kind || 'attract');
const hex = (v) => v.toString(16).padStart(2, '0');
for (let f = 0; f < Number(to); f++) {
  const gm = stepBoth(h, g, inp(f));
  if (f < Number(from)) continue;
  const cells = addrs.map((a) => `${a.toString(16)}:${hex(h.mem[a])}/${hex(gm[a])}${h.mem[a] !== gm[a] ? '*' : ' '}`);
  console.log(String(f).padStart(5), cells.join(' '), ' pc', h.cpu.pc.toString(16));
}
