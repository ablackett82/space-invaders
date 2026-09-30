// Drawing and memory routines: sprites through the shift register, text,
// score digits, the shields, the ship stash. Screen addresses and "pixel
// numbers" are the original's: a pixel number is (column + $20) * 256 + y,
// with y counted up from the bottom of the (rotated) picture.
//
// Each routine adds its approximate 8080 cycle count to g.t, which the
// machine uses to time the interrupt handlers (see Machine.interrupt).

/** Video RAM write with the board's address decoding: $4000-$5FFF mirrors RAM, ROM ignores writes. */
function put(m, a, v) {
  a &= 0xffff;
  if (a >= 0x4000) a = 0x2000 | (a & 0x1fff);
  if (a >= 0x2000) m[a] = v;
}
function get(m, a) {
  a &= 0xffff;
  return a >= 0x4000 ? m[0x2000 | (a & 0x1fff)] : m[a];
}

/** $1A47: pixel number to screen address. */
export const convToScr = (hl) => 0x2000 | ((hl >> 3) & 0x1fff);

/** $1474: pixel number to screen address, loading the shift amount. */
export function cnvtPixNumber(g, hl) {
  g.shiftAmt = hl & 7;
  return convToScr(hl);
}

/** $1A3B: read a 5-byte sprite descriptor: picture, position, size. */
export function readDesc(g, a) {
  const m = g.m;
  g.t += 60;
  return { de: m[a] | (m[a + 1] << 8), hl: m[a + 2] | (m[a + 3] << 8), b: m[a + 4] };
}

/** $1A32: copy b bytes from de to hl (b = 0 copies 256). */
export function blockCopy(g, hl, de, b) {
  const m = g.m;
  let n = b || 256;
  g.t += 39 * n;
  while (n--) { put(m, hl, get(m, de)); hl++; de++; }
}

/** $1439: draw b rows of a byte-wide sprite at screen address hl; returns hl moved on by b rows. */
export function drawSimpSprite(g, hl, de, b) {
  const m = g.m;
  let n = b || 256;
  g.t += 75 * n;
  while (n--) { put(m, hl, get(m, de)); de++; hl += 0x20; }
  return hl & 0xffff;
}

/** $14CB: clear b rows of a byte-wide sprite at hl; returns hl moved on. */
export function clearSmallSprite(g, hl, b, fill = 0) {
  const m = g.m;
  let n = b || 256;
  g.t += 63 * n;
  while (n--) { put(m, hl, fill); hl += 0x20; }
  return hl & 0xffff;
}

/** Shared body of the shifted-sprite routines: op(screenByte, spriteBits) -> new byte. */
function shifted(g, pix, de, b, op, rowCycles = 176) {
  const m = g.m;
  let hl = cnvtPixNumber(g, pix);
  let n = b || 256;
  g.t += 90 + rowCycles * n;
  while (n--) {
    g.shiftWrite(get(m, de));
    put(m, hl, op(get(m, hl), g.shiftRead()));
    g.shiftWrite(0);
    put(m, hl + 1, op(get(m, hl + 1), g.shiftRead()));
    de++;
    hl += 0x20;
  }
}

/** $1400: OR a shifted sprite onto the screen. */
export function drawShiftedSprite(g, { hl, de, b }) { shifted(g, hl, de, b, (s, v) => s | v); }

/** $1452: erase a shifted sprite from the screen. */
export function eraseShifted(g, { hl, de, b }) { shifted(g, hl, de, b, (s, v) => s & ~v & 0xff); }

/** $1491: OR a shifted sprite onto the screen, setting $2061 if it overlapped anything. */
export function drawSprCollision(g, { hl, de, b }) {
  const m = g.m;
  m[0x2061] = 0;
  shifted(g, hl, de, b, (s, v) => { if (s & v) m[0x2061] = 1; return s | v; }, 252);
}

/** $15D3: store (not OR) a shifted sprite at pixel number hl; returns the screen address. */
export function drawSprite(g, pix, de, b) {
  const scr = cnvtPixNumber(g, pix);
  shifted(g, pix, de, b, (s, v) => v, 160);
  return scr;
}

/** $1424: clear two bytes per row for b rows at pixel number hl. */
export function eraseSimpleSprite(g, pix, b) {
  const m = g.m;
  let hl = cnvtPixNumber(g, pix);
  let n = b || 256;
  g.t += 60 + 105 * n;
  while (n--) { put(m, hl, 0); put(m, hl + 1, 0); hl += 0x20; }
}

/** $08FF: draw character a (the font at $1E00) at screen address hl; returns hl moved on a character. */
export function drawChar(g, hl, a) {
  return drawSimpSprite(g, hl, 0x1e00 + a * 8, 8);
}

