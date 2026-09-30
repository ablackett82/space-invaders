// A plain Intel 8080 interpreter, for running the original program as a
// reference (see host.mjs). Flags follow the 8080 (parity, not overflow; the
// auxiliary carry as the 8080 computes it) and every instruction reports its
// cycle count.

const PARITY = new Uint8Array(256).map((_, v) => { let p = 0; for (let i = 0; i < 8; i++) p ^= (v >> i) & 1; return p ? 0 : 1; });
// cycles per opcode (conditional calls/returns add 6 when taken)
const CYCLES = [
  4, 10, 7, 5, 5, 5, 7, 4, 4, 10, 7, 5, 5, 5, 7, 4,
  4, 10, 7, 5, 5, 5, 7, 4, 4, 10, 7, 5, 5, 5, 7, 4,
  4, 10, 16, 5, 5, 5, 7, 4, 4, 10, 16, 5, 5, 5, 7, 4,
  4, 10, 13, 5, 10, 10, 10, 4, 4, 10, 13, 5, 5, 5, 7, 4,
  5, 5, 5, 5, 5, 5, 7, 5, 5, 5, 5, 5, 5, 5, 7, 5,
  5, 5, 5, 5, 5, 5, 7, 5, 5, 5, 5, 5, 5, 5, 7, 5,
  5, 5, 5, 5, 5, 5, 7, 5, 5, 5, 5, 5, 5, 5, 7, 5,
  7, 7, 7, 7, 7, 7, 7, 7, 5, 5, 5, 5, 5, 5, 7, 5,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  5, 10, 10, 10, 11, 11, 7, 11, 5, 10, 10, 10, 11, 17, 7, 11,
  5, 10, 10, 10, 11, 11, 7, 11, 5, 10, 10, 10, 11, 17, 7, 11,
  5, 10, 10, 18, 11, 11, 7, 11, 5, 5, 10, 4, 11, 17, 7, 11,
  5, 10, 10, 4, 11, 11, 7, 11, 5, 5, 10, 4, 11, 17, 7, 11,
];

export class I8080 {
  /** @param {{read(a:number):number, write(a:number,v:number):void, input(p:number):number, output(p:number,v:number):void}} bus */
  constructor(bus) {
    this.bus = bus;
    this.a = 0; this.b = 0; this.c = 0; this.d = 0; this.e = 0; this.h = 0; this.l = 0;
    this.sp = 0; this.pc = 0;
    this.fs = 0; this.fz = 0; this.fa = 0; this.fp = 0; this.fc = 0;
    this.ie = 0; this.halted = false;
    this.cycles = 0;
  }

  get f() { return (this.fs << 7) | (this.fz << 6) | (this.fa << 4) | (this.fp << 2) | 2 | this.fc; }
  set f(v) { this.fs = (v >> 7) & 1; this.fz = (v >> 6) & 1; this.fa = (v >> 4) & 1; this.fp = (v >> 2) & 1; this.fc = v & 1; }

  rb(a) { return this.bus.read(a & 0xffff); }
  wb(a, v) { this.bus.write(a & 0xffff, v & 0xff); }
  rw(a) { return this.rb(a) | (this.rb(a + 1) << 8); }
  ww(a, v) { this.wb(a, v); this.wb(a + 1, v >> 8); }
  next() { const v = this.rb(this.pc); this.pc = (this.pc + 1) & 0xffff; return v; }
  next16() { const v = this.rw(this.pc); this.pc = (this.pc + 2) & 0xffff; return v; }
  push(v) { this.sp = (this.sp - 2) & 0xffff; this.ww(this.sp, v); }
  pop() { const v = this.rw(this.sp); this.sp = (this.sp + 2) & 0xffff; return v; }

  get bc() { return (this.b << 8) | this.c; }
  get de() { return (this.d << 8) | this.e; }
  get hl() { return (this.h << 8) | this.l; }
  set bc(v) { this.b = (v >> 8) & 0xff; this.c = v & 0xff; }
  set de(v) { this.d = (v >> 8) & 0xff; this.e = v & 0xff; }
  set hl(v) { this.h = (v >> 8) & 0xff; this.l = v & 0xff; }

  szp(v) { this.fs = v >> 7; this.fz = v === 0 ? 1 : 0; this.fp = PARITY[v]; }

  getR(i) {
    switch (i) {
      case 0: return this.b; case 1: return this.c; case 2: return this.d; case 3: return this.e;
      case 4: return this.h; case 5: return this.l; case 6: return this.rb(this.hl); default: return this.a;
    }
  }
  setR(i, v) {
    v &= 0xff;
    switch (i) {
      case 0: this.b = v; break; case 1: this.c = v; break; case 2: this.d = v; break; case 3: this.e = v; break;
      case 4: this.h = v; break; case 5: this.l = v; break; case 6: this.wb(this.hl, v); break; default: this.a = v;
    }
  }

