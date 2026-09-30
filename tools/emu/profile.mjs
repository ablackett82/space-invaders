#!/usr/bin/env node
// Measures main-thread cycles (interrupt time excluded) spent in routines of
// the original, by entry address, or between successive passes of a loop
// address (prefix it with L) (dev aid for the time costs in src/game/flow.js).
//   node tools/emu/profile.mjs frames script addr... Laddr...
import { Host } from './host.mjs';
import { inputs } from './diff.mjs';
const [frames, kind, ...list] = process.argv.slice(2);
const addrs = list.filter((a) => a[0] !== 'L').map((a) => parseInt(a, 16));
const loops = list.filter((a) => a[0] === 'L').map((a) => parseInt(a.slice(1), 16));
const h = new Host().boot(), cpu = h.cpu, inp = inputs(kind || 'play');
let inIsr = false, main = 0;
const oi = cpu.interrupt.bind(cpu);
cpu.interrupt = (r) => { const ok = oi(r); if (ok) inIsr = true; return ok; };
const open = [];   // {addr, sp, t}
const stats = new Map(); const last = new Map();
const os = cpu.step.bind(cpu);
cpu.step = () => {
  const pc = cpu.pc;
  if (!inIsr && addrs.includes(pc) && open.length < 64) open.push({ addr: pc, sp: cpu.sp, t: main });
  if (!inIsr && loops.includes(pc)) {
    if (last.has(pc)) { const s = stats.get('loop ' + pc.toString(16)) || []; s.push(main - last.get(pc)); stats.set('loop ' + pc.toString(16), s); }
    last.set(pc, main);
  }
  const c = os();
  if (inIsr) { if (pc === 0x0087) inIsr = false; } else main += c;
  if (!inIsr) for (let i = open.length - 1; i >= 0; i--) if (cpu.sp > open[i].sp) { const o = open.splice(i, 1)[0]; const k = o.addr.toString(16); const s = stats.get(k) || []; s.push(main - o.t); stats.set(k, s); }
  return c;
};
for (let f = 0; f < Number(frames); f++) h.frame(inp(f));
for (const [k, s] of stats) console.log(k.padEnd(10), 'n', String(s.length).padStart(6), 'avg', Math.round(s.reduce((a, b) => a + b, 0) / s.length), 'min', Math.min(...s), 'max', Math.max(...s));