/** $08F3: print c characters from de at hl; returns hl after the message. */
export function printMessage(g, hl, de, c) {
  const m = g.m;
  let n = c || 256;
  while (n--) { hl = drawChar(g, hl, m[de]); de++; }
  return hl;
}

/** $09B2: two BCD digits; returns hl after them. */
export function drawHexByte(g, hl, a) {
  hl = drawChar(g, hl, (a >> 4) + 0x1a);
  return drawChar(g, hl, (a & 0x0f) + 0x1a);
}

/** $09AD: four digits from de (high byte first). */
export function print4Digits(g, hl, de) {
  hl = drawHexByte(g, hl, de >> 8);
  return drawHexByte(g, hl, de & 0xff);
}

/** $1931: print the score in a descriptor (value, then screen address). */
export function drawScore(g, desc) {
  print4Digits(g, g.w(desc + 2), g.w(desc));
}

/** $09CA: the active player's score descriptor. */
export const scoreDesc = (g) => (g.m[0x2067] & 1 ? 0x20f8 : 0x20fc);

/** $191A: " SCORE<1> HI-SCORE SCORE<2> ". */
export const drawScoreHead = (g) => printMessage(g, 0x241e, 0x1ae4, 0x1c);
/** $1950 */
export const printHiScore = (g) => drawScore(g, 0x20f4);
/** $193C: "CREDIT ". */
export const printCredit = (g) => printMessage(g, 0x3501, 0x1fa9, 7);
/** $1947 */
export const drawNumCredits = (g) => drawHexByte(g, 0x3c01, g.m[0x20eb]);

/** $1A5C: clear all of video RAM. */
export function clearScreen(g) { g.m.fill(0, 0x2400, 0x4000); }

/** $01CF: the one-pixel line across the bottom of the playfield. */
export const drawBottomLine = (g) => clearSmallSprite(g, 0x2402, 0xe0, 1);

/** $01EF / $01F5: fill a player's shield buffer with four fresh shields. */
export function drawShields(g, buf) {
  for (let i = 0; i < 4; i++) { blockCopy(g, buf, 0x1d20, 0x2c); buf += 0x2c; }
}

/**
 * $021E: copy the four shields between the screen and a player's buffer
 * (remember = true: screen to buffer, $147C; false: OR buffer onto screen, $1A69).
 */
export function copyShields(g, remember, de) {
  const m = g.m;
  m[0x2081] = remember ? 1 : 0;
  let hl = 0x2806;
  for (let s = 0; s < 4; s++) {
    for (let row = 0; row < 0x16; row++) {
      for (let c = 0; c < 2; c++) {
        if (remember) put(m, de, get(m, hl + c));
        else put(m, hl + c, get(m, de) | get(m, hl + c));
        de++;
      }
      hl += 0x20;
    }
    hl += 0x2e0;
  }
}
export const rememberShields1 = (g) => copyShields(g, true, 0x2142);
export const rememberShields2 = (g) => copyShields(g, true, 0x2242);
export const restoreShields1 = (g) => copyShields(g, false, 0x2142);
export const restoreShields2 = (g) => copyShields(g, false, 0x2242);

/** $092E: pointer to the active player's ships remaining. */
export const shipsPtr = (g) => (g.m[0x2067] << 8) | 0xff;

/** $1A8B: the ships-remaining digit. */
export const printNumShips = (g, a) => drawChar(g, 0x2501, (a & 0x0f) + 0x1a);

/** $19E6: draw n spare ships from $2701, then clear the rest of the line ($19FA). */
export function drawNumShips(g, n, hl = 0x2701) {
  for (let i = 0; i < n; i++) hl = drawSimpSprite(g, hl, 0x1c60, 0x10);
  return clearShips(g, hl);
}
export function clearShips(g, hl) {
  do hl = clearSmallSprite(g, hl, 0x10); while ((hl >> 8) !== 0x35);
  return hl;
}

/** $1A7F: take a ship from the stash and redraw the stash and digit. */
export function removeShip(g) {
  const m = g.m, p = shipsPtr(g), a = m[p];
  if (!a) return;
  m[p] = a - 1;
  drawNumShips(g, a - 1);
  printNumShips(g, a);
}

/** $01C0 / $1904: all 55 aliens alive. */
export function initAliens(g, base) { g.m.fill(1, base, base + 0x37); }

/** 8-bit add then DAA, as the 8080 does it: returns [result, carry]. */
export function bcdAdd(a, b, cin = 0) {
  const ac = (a & 0xf) + (b & 0xf) + cin > 0xf;
  let r = a + b + cin, c = r > 0xff;
  r &= 0xff;
  let corr = 0;
  if (ac || (r & 0xf) > 9) corr = 6;
  if (c || (r >> 4) > 9 || ((r >> 4) >= 9 && (r & 0xf) > 9)) { corr |= 0x60; c = true; }
  return [(r + corr) & 0xff, c ? 1 : 0];
}