  add(v, carry = 0) {
    const r = this.a + v + carry;
    this.fa = ((this.a & 0xf) + (v & 0xf) + carry) > 0xf ? 1 : 0;
    this.fc = r > 0xff ? 1 : 0;
    this.a = r & 0xff; this.szp(this.a);
  }
  sub(v, borrow = 0, store = true) {
    const r = this.a - v - borrow;
    // 8080: AC is set when there is no borrow from bit 4 (the adder sees a + ~v + 1)
    this.fa = ((this.a & 0xf) - (v & 0xf) - borrow) >= 0 ? 1 : 0;
    this.fc = r < 0 ? 1 : 0;
    const res = r & 0xff; this.szp(res);
    if (store) this.a = res;
  }
  and(v) { this.fa = ((this.a | v) & 0x08) ? 1 : 0; this.a &= v; this.szp(this.a); this.fc = 0; }
  xor(v) { this.a ^= v; this.szp(this.a); this.fc = 0; this.fa = 0; }
  or(v) { this.a |= v; this.szp(this.a); this.fc = 0; this.fa = 0; }
  alu(op, v) {
    switch (op) {
      case 0: this.add(v); break; case 1: this.add(v, this.fc); break;
      case 2: this.sub(v); break; case 3: this.sub(v, this.fc); break;
      case 4: this.and(v); break; case 5: this.xor(v); break;
      case 6: this.or(v); break; default: this.sub(v, 0, false);
    }
  }
  cond(i) {
    switch (i) {
      case 0: return !this.fz; case 1: return !!this.fz; case 2: return !this.fc; case 3: return !!this.fc;
      case 4: return !this.fp; case 5: return !!this.fp; case 6: return !this.fs; default: return !!this.fs;
    }
  }

  /** Take an interrupt with the given RST opcode (if enabled). */
  interrupt(rst) {
    if (!this.ie) return false;
    this.ie = 0; this.halted = false;
    this.push(this.pc);
    this.pc = rst & 0x38;
    this.cycles += 11;
    return true;
  }

