// The main thread: power-on, the attract screens and demo game, waiting for
// the start button, the start of each turn, the game loop, the end of a
// rack, a player's death, switching players and game over. These are
// generators; `yield` is where the original busy-waits on the interrupts,
// and `yield* spend(g, cycles)` charges the time a routine takes on the
// 8080 against the main thread's slice (see Machine.runMain).
import {
  blockCopy, printMessage, drawChar, drawSimpSprite, clearSmallSprite, drawScore, print4Digits,
  printHiScore, printCredit, drawNumCredits, drawScoreHead, drawBottomLine, drawShields, restoreShields1,
  restoreShields2, rememberShields1, rememberShields2, shipsPtr, printNumShips, clearShips, removeShip,
  initAliens, bcdAdd, scoreDesc, drawSprite, readDesc,
} from './draw.js';
import { readInputs, soundBits3On, soundBits3Off, findRow, findColumn } from './isr.js';
import { BUSY } from './machine.js';

// ---- time ----

// 8080 cycle counts of the main thread's slower routines, measured on the
// original with tools/emu/profile.mjs
const T = {
  char: 790,           // $08F3 per character printed
  copyByte: 39,        // $1A32 per byte
  shields: 15500,      // $021E restoring four shields
  bottomLine: 14150,   // $01CF
  removeShip: 8800,    // $1A7F
};

/** $1A7F with its time. */
function* takeShip(g) {
  removeShip(g);
  yield* spend(g, T.removeShip);
}

/** Charge n cycles to the main thread, yielding (busy) when its slice is used up. */
function* spend(g, n) {
  g.budget -= n;
  while (g.budget <= 0) yield BUSY;
}

/** $08F3 with its time. */
function* print(g, hl, de, c) {
  hl = printMessage(g, hl, de, c);
  yield* spend(g, c * T.char);
  return hl;
}

/** $09D6: clear the playfield (all but the score and status bytes of each column), a column at a time. */
function* clearPlayField(g) {
  const m = g.m;
  for (let col = 0x2402; col < 0x4000; col += 0x20) {
    m.fill(0, col, col + 0x1a);
    yield* spend(g, 1746);
  }
}

/** $1956: clear the screen ($1A5C), then the score header, scores, high score and credits. */
function* drawStatus(g) {
  const m = g.m;
  for (let col = 0x2400; col < 0x4000; col += 0x20) {
    m.fill(0, col, col + 0x20);
    yield* spend(g, 1184);
  }
  drawScoreHead(g);
  drawScore(g, 0x20f8);
  drawScore(g, 0x20fc);
  printHiScore(g);
  printCredit(g);
  drawNumCredits(g);
  yield* spend(g, 49 * T.char);
}


// ---- waiting ----

/** $0AD7: wait for the interrupt countdown to run out. */
function* waitOnDelay(g, n) {
  g.m[0x20c0] = n;
  while (g.m[0x20c0]) yield;
}
const oneSecDelay = (g) => waitOnDelay(g, 0x40);
const twoSecDelay = (g) => waitOnDelay(g, 0x80);

/** $0A93: print a message a letter at a time; returns the screen address after it. */
function* printMessageDel(g, hl, de, c) {
  const m = g.m;
  do {
    hl = drawChar(g, hl, m[de]);
    m[0x20c0] = 7;
    while (m[0x20c0] !== 1) yield;
    de++;
  } while (--c & 0xff);
  return hl;
}

/** $1856: a 4-byte print structure (screen address, message) at bc, or null at the $FF end mark. */
function readPriStruct(g, bc) {
  const m = g.m;
  if (m[bc] === 0xff) return null;
  return { hl: m[bc] | (m[bc + 1] << 8), de: m[bc + 2] | (m[bc + 3] << 8) };
}

