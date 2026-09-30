// Measures how many cycles each interrupt handler takes in the original (dev aid).
import { Host } from './host.mjs';
import { inputs } from './diff.mjs';
const h = new Host().boot();
const inp = inputs(process.argv[3] || 'play');
const cpu = h.cpu;
const stats = { mid: [], vbl: [] };
const origInt = cpu.interrupt.bind(cpu);
let cur = null, t0 = 0;
cpu.interrupt = (rst) => { const ok = origInt(rst); if (ok) { cur = rst === 0xcf ? 'mid' : 'vbl'; t0 = cpu.cycles; } return ok; };
const origStep = cpu.step.bind(cpu);
cpu.step = () => { const pc = cpu.pc; const c = origStep(); if (cur && (pc === 0x0087 || pc === 0x0086)) { if (pc === 0x0087) { stats[cur].push(cpu.cycles - t0); cur = null; } } return c; };
const N = Number(process.argv[2] || 3000);
for (let f = 0; f < N; f++) h.frame(inp(f));
for (const k of ['mid', 'vbl']) {
  const a = stats[k].slice(-2000); const avg = a.reduce((s, v) => s + v, 0) / a.length;
  console.log(k, 'n', a.length, 'avg', Math.round(avg), 'max', Math.max(...a), 'min', Math.min(...a));
}

// the engine's own estimate, for comparison
import fs from 'node:fs';
import { Machine } from '../../src/game/machine.js';
const tables = JSON.parse(fs.readFileSync(new URL('../../data/tables.json', import.meta.url), 'utf8'));
const g = new Machine(tables);
const eng = { mid: [], vbl: [] };
for (let f = 0; f < N; f++) g.frame(inp(f), g.in2, (tag) => { if (tag === 'mid' || tag === 'vbl') eng[tag].push(g.isrT); });
for (const k of ['mid', 'vbl']) {
  const a = eng[k].slice(-2000); const avg = a.reduce((s, v) => s + v, 0) / a.length;
  console.log('engine', k, 'avg', Math.round(avg), 'max', Math.max(...a), 'min', Math.min(...a));
}