  step() {
    if (this.halted) { this.cycles += 4; return 4; }
    const op = this.next();
    let cyc = CYCLES[op];
    if (op >= 0x40 && op < 0x80) {
      if (op === 0x76) this.halted = true;
      else this.setR((op >> 3) & 7, this.getR(op & 7));
    } else if (op >= 0x80 && op < 0xc0) {
      this.alu((op >> 3) & 7, this.getR(op & 7));
    } else {
      switch (op) {
        case 0x00: case 0x08: case 0x10: case 0x18: case 0x20: case 0x28: case 0x30: case 0x38: break;
        case 0x01: this.bc = this.next16(); break;
        case 0x11: this.de = this.next16(); break;
        case 0x21: this.hl = this.next16(); break;
        case 0x31: this.sp = this.next16(); break;
        case 0x02: this.wb(this.bc, this.a); break;
        case 0x12: this.wb(this.de, this.a); break;
        case 0x0a: this.a = this.rb(this.bc); break;
        case 0x1a: this.a = this.rb(this.de); break;
        case 0x22: this.ww(this.next16(), this.hl); break;
        case 0x2a: this.hl = this.rw(this.next16()); break;
        case 0x32: this.wb(this.next16(), this.a); break;
        case 0x3a: this.a = this.rb(this.next16()); break;
        case 0x03: this.bc = this.bc + 1; break;
        case 0x13: this.de = this.de + 1; break;
        case 0x23: this.hl = this.hl + 1; break;
        case 0x33: this.sp = (this.sp + 1) & 0xffff; break;
        case 0x0b: this.bc = this.bc - 1; break;
        case 0x1b: this.de = this.de - 1; break;
        case 0x2b: this.hl = this.hl - 1; break;
        case 0x3b: this.sp = (this.sp - 1) & 0xffff; break;
        case 0x04: case 0x0c: case 0x14: case 0x1c: case 0x24: case 0x2c: case 0x34: case 0x3c: {
          const r = (op >> 3) & 7, v = (this.getR(r) + 1) & 0xff;
          this.fa = (v & 0xf) === 0 ? 1 : 0; this.setR(r, v); this.szp(v); break;
        }
        case 0x05: case 0x0d: case 0x15: case 0x1d: case 0x25: case 0x2d: case 0x35: case 0x3d: {
          const r = (op >> 3) & 7, v = (this.getR(r) - 1) & 0xff;
          this.fa = (v & 0xf) !== 0xf ? 1 : 0; this.setR(r, v); this.szp(v); break;
        }
        case 0x06: case 0x0e: case 0x16: case 0x1e: case 0x26: case 0x2e: case 0x36: case 0x3e:
          this.setR((op >> 3) & 7, this.next()); break;
        case 0x09: case 0x19: case 0x29: case 0x39: {
          const v = op === 0x09 ? this.bc : op === 0x19 ? this.de : op === 0x29 ? this.hl : this.sp;
          const r = this.hl + v; this.fc = r > 0xffff ? 1 : 0; this.hl = r & 0xffff; break;
        }
        case 0x07: this.fc = this.a >> 7; this.a = ((this.a << 1) | this.fc) & 0xff; break;
        case 0x0f: this.fc = this.a & 1; this.a = (this.a >> 1) | (this.fc << 7); break;
        case 0x17: { const c = this.fc; this.fc = this.a >> 7; this.a = ((this.a << 1) | c) & 0xff; break; }
        case 0x1f: { const c = this.fc; this.fc = this.a & 1; this.a = (this.a >> 1) | (c << 7); break; }
        case 0x27: { // DAA
          let add = 0, c = this.fc;
          if (this.fa || (this.a & 0xf) > 9) add = 6;
          if (this.fc || (this.a >> 4) > 9 || ((this.a >> 4) >= 9 && (this.a & 0xf) > 9)) { add |= 0x60; c = 1; }
          const lo = (this.a & 0xf) + (add & 0xf);
          this.fa = lo > 0xf ? 1 : 0;
          this.a = (this.a + add) & 0xff; this.szp(this.a); this.fc = c; break;
        }
        case 0x2f: this.a ^= 0xff; break;
        case 0x37: this.fc = 1; break;
        case 0x3f: this.fc ^= 1; break;
        case 0xc6: case 0xce: case 0xd6: case 0xde: case 0xe6: case 0xee: case 0xf6: case 0xfe:
          this.alu((op >> 3) & 7, this.next()); break;
        case 0xc1: this.bc = this.pop(); break;
        case 0xd1: this.de = this.pop(); break;
        case 0xe1: this.hl = this.pop(); break;
        case 0xf1: { const v = this.pop(); this.a = v >> 8; this.f = v & 0xff; break; }
        case 0xc5: this.push(this.bc); break;
        case 0xd5: this.push(this.de); break;
        case 0xe5: this.push(this.hl); break;
        case 0xf5: this.push((this.a << 8) | this.f); break;
        case 0xc3: case 0xcb: this.pc = this.next16(); break;
        case 0xc2: case 0xca: case 0xd2: case 0xda: case 0xe2: case 0xea: case 0xf2: case 0xfa: {
          const t = this.next16(); if (this.cond((op >> 3) & 7)) this.pc = t; break;
        }
        case 0xcd: case 0xdd: case 0xed: case 0xfd: { const t = this.next16(); this.push(this.pc); this.pc = t; break; }
        case 0xc4: case 0xcc: case 0xd4: case 0xdc: case 0xe4: case 0xec: case 0xf4: case 0xfc: {
          const t = this.next16();
          if (this.cond((op >> 3) & 7)) { this.push(this.pc); this.pc = t; cyc += 6; }
          break;
        }
        case 0xc9: case 0xd9: this.pc = this.pop(); break;
        case 0xc0: case 0xc8: case 0xd0: case 0xd8: case 0xe0: case 0xe8: case 0xf0: case 0xf8:
          if (this.cond((op >> 3) & 7)) { this.pc = this.pop(); cyc += 6; }
          break;
        case 0xc7: case 0xcf: case 0xd7: case 0xdf: case 0xe7: case 0xef: case 0xf7: case 0xff:
          this.push(this.pc); this.pc = op & 0x38; break;
        case 0xe9: this.pc = this.hl; break;
        case 0xf9: this.sp = this.hl; break;
        case 0xe3: { const v = this.rw(this.sp); this.ww(this.sp, this.hl); this.hl = v; break; }
        case 0xeb: { const v = this.de; this.de = this.hl; this.hl = v; break; }
        case 0xd3: this.bus.output(this.next(), this.a); break;
        case 0xdb: this.a = this.bus.input(this.next()) & 0xff; break;
        case 0xf3: this.ie = 0; break;
        case 0xfb: this.ie = 1; break;
        default: throw new Error(`bad opcode ${op.toString(16)} at ${(this.pc - 1).toString(16)}`);
      }
    }
    this.cycles += cyc;
    return cyc;
  }
}