/** $0A80: let the vblank interrupt move the splash sprite to its target. */
function* animate(g) {
  const m = g.m;
  m[0x20c1] = 2;
  while (!m[0x20cb]) yield;
  m[0x20c1] = 0;
}
const iniSplashAni = (g, de) => blockCopy(g, 0x20c2, de, 0x0c);

// ---- power-on and the attract screens ----

/** $18D4 */
export function* init(g) {
  blockCopy(g, 0x2000, 0x1b00, 0);
  yield* drawStatus(g);
  g.m[0x20cf] = 8;
  yield* attract(g, false);
}

/** $0AEA..$0BE5: the splash screens, the demo game and the credit screen, round and round. */
function* attract(g, fromCredits) {
  for (;;) {
    if (!fromCredits) yield* splash(g);
    fromCredits = false;
    yield* credits(g);
    g.m[0x20cf] = 8; // $18DF
  }
}

/** $0AEA: "PLAY SPACE INVADERS", the score table, the alien fixing the Y, the demo game. */
function* splash(g) {
  const m = g.m;
  g.out3(0);
  g.out5(0);
  m[0x20c1] = 0;
  yield* oneSecDelay(g);
  yield* printMessageDel(g, 0x3017, m[0x20ec] ? 0x1dab : 0x1cfa, 4);
  yield* printMessageDel(g, 0x2b14, 0x1daf, 0x0f);
  yield* oneSecDelay(g);
  yield* drawAdvTable(g);
  yield* twoSecDelay(g);
  if (!m[0x20ec]) {
    iniSplashAni(g, 0x1a95); yield* animate(g); // the little alien comes down to the upside-down Y
    iniSplashAni(g, 0x1bb0); yield* animate(g); // and drags it off
    yield* oneSecDelay(g);
    iniSplashAni(g, 0x1fc9); yield* animate(g); // and brings back a proper one
    yield* oneSecDelay(g);
    clearSmallSprite(g, 0x33b7, 0x0a);
    yield* twoSecDelay(g);
  }
  // the demo game
  yield* clearPlayField(g);
  if (!m[0x21ff]) { m[0x21ff] = shipsPerCredit(g); yield* takeShip(g); }
  blockCopy(g, 0x2000, 0x1b00, 0xc0);
  initAliens(g, 0x2100);
  drawShields(g, 0x2142);
  restoreShields1(g);
  yield* spend(g, (0xc0 + 4 * 0x2c) * T.copyByte + T.shields);
  m[0x20c1] = 1;
  drawBottomLine(g);
  yield* spend(g, T.bottomLine);
  for (;;) {
    plrFireOrDemo(g);
    yield* spend(g, 103);
    yield* playerShotHit(g);
    rackBump(g);
    yield* spend(g, 1042);
    checkHiddenMes(g);
    yield* spend(g, 79);
    if (m[0x2015] !== 0xff) break;
    yield* spend(g, 87);
  }
  m[0x2025] = 0;
  while (m[0x2015] !== 0xff) yield;
}

/** $0B89: "INSERT COIN" and the prices, and the alien shooting the extra C. */
function* credits(g) {
  const m = g.m;
  m[0x20c1] = 0;
  yield* oneSecDelay(g);
  yield* clearPlayField(g);
  yield* print(g, 0x2c11, 0x1f90, 0x0c);
  if (!m[0x20ec]) drawChar(g, 0x3311, 0x02); // "CCOIN"
  const p = readPriStruct(g, 0x1f9c);
  yield* printMessageDel(g, p.hl, p.de, m[0x206c]);
  if (!(g.inp(2) & 0x80)) {
    for (let bc = 0x1fa0; ; bc += 4) {
      const s = readPriStruct(g, bc);
      if (!s) break;
      yield* printMessageDel(g, s.hl, s.de, m[0x206c]);
    }
  }
  yield* twoSecDelay(g);
  if (!m[0x20ec]) {
    iniSplashAni(g, 0x1fd5);
    yield* animate(g);
    yield* shootExtraC(g);
  }
  m[0x20ec] = (m[0x20ec] + 1) & 1;
  yield* clearPlayField(g);
}

