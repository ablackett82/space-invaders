#!/usr/bin/env node
// Rebuilds the 8K arcade program from the byte column of Christopher
// Cantrell's commented listing (reference/Code.md, from
// https://github.com/topherCantrell/computerarcheology, content/Arcade/SpaceInvaders/Code.md)
// and checks each 2K chip against MAME's checksums. The result,
// reference/program.bin, is only used by the development tools: the tables
// extractor and the reference emulator the engine is compared against. It is
// gitignored and never shipped.
//
// The listing also prints the Taito diagnostics routine that the Midway
// program dropped, at $1000-$13FF; the real chips have zeros there.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'reference', 'Code.md');
const OUT = path.join(ROOT, 'reference', 'program.bin');
const CHIPS = [
  ['invaders.h', 0x0000, 'e87815985f5208bfa25d567c3fb52418'],
  ['invaders.g', 0x0800, '9ec2dc89315a0d50c5e166f664f64a48'],
  ['invaders.f', 0x1000, '7709a2576adb6fedcdfe175759e5c17a'],
  ['invaders.e', 0x1800, '7d3b201f3e84af3b4fcb8ce8619ec9c6'],
];

if (!fs.existsSync(SRC)) {
  console.error(`missing ${SRC}\n  curl -o reference/Code.md https://raw.githubusercontent.com/topherCantrell/computerarcheology/master/content/Arcade/SpaceInvaders/Code.md`);
  process.exit(1);
}

const rom = new Uint8Array(0x2000);
const seen = new Uint8Array(0x2000);
for (const line of fs.readFileSync(SRC, 'utf8').split('\n')) {
  const m = /^([0-9A-F]{4}):((?: [0-9A-F]{2})+)(?=\s|$)/.exec(line);
  if (!m) continue;
  let a = parseInt(m[1], 16);
  for (const b of m[2].trim().split(' ')) {
    if (a < 0x2000) { rom[a] = parseInt(b, 16); seen[a] = 1; }
    a++;
  }
}
rom.fill(0, 0x1000, 0x1400); // the dropped diagnostics
const missing = seen.reduce((n, s, i) => n + (!s && (i < 0x1000 || i >= 0x1400) ? 1 : 0), 0);
if (missing) { console.error(`${missing} bytes missing from the listing`); process.exit(1); }

let ok = true;
for (const [name, at, want] of CHIPS) {
  const got = crypto.createHash('md5').update(rom.subarray(at, at + 0x800)).digest('hex');
  console.log(`${name} ${got} ${got === want ? 'ok' : `MISMATCH (want ${want})`}`);
  ok &&= got === want;
}
if (!ok) process.exit(1);
fs.writeFileSync(OUT, rom);
console.log(`wrote ${path.relative(ROOT, OUT)}`);
