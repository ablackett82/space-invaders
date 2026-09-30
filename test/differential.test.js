// Plays the engine and the original program (in the reference emulator) side
// by side and checks that video RAM and work RAM stay identical. Needs
// reference/program.bin (npm run rom); skipped without it.
//
// The engine's main thread runs on an estimate of the original's CPU time, so
// the two can drift by a frame where the original's timing depends on exactly
// where an interrupt lands mid-routine; these runs are ones that stay exact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { available } from '../tools/emu/host.mjs';

const RUNS = [
  ['attract mode, 10000 frames', 'attract', 10000],
  ['scripted one-player game', 'play', 10000],
  ['random one-player game, seed 7', '7', 10000],
  ['random one-player game, seed 42', '42', 10000],
  ['random two-player game, seed 1', '2p:1', 4000],
];

for (const [name, kind, frames] of RUNS) {
  test(name, { skip: !available() && 'reference/program.bin missing (npm run rom)' }, async () => {
    const { compare } = await import('../tools/emu/diff.mjs');
    const r = compare(frames, kind);
    assert.equal(r, null, r ? `differs from frame ${r.frame}: ${r.vram} video bytes, RAM ${r.ram.map((a) => a.toString(16)).join(' ')}` : '');
  });
}