/** $1815: "*SCORE ADVANCE TABLE*" with its pictures and values. */
function* drawAdvTable(g) {
  const m = g.m;
  yield* print(g, 0x2810, 0x1ca3, 0x15);
  m[0x206c] = 0x0a;
  for (let bc = 0x1dbe; ; bc += 4) {
    const s = readPriStruct(g, bc);
    if (!s) break;
    drawSimpSprite(g, s.hl, s.de, 0x10);
  }
  for (let bc = 0x1dcf; ; bc += 4) {
    const s = readPriStruct(g, bc);
    if (!s) break;
    yield* printMessageDel(g, s.hl, s.de, m[0x206c]);
  }
}

/** $189E: the squiggly shot that knocks the extra C off "CCOIN". */
function* shootExtraC(g) {
  const m = g.m;
  blockCopy(g, 0x2050, 0x1bc0, 0x10);
  m[0x2080] = 2;
  m[0x207e] = 0xff;
  m[0x20c1] = 4;
  while (!(m[0x2055] & 1)) yield;
  while (m[0x2055] & 1) yield;
  drawChar(g, 0x3311, 0x26);
  yield* twoSecDelay(g);
}

/** $199A: the hidden "TAITO COP" message (two button combinations during the demo). */
function checkHiddenMes(g) {
  const m = g.m;
  if (!m[0x201e]) {
    if ((g.inp(1) & 0x76) !== 0x72) return;
    m[0x201e] = 1;
  }
  if ((g.inp(1) & 0x76) !== 0x34) return;
  printMessage(g, 0x2e1b, 0x0bf7, 9);
}

// ---- starting a game ----

/** $08D1: ships per game from the DIP switches. */
const shipsPerCredit = (g) => (g.inp(2) & 3) + 3;

/** $0765: "PRESS 1 OR 2PLAYERS BUTTON" (entered from the vblank interrupt when a coin goes in). */
export function* waitForStart(g) {
  const m = g.m;
  m[0x2093] = 1;
  m[0x20e9] = 0;
  drawNumCredits(g);
  printCredit(g);
  yield* clearPlayField(g);
  yield* print(g, 0x3013, 0x1ff3, 4);
  // a busy loop: the message is printed again on every pass
  for (;;) {
    if (m[0x20eb] === 1) {
      yield* print(g, 0x2810, 0x1acf, 0x14);
      if (g.inp(1) & 0x04) { yield* newGame(g, 0x99, 0); return; }
    } else {
      yield* print(g, 0x2810, 0x1aba, 0x14);
      const i = g.inp(1);
      if (i & 0x02) { yield* newGame(g, 0x98, 1); return; }
      if (i & 0x04) { yield* newGame(g, 0x99, 0); return; }
    }
  }
}

/** $079B: take the credits and set up both players. */
function* newGame(g, take, twoPlayers) {
  const m = g.m;
  m[0x20ce] = twoPlayers;
  m[0x20eb] = bcdAdd(m[0x20eb], take)[0];
  drawNumCredits(g);
  g.sw(0x20f8, 0);
  g.sw(0x20fc, 0);
  drawScore(g, 0x20f8);
  drawScore(g, 0x20fc);
  yield* spend(g, 10 * T.char);
  m[0x20e9] = 0;
  m[0x20ef] = 1;
  m[0x20e7] = m[0x20e8] = 1;
  m[0x20e5] = m[0x20e6] = 1;
  yield* drawStatus(g);
  drawShields(g, 0x2142);
  drawShields(g, 0x2242);
  yield* spend(g, 8 * 0x2c * T.copyByte);
  m[0x21ff] = m[0x22ff] = shipsPerCredit(g);
  m[0x21fb] = m[0x22fb] = 2;                 // $00D7: both racks start moving right
  if (!m[0x20ce]) clearSmallSprite(g, 0x391c, 0x20); // $08E4: no player 2 score
  yield* spend(g, 2100);
  m[0x21fe] = m[0x22fe] = 0;
  initAliens(g, 0x2100);
  initAliens(g, 0x2200);
  g.sw(0x21fc, 0x3878);
  g.sw(0x22fc, 0x3878);
  blockCopy(g, 0x2000, 0x1b00, 0xc0);
  yield* spend(g, (2 * 0x37 + 0xc0) * T.copyByte);
  yield* takeShip(g);
  yield* startTurn(g);
}

