// Runs the original program (reference/program.bin, rebuilt and checksum-
// verified by tools/buildrom.mjs) on an 8080 with the board around it: 1K of
// work RAM and 7K of video RAM, the shift register, the input ports and DIP
// switches, and the two interrupts per frame (RST 1 at scanline 96, RST 2 at
// the start of vblank). Used to check src/game against the real thing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { I8080 } from './cpu8080.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROGRAM = path.join(ROOT, 'reference', 'program.bin');
export const available = () => fs.existsSync(PROGRAM);

export const CPU_HZ = 1996800;
export const T_FRAME = Math.round(CPU_HZ / 60); // 33280

export class Host {
  constructor({ dip = 0 } = {}) {
    const mem = this.mem = new Uint8Array(0x10000);
    mem.set(fs.readFileSync(PROGRAM), 0);
    this.in1 = 0x08;       // bit 3 is always 1
    this.in2 = dip & 0x8b;  // ships, bonus, coin info
    this.shift = 0; this.shiftAmt = 0;
    this.port3 = 0; this.port5 = 0;
    this.frameNo = 0;
    this.t0 = 0;       // cycle count at the start of frame 0
    const self = this;
    this.cpu = new I8080({
      read(a) { return mem[a < 0x4000 ? a : 0x2000 | (a & 0x1fff)]; },
      write(a, v) { if (a >= 0x2000) mem[a < 0x4000 ? a : 0x2000 | (a & 0x1fff)] = v; },
      input(p) {
        switch (p) {
          case 0: return 0x0e;
          case 1: return self.in1;
          case 2: return self.in2;
          case 3: return (self.shift >> (8 - self.shiftAmt)) & 0xff;
          default: return 0;
        }
      },
      output(p, v) {
        switch (p) {
          case 2: self.shiftAmt = v & 7; break;
          case 3: self.port3 = v; break;
          case 4: self.shift = (v << 8) | (self.shift >> 8); break;
          case 5: self.port5 = v; break;
          default: break;
        }
      },
    });
  }

  /** Run from power-on to the splash screen's first wait ($0ADA), and count frames from there. */
  boot() {
    const cpu = this.cpu;
    while (cpu.pc !== 0x0ada) cpu.step();
    this.t0 = cpu.cycles;
    this.frameNo = 0;
    return this;
  }

  runUntil(t) {
    const cpu = this.cpu;
    while (cpu.cycles < t) cpu.step();
  }

  /**
   * One frame: the main thread up to the mid-screen interrupt (line 96 of
   * 262, counting the 224 visible lines from 0), that interrupt, the main
   * thread to the vblank interrupt (line 224), and the vblank handler, which
   * is run to its end (the handler re-enabling interrupts) so the state can
   * be compared with the engine's at the same point.
   */
  frame(in1 = this.in1, in2 = this.in2) {
    this.in1 = in1 | 0x08;
    this.in2 = in2;
    const t0 = this.t0 + this.frameNo * T_FRAME;
    this.runUntil(t0 + Math.round(T_FRAME * 96 / 262));
    this.cpu.interrupt(0xcf);
    this.runUntil(t0 + Math.round(T_FRAME * 224 / 262));
    if (this.cpu.interrupt(0xd7)) this.finishIsr();
    this.frameNo++;
  }

  /** Run until the interrupt handler re-enables interrupts (its EI, or the EI of a handler that becomes the main thread). */
  finishIsr() {
    const cpu = this.cpu;
    while (!cpu.ie) cpu.step();
  }
}
