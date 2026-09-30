#!/usr/bin/env node
// Writes data/tables.json: the program's data tables (sprites, font,
// messages, the RAM initialisation image, the firing-column and score
// tables, the demo's moves) at their ROM addresses, as hex runs. The engine
// loads these into its address space so it can follow the original's
// pointers unchanged. No code is included.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rom = fs.readFileSync(path.join(ROOT, 'reference', 'program.bin'));

// [start, end) of every data area in the program
const RUNS = [
  [0x0bf7, 0x0c00], // "TAITO COP" (the hidden message)
  [0x19be, 0x19d1], // "*TAITO CORPORATION*"
  [0x1a11, 0x1a32], // fleet sound: alien counts and delays
  [0x1a95, 0x2000], // everything from the first splash animation to the end
];

const tables = {
  source: 'Space Invaders (Midway, 1978) program data tables; see tools/extract.mjs',
  runs: RUNS.map(([a, b]) => [a, Buffer.from(rom.subarray(a, b)).toString('hex')]),
  // The saucer's direction comes from bit 0 of the byte the shot counter
  // points at, which is the program itself at $0800-$08FF (see endOfBlowup
  // in src/game/isr.js). Only those 256 bits are kept.
  saucerBits: Array.from(rom.subarray(0x0800, 0x0900), (v) => v & 1).join(''),
};
fs.writeFileSync(path.join(ROOT, 'data', 'tables.json'), JSON.stringify(tables) + '\n');
console.log(`wrote data/tables.json (${RUNS.reduce((n, [a, b]) => n + b - a, 0)} bytes of tables)`);