/** $07F9: "PLAY PLAYER<n>" with the score flashing, then into the game. */
function* startTurn(g) {
  yield* promptPlayer(g);
  yield* clearPlayField(g);
  yield* startRack(g);
}

/** $0800: bottom line, the player's shields and rack, and the game loop. */
function* startRack(g) {
  const m = g.m;
  m[0x20c1] = 0;
  drawBottomLine(g);
  if (m[0x2067] & 1) restoreShields1(g);
  else { restoreShields2(g); drawBottomLine(g); } // (player 2's line is drawn twice)
  yield* spend(g, (m[0x2067] & 1 ? 1 : 2) * T.bottomLine + T.shields);
  initRack(g);
  yield* gameLoop(g);
}

/** $088D */
function* promptPlayer(g) {
  const m = g.m;
  yield* print(g, 0x2b11, 0x1b70, 0x0e);
  if (!(m[0x2067] & 1)) drawChar(g, 0x3711, 0x1c);
  m[0x20c0] = 0xb0;
  for (;;) {
    const a = m[0x20c0];
    if (!a) return;
    if (a & 4) { clearSmallSprite(g, m[0x2067] & 1 ? 0x271c : 0x391c, 0x20); yield* spend(g, 2100); }
    else { drawScore(g, scoreDesc(g)); yield* spend(g, 4 * T.char); }
  }
}

/** $00B1: the game's rack from the player's saved position and direction. */
function initRack(g) {
  const m = g.m;
  const p = (m[0x2067] << 8) | 0xfc;
  const pos = g.w(p);
  g.sw(0x2009, pos);
  g.sw(0x200b, pos);
  let dx = m[p - 1];
  if (dx === 3) dx = 2;
  m[0x2008] = dx;
  m[0x200d] = dx === 0xfe ? 1 : 0;
}

// ---- the game loop ----

/** $0817 / $081F */
function* gameLoop(g) {
  const m = g.m;
  m[0x20e9] = 1;
  soundBits3On(g, 0x20);
  // each step is followed by the time it takes (measured with tools/emu/profile.mjs),
  // so the interrupts land between the steps much as they do on the original
  for (;;) {
    plrFireOrDemo(g);
    yield* spend(g, 129);
    yield* playerShotHit(g);
    rackBump(g);
    yield* spend(g, 1042);
    countAliens(g);
    yield* spend(g, 2584);
    const printed = adjustScore(g);
    yield* spend(g, printed ? 3460 : 107);
    if (m[0x2082] === 0) { yield* endOfRack(g); return; }
    aShotReloadRate(g);
    yield* spend(g, 173);
    extraShip(g);
    yield* spend(g, 214);
    if (m[0x2082] < 9) m[0x207e] = 0xfb; // $08D8: the last few aliens' shots fall faster
    if (m[0x2025]) soundBits3On(g, 0x02); else soundBits3Off(g, 0xfd); // $172C
    if (m[0x2015] !== 0xff) soundBits3On(g, 0x04);
    yield* spend(g, 150);
    fleetDelayExShip(g);
    yield* spend(g, 76);
    // $1804: the saucer's sound
    if (!m[0x2084]) soundBits3Off(g, 0xfe);
    else if (!m[0x2085]) soundBits3On(g, 0x01);
    yield* spend(g, 261);
  }
}

