// The game engine: a routine-by-routine reimplementation of the arcade
// program, traced from Christopher Cantrell's commented disassembly
// (computerarcheology.com; see tools/buildrom.mjs).
//
// State lives in `m`, a 64K byte array laid out like the original's address
// space: work RAM at $2000-$23FF, video RAM at $2400-$3FFF, and the
// program's data tables at their ROM addresses (loaded from
// data/tables.json). Keeping the original layout means the routines can
// follow the program's own pointers, the renderer can draw straight from
// video RAM, and the engine can be compared byte for byte with the real
// program running in an emulator (tools/emu).
//
// The original runs three threads of control: a main thread (the attract
// screens, the start-up sequence and the game loop) and two interrupt
// handlers per frame, one when the beam reaches scanline 96 and one at the
// start of vblank. The interrupts do the drawing and moving; the main thread
// polls for collisions, counts aliens and keeps score. Here the main thread
// is a generator that yields wherever the original busy-waits on the
// interrupts, and one call to frame() runs: the main thread (from the end of
// the last vblank), the mid-screen interrupt, the main thread again, and the
// vblank interrupt, after which the picture is complete. The main thread also gets a budget of CPU time per half frame
// (what the 2 MHz 8080 has left after the interrupt), and the slow routines
// spend it (see spend() in flow.js), so that, as on the cabinet, clearing the
// screen is a visible wipe and the game loop runs several times a frame.
// Where the original drops the interrupted context and carries on as
// a new main thread (`LD SP,$2400 / EI`), the handler throws a Restart and
// the engine swaps in a new main generator.
//
// Routines live in the other modules in this folder as plain functions of
// the machine `g`, tagged with their original address.

import { isrMid, isrVblank } from './isr.js';
import { init } from './flow.js';

export const FRAME_HZ = 60;
// CPU cycles for the main thread from the mid-screen interrupt (line 96) to
// vblank (line 224), and from vblank to the next mid-screen interrupt, at
// 1.9968 MHz with 262 lines a frame
const SLOT_MID = 16258, SLOT_VBLANK = 17022;


// Input port 1 bits (1 = pressed)
export const IN_COIN = 0x01, IN_START2 = 0x02, IN_START1 = 0x04, IN_FIRE = 0x10, IN_LEFT = 0x20, IN_RIGHT = 0x40;
// Port 2: DIP switches (3 ships, extra ship at 1500, coin info shown) and player 2's controls
export const DIP_DEFAULT = 0x00;

/** What the main thread yields when it has used up its time (as opposed to waiting). */
export const BUSY = 1;

/** Thrown by an interrupt handler that abandons every context and becomes the main thread. */
export class Restart {
  constructor(entry) { this.entry = entry; }
}

export class Machine {
  /**
   * @param {{runs: [number, string][], saucerBits: string}} tables  data/tables.json
   * @param {{dip?: number}} [opts]
   */
  constructor(tables, opts = {}) {
    this.m = new Uint8Array(0x10000);
    for (const [addr, hex] of tables.runs) {
      for (let i = 0; i < hex.length; i += 2) this.m[addr + i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    // bit 0 of each byte at $0800-$08FF (see saucerDirection in isr.js)
    this.saucerBits = tables.saucerBits;
    this.in1 = 0;
    this.in2 = opts.dip ?? DIP_DEFAULT;
    this.shift = 0;        // the 16-bit shift register (ports 2, 3, 4)
    this.shiftAmt = 0;
    this.port3 = 0;        // sound: UFO, shot, player dies, invader dies, extra ship, amp enable
    this.port5 = 0;        // sound: fleet 1-4, UFO hit
    // cheats (all off = the arcade exactly); set by main.js
    this.assist = { invincible: false, reloadScale: 1, rapidFire: false, noLanding: false, unlimited: false };
    this.budget = 0;       // main thread cycles left in this slice
    this.t = 0;            // cycles counted by the routines (see draw.js); times the interrupts
    this.isrT = 0;         // how long the last interrupt handler took
    this.main = init(this);
    this.runMain(Infinity); // power-on: runs with interrupts off until the splash's first wait
  }

  /**
   * Advance one frame with the given port 1 (and optionally port 2) inputs.
   * `probe`, for the development tools, is called after each of the four parts.
   */
  frame(in1 = this.in1, in2 = this.in2, probe = null) {
    this.in1 = in1;
    this.in2 = in2;
    this.runMain(SLOT_VBLANK - this.isrT);
    probe?.('main2');
    this.interrupt(isrMid);
    probe?.('mid');
    this.runMain(SLOT_MID - this.isrT);
    probe?.('main1');
    this.interrupt(isrVblank);
    probe?.('vbl');
  }

  interrupt(handler) {
    this.t = 0;
    try { handler(this); } catch (e) {
      if (!(e instanceof Restart)) throw e;
      this.main = e.entry(this);
      this.budget = 0; // the interrupted main thread's unfinished work is abandoned with it
    }
    this.isrT = this.t;
  }

  /**
   * Run the main thread for a slice of time. It stops at a wait (a plain
   * `yield`: the rest of the slice goes on polling) or when it has spent its
   * cycles (`yield BUSY`: the overrun is carried into the next slice).
   */
  runMain(cycles = 0) {
    this.budget = Math.min(this.budget, 0) + cycles;
    for (;;) {
      let r;
      try { r = this.main.next(); } catch (e) {
        if (!(e instanceof Restart)) throw e;
        this.main = e.entry(this);
        continue;
      }
      if (r.value !== BUSY) this.budget = 0;
      return;
    }
  }

  // ---- ports ----
  inp(port) {
    switch (port) {
      case 1: return this.in1 | 0x08;
      case 2: return this.in2;
      default: return 0;
    }
  }
  out3(v) { this.port3 = v; }
  out5(v) { this.port5 = v; }
  shiftWrite(v) { this.shift = ((v & 0xff) << 8) | (this.shift >> 8); }
  shiftRead() { return (this.shift >> (8 - this.shiftAmt)) & 0xff; }

  // ---- memory helpers ----
  w(a) { return this.m[a] | (this.m[a + 1] << 8); }
  sw(a, v) { this.m[a] = v & 0xff; this.m[a + 1] = (v >> 8) & 0xff; }
}
