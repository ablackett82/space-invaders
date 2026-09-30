#!/usr/bin/env node
// Like trace.mjs but samples after each interrupt handler and main slice (dev aid).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Host, T_FRAME } from './host.mjs';
import { Machine } from '../../src/game/machine.js';
import { inputs } from './diff.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tables = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tables.json'), 'utf8'));
const [from, to, kind, ...rest] = process.argv.slice(2);
const addrs = rest.map((a) => parseInt(a, 16));
const h = new Host().boot(), g = new Machine(tables);
const inp = inputs(kind || 'attract');
const hex = (v) => v.toString(16).padStart(2, '0');
for (let f = 0; f < Number(to); f++) {
  const i = inp(f);
  // the host, stopped after each interrupt handler returns and at the end of each main slice
  const snaps = [];
  h.in1 = i | 8;
  const t0 = h.t0 + h.frameNo * T_FRAME;
  const tm = t0 + Math.round(T_FRAME * 96 / 262), tv = t0 + Math.round(T_FRAME * 224 / 262);
  const isr = (rst) => { if (h.cpu.interrupt(rst)) h.finishIsr(); };
  h.runUntil(tm); snaps.push(h.mem.slice(0x2000, 0x2400));
  isr(0xcf); snaps.push(h.mem.slice(0x2000, 0x2400));
  h.runUntil(tv); snaps.push(h.mem.slice(0x2000, 0x2400));
  isr(0xd7); snaps.push(h.mem.slice(0x2000, 0x2400));
  h.frameNo++;
  let k = 0;
  g.frame(i, g.in2, (tag) => {
    const hm = snaps[k++];
    if (f >= Number(from)) console.log(String(f).padStart(5), tag.padEnd(5), addrs.map((a) => `${a.toString(16)}:${hex(hm[a - 0x2000])}/${hex(g.m[a])}${hm[a - 0x2000] !== g.m[a] ? '*' : ' '}`).join(' '));
  });
}