/** $1618: start the player's shot if fire is pressed (in the demo: always, and take the next move). */
function plrFireOrDemo(g) {
  const m = g.m;
  if (m[0x2015] !== 0xff) return;
  if (m[0x2010] | m[0x2011]) return;
  if (m[0x2025]) return;
  if (!m[0x20ef]) {
    m[0x2025] = 1;
    let p = g.w(0x20ed) + 1;
    if ((p & 0xff) >= 0x7e) p = (p & 0xff00) | 0x74;
    g.sw(0x20ed, p);
    m[0x201d] = m[p];
    return;
  }
  if (m[0x202d]) { if (!(readInputs(g) & 0x10)) m[0x202d] = 0; return; }
  if (!(readInputs(g) & 0x10)) return;
  m[0x2025] = 1;
  m[0x202d] = 1;
}

/** $14D8: what did the player's shot hit? */
function* playerShotHit(g) {
  const m = g.m;
  yield* spend(g, 70);
  if (m[0x2025] !== 2) return;
  const y = m[0x2029];
  miss: {
    if (y >= 0xd8) break miss;            // reached the top
    if (!m[0x2002]) return;               // no collision
    if (y >= 0xce) {                      // the saucer
      m[0x2085] = 1;
      m[0x2025] = 4;
      shotHitDone(g);
      return;
    }
    const b = (y + 6) & 0xff;
    const ref = m[0x2009];
    if (ref < 0x90 && ref >= b) break miss; // below the rack
    const r = findRow(g, b);
    const col = findColumn(g, m[0x202a]);
    g.sw(0x2064, (col.h << 8) | r.l);
    m[0x2025] = 5;
    const p = alienStatPtr(g, r.b, col.c);
    if (!m[p]) break miss;                // no alien there: it was an alien shot
    m[p] = 0;
    scoreForAlien(g, r.b);
    const d = readDesc(g, 0x2062);
    drawSprite(g, d.hl, d.de, d.b);
    yield* spend(g, 3260); // (the vblank handler can see the explosion flag before the timer is set)
    m[0x2003] = 0x10;
    return;
  }
  m[0x2025] = 3;
  shotHitDone(g);
}

function shotHitDone(g) {
  g.m[0x2002] = 0;
  soundBits3Off(g, 0xf7);
}

const rlc = (v) => ((v << 1) | (v >> 7)) & 0xff;

/** $1581 */
function alienStatPtr(g, b, c) {
  const a = (rlc(rlc(rlc(b))) + b + b + b + c - 1) & 0xff;
  return (g.m[0x2067] << 8) | a;
}

/** $0A5F: the explosion sound and the alien's points (not in the demo). */
function scoreForAlien(g, row) {
  const m = g.m;
  if (!m[0x20ef]) return;
  soundBits3On(g, 0x08);
  const hl = 0x1da0 + (row < 2 ? 0 : row < 4 ? 1 : 2);
  m[0x20f3] = 0;
  m[0x20f2] = m[hl];
  m[0x20f1] = 1;
}

/** $1597: turn the rack round and drop it when it touches either edge. */
function rackBump(g) {
  const m = g.m;
  let dir, dx;
  if (!m[0x200d]) {
    if (!edge(m, 0x3ea4)) return;
    dx = 0xfe; dir = 1;
  } else {
    if (!edge(m, 0x2524)) return;
    dx = m[0x2082] === 1 ? 3 : 2; dir = 0;
  }
  m[0x200d] = dir;
  m[0x2008] = dx;
  m[0x2007] = m[0x200e];
  // cheat: never come down onto the cannon
  if (g.assist.noLanding && m[0x20ef] && lowestAlienY(g) - 8 < 0x30) m[0x2007] = 0;
}

function edge(m, hl) {
  for (let i = 0; i < 0x17; i++) if (m[hl + i]) return true;
  return false;
}

function lowestAlienY(g) {
  const m = g.m, h = m[0x2067] << 8;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 11; col++) if (m[h | (row * 11 + col)]) return (m[0x2009] + row * 16) & 0xff;
  }
  return 0xff;
}

/** $15F3 */
function countAliens(g) {
  const m = g.m, h = m[0x2067] << 8;
  let c = 0;
  for (let i = 0; i < 0x37; i++) if (m[h | i]) c++;
  m[0x2082] = c;
  if (c === 1) m[0x206b] = 1;
}

/** $0988: add any points waiting in $20F2 to the active player's score and print it. */
function adjustScore(g) {
  const m = g.m;
  const hl = scoreDesc(g);
  if (!m[0x20f1]) return false;
  m[0x20f1] = 0;
  const [lo, c] = bcdAdd(m[hl], m[0x20f2]);
  m[hl] = lo;
  const [hi] = bcdAdd(m[hl + 1], m[0x20f3], c);
  m[hl + 1] = hi;
  print4Digits(g, g.w(hl + 2), (hi << 8) | lo);
  return true;
}

/** $170E: the aliens reload faster as the player's score goes up. */
function aShotReloadRate(g) {
  const m = g.m;
  const a = m[scoreDesc(g) + 1];
  let hl = 0x1aa1, de = 0x1cb8;
  for (let c = 4; c; c--) { if (m[de] >= a) break; hl++; de++; }
  m[0x20cf] = Math.min(0xff, Math.round(m[hl] * g.assist.reloadScale));
}

/** $1910: the active player's alive flag. */
const curPlyAlive = (g) => (g.m[0x2067] & 1 ? 0x20e7 : 0x20e8);
/** $18E7: the other player's alive flag. */
const otherPlyAlive = (g) => (g.m[0x2067] & 1 ? 0x20e8 : 0x20e7);

/** $0935: the extra ship at 1500 (or 1000). */
function extraShip(g) {
  const m = g.m;
  if (!m[curPlyAlive(g) - 2]) return;
  const b = g.inp(2) & 0x08 ? 0x10 : 0x15;
  if (m[scoreDesc(g) + 1] < b) return;
  const p = shipsPtr(g);
  m[p] = (m[p] + 1) & 0xff;
  const n = m[p];
  drawSimpSprite(g, (0x2501 + 0x200 * n) & 0xffff, 0x1c60, 0x10);
  printNumShips(g, n + 1);
  m[curPlyAlive(g) - 2] = 0;
  m[0x2099] = 0xff;
  soundBits3On(g, 0x10);
}

/** $1775: step the fleet's march note, and time out the extra-ship sound. */
function fleetDelayExShip(g) {
  const m = g.m;
  if (m[0x2095]) {
    let i = 0;
    while (m[0x2082] < m[0x1a11 + i]) i++;
    m[0x2097] = m[0x1a21 + i];
    const v = m[0x2098];
    let a = (v & 0x0f) << 1;
    if (a === 0x10) a = 1;
    m[0x2098] = a | (v & 0x30);
    m[0x2095] = 0;
  }
  if (--m[0x2099]) return;
  soundBits3Off(g, 0xef);
}

// ---- the end of a rack ----

/** $09EF: the rack is cleared; set up the next one lower down. */
function* endOfRack(g) {
  const m = g.m;
  yield* waitPlayerSafe(g);
  m[0x20e9] = 0;
  yield* clearPlayField(g);
  const msb = m[0x2067];
  blockCopy(g, 0x2000, 0x1b00, 0xc0);
  m[0x2067] = msb;
  const hl = (msb << 8) | 0xfe;
  const n = (m[hl] & 7) + 1;
  m[hl] = n;
  m[(msb << 8) | 0xfc] = m[0x1da2 + n];
  m[(msb << 8) | 0xfd] = 0x38;
  if (msb & 1) { drawShields(g, 0x2142); initAliens(g, 0x2100); }
  else { m[0x2098] = 0x21; drawShields(g, 0x2242); initAliens(g, 0x2200); }
  yield* spend(g, (0xc0 + 4 * 0x2c + 0x37) * T.copyByte);
  yield* startRack(g);
}

/** $0A3C: if the player is hit, wait for the explosion to finish (else a short pause). */
function* waitPlayerSafe(g) {
  const m = g.m;
  if (m[0x2015] === 0xff) {
    m[0x20c0] = 0x30;
    for (;;) {
      if (!m[0x20c0]) return;
      if (m[0x2015] !== 0xff) break;
      yield;
    }
  }
  while (m[0x2015] !== 0xff) yield;
}

// ---- losing a ship ----

/** $02D0: the player's explosion has finished (entered from the vblank interrupt). */
export function* playerDied(g) {
  const m = g.m;
  m[0x20e9] = 0;
  const p = shipsPtr(g);
  if (g.assist.unlimited && m[p] < 3) m[p] = 3; // cheat: never run out
  if (m[p] === 0) { printNumShips(g, 0); yield* gameOverPlayer(g); return; }
  if (!m[otherPlyAlive(g)] || !m[0x20ce]) {
    yield* takeShip(g);
    yield* gameLoop(g);
    return;
  }
  yield* switchPlayers(g);
}

/** $02ED: save this player's shields and rack and hand over to the other. */
function* switchPlayers(g) {
  const m = g.m;
  const msb = m[0x2067];
  if (msb & 1) rememberShields1(g); else rememberShields2(g);
  const p = (msb << 8) | 0xfc;
  m[p] = m[0x2009];
  m[p + 1] = m[0x200a];
  m[p - 1] = m[0x2008];
  blockCopy(g, 0x2000, 0x1b00, 0xc0);
  yield* spend(g, T.shields + 0xc0 * T.copyByte);
  const two = msb & 1;
  m[0x2067] = two ? 0x22 : 0x21;
  yield* twoSecDelay(g);
  m[0x2011] = 0;
  const cocktail = two ? 0x20 : 0;
  g.out5(cocktail);
  m[0x2098] = cocktail + 1;
  yield* clearPlayField(g);
  yield* takeShip(g);
  yield* startTurn(g);
}

/** $1971 / $16E6: the aliens have landed (entered from the mid-screen interrupt). */
export function* invaded(g) {
  const m = g.m;
  m[0x2015] = 0;
  for (;;) {
    yield* playerShotHit(g);
    soundBits3On(g, 0x04);
    if (m[0x2015] === 0xff) break;
    yield;
  }
  m[0x20e9] = 0;
  clearShips(g, 0x2701);
  printNumShips(g, 0);
  soundBits3Off(g, 0xfb);
  yield* gameOverPlayer(g);
}

/** $1671: this player is out: high score, "GAME OVER PLAYER<n>", maybe the other player's turn. */
function* gameOverPlayer(g) {
  const m = g.m;
  m[curPlyAlive(g)] = 0;
  const s = scoreDesc(g);
  const score = (m[s + 1] << 8) | m[s], hi = g.w(0x20f4);
  if (score > hi) { g.sw(0x20f4, score); printHiScore(g); }
  if (!m[0x20ce]) { yield* gameOver(g); return; }
  const hl = yield* printMessageDel(g, 0x2803, 0x1aa6, 0x14);
  drawChar(g, hl - 0x200, m[0x2067] & 1 ? 0x1b : 0x1c);
  yield* oneSecDelay(g);
  if (!m[otherPlyAlive(g)]) { yield* gameOver(g); return; }
  yield* switchPlayers(g);
}

/** $16C9: "GAME OVER", then back to the attract screens. */
function* gameOver(g) {
  const m = g.m;
  yield* printMessageDel(g, 0x2d18, 0x1aa6, 0x0a);
  yield* twoSecDelay(g);
  yield* clearPlayField(g);
  m[0x20ef] = 0;
  g.out5(0);
  m[0x20e9] = 1;
  yield* attract(g, true);
}

