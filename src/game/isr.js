// The two interrupt handlers and everything they run: the alien rack (one
// alien drawn per frame), the game objects (the player, the player's shot,
// the three alien shots and the saucer), the saucer timer, the fleet sound
// timer and the splash-screen animations.
import { Restart } from './machine.js';
import {
  readDesc, blockCopy, convToScr, drawSimpSprite, clearSmallSprite, drawShiftedSprite, eraseShifted,
  drawSprCollision, drawSprite, eraseSimpleSprite, printMessage, drawNumCredits, bcdAdd, scoreDesc,
} from './draw.js';
import { waitForStart, playerDied, invaded } from './flow.js';

/** $008C: scanline 96. Objects in the top half of the picture, then the rack cursor. */
export function isrMid(g) {
  const m = g.m;
  g.t += 206;
  m[0x2072] = 0;
  if (!m[0x20e9]) return;
  if (!m[0x20ef] && !(m[0x20c1] & 1)) return;
  runGameObjs(g, 0x2020);
  cursorNextAlien(g);
}

/** $0010: vblank. The pause timer, the coin slot, then the game (or splash) work. */
export function isrVblank(g) {
  const m = g.m;
  g.t += 407;
  m[0x2072] = 0x80;
  m[0x20c0] = (m[0x20c0] - 1) & 0xff;
  if (g.inp(1) & 1) m[0x20ea] = 1;
  else if (m[0x20ea]) {
    if (m[0x20eb] !== 0x99) { m[0x20eb] = bcdAdd(m[0x20eb], 1)[0]; drawNumCredits(g); }
    m[0x20ea] = 0;
  }
  if (!m[0x20e9]) return;
  if (m[0x20ef]) { timeFleetSound(g); gameTick(g); return; }
  if (m[0x20eb]) {
    if (m[0x2093]) return;
    throw new Restart(waitForStart);
  }
  isrSplTasks(g);
}

/** $0072: the vblank game work (also the demo game's, without the fleet sound). */
function gameTick(g) {
  const m = g.m;
  m[0x2080] = m[0x2032];
  drawAlien(g);
  runGameObjs(g, 0x2010);
  timeToSaucer(g);
}

/** $0ABF */
function isrSplTasks(g) {
  const t = g.m[0x20c1];
  if (t & 1) gameTick(g);
  else if (t & 2) splashSprite(g);
  else if (t & 4) runGameObjs(g, 0x2050);
}

// ---- game objects ----

const HANDLERS = {
  0x028e: gameObj0, 0x03bb: gameObj1, 0x0476: gameObj2, 0x04b6: gameObj3, 0x0682: gameObj4, 0x050e: squigglyShot,
};

/** $024B: run the 16-byte game object list from hl to the $FF marker. */
function runGameObjs(g, hl) {
  const m = g.m;
  for (;; hl += 0x10) {
    g.t += 60;
    const a = m[hl];
    if (a === 0xff) return;
    if (a === 0xfe) continue;
    const b = m[hl + 1];
    if (a | b) {             // a two-byte countdown, MSB first
      if (b === 0) m[hl] = (a - 1) & 0xff;
      m[hl + 1] = (b - 1) & 0xff;
      continue;
    }
    if (m[hl + 2]) { m[hl + 2]--; continue; }
    const handler = HANDLERS[g.w(hl + 3)];
    if (!handler) throw new Error(`no game object handler ${g.w(hl + 3).toString(16)}`);
    g.t += 390;
    handler(g, hl + 4);
  }
}

/** $1A06: true if the object (x coordinate at a) is on the half of the screen the beam has left. */
const compYToBeam = (g, a) => ((g.m[a] & 0x80) ^ g.m[0x2072]) === 0;

/** $028E: game object 0, the player's cannon. */
function gameObj0(g) {
  const m = g.m;
  g.t += 250;
  const a = m[0x2015];
  if (a !== 0xff) {
    // blowing up
    if (--m[0x2016]) return;
    m[0x2068] = 0;
    m[0x2069] = 0;
    m[0x206a] = 0x30;
    m[0x2016] = 5;
    if (--m[0x2017]) { drawPlayerDie(g, a); return; }
    eraseSimpleSprite(g, g.w(0x201a), 0x10);
    blockCopy(g, 0x2010, 0x1b10, 0x10);
    soundBits3Off(g, 0x00);
    if (m[0x206d]) return;
    if (!m[0x20ef]) return;
    throw new Restart(playerDied);
  }
  m[0x2068] = 1;
  if (!m[0x2069] && --m[0x206a] === 0) m[0x2069] = 1;
  const x = m[0x201b];
  let right, left;
  if (m[0x20ef]) { const i = readInputs(g); right = i & 0x40; left = i & 0x20; }
  else { const c = m[0x201d]; right = c & 1; left = c & 2; }
  if (right) { if (x !== 0xd9) m[0x201b] = x + 1; }
  else if (left) { if (x !== 0x30) m[0x201b] = x - 1; }
  drawPlayer(g);
}

/** $036F */
function drawPlayer(g) {
  const d = readDesc(g, 0x2018);
  drawSimpSprite(g, convToScr(d.hl), d.de, d.b);
  g.m[0x2012] = 0;
}

/** $039B: alternate the two explosion pictures. */
function drawPlayerDie(g, a) {
  a = (a + 1) & 1;
  g.m[0x2015] = a;
  g.sw(0x2018, 0x1c70 + a * 16);
  drawPlayer(g);
}

/** $17C0: the active player's controls. */
export const readInputs = (g) => g.inp(g.m[0x2067] & 1 ? 1 : 2);

const readPlyShot = (g) => readDesc(g, 0x2027);

/** $03BB: game object 1, the player's shot. */
function gameObj1(g) {
  const m = g.m;
  if (!compYToBeam(g, 0x202a)) return;
  const a = m[0x2025];
  if (!a) return;
  if (a === 1) {
    m[0x2025] = 2;
    m[0x202a] = (m[0x201b] + 8) & 0xff;
    drawShiftedSprite(g, readPlyShot(g));
  } else if (a === 2) {
    movePlyShot(g);
    // cheat: the shot flies at twice the speed (a second step unless it hit something)
    if (g.assist.rapidFire && !m[0x2061] && m[0x2025] === 2 && m[0x2029] < 0xd8) movePlyShot(g);
  } else if (a === 3) {
    if (--m[0x2026] === 0) { endOfBlowup(g); return; }
    if (m[0x2026] !== 0x0f) return;
    eraseShifted(g, readPlyShot(g));
    m[0x2027]++;
    m[0x2029] = (m[0x2029] - 2) & 0xff;
    m[0x202a] = (m[0x202a] - 3) & 0xff;
    m[0x202b] = 8;
    drawShiftedSprite(g, readPlyShot(g));
  } else if (a !== 5) endOfBlowup(g);
}

/** $040A */
function movePlyShot(g) {
  const m = g.m;
  const d = readPlyShot(g);
  eraseShifted(g, d);
  const y = (m[0x202c] + (d.hl & 0xff)) & 0xff;
  m[0x2029] = y;
  drawSprCollision(g, { de: d.de, hl: (d.hl & 0xff00) | y, b: d.b });
  if (m[0x2061]) m[0x2002] = m[0x2061];
}

/** $0436: remove the shot; advance the saucer score pointer and set the next saucer's direction. */
function endOfBlowup(g) {
  const m = g.m;
  eraseShifted(g, readPlyShot(g));
  blockCopy(g, 0x2025, 0x1b25, 7);
  let l = (m[0x208d] + 1) & 0xff;
  if (l >= 0x63) l = 0x54;
  m[0x208d] = l;
  m[0x208f] = (m[0x208f] + 1) & 0xff;
  if (m[0x2084]) return;
  // the program means to use bit 0 of the shot count, but reads the byte the count
  // points at: with $2090 = $08 that is a byte of the program itself at $08xx
  const right = saucerDirection(g, g.w(0x208f));
  m[0x208a] = right ? 0x29 : 0xe0;
  m[0x208c] = right ? 0x02 : 0xfe;
}

function saucerDirection(g, a) {
  if (a >= 0x2000) return g.m[a & 0x3fff] & 1;
  if (a >= 0x0800 && a < 0x0900) return g.saucerBits.charCodeAt(a - 0x0800) - 48;
  return g.m[a] & 1;
}

/** $0550 / $055B: the shot being processed is copied to $2073 and back. */
function toShotStruct(g, de, picEnd) { g.t += 100; g.m[0x207f] = picEnd; blockCopy(g, 0x2073, de, 0x0b); }
function fromShotStruct(g, hl) { blockCopy(g, hl, 0x2073, 0x0b); }

/** $0476: game object 2, the rolling shot (aimed at the player). */
function gameObj2(g) {
  const m = g.m;
  m[0x2032] = m[0x1b32];
  if (g.w(0x2038) === 0) { g.sw(0x2038, 0xffff); return; }
  toShotStruct(g, 0x2035, 0xf9);
  m[0x2070] = m[0x2046];
  m[0x2071] = m[0x2056];
  handleAlienShot(g);
  if (m[0x2078]) { fromShotStruct(g, 0x2035); return; }
  blockCopy(g, 0x2030, 0x1b30, 0x10);
}

/** $04B6: game object 3, the plunger shot. */
function gameObj3(g) {
  const m = g.m;
  if (m[0x206e]) return;
  if (m[0x2080] !== 1) return;
  toShotStruct(g, 0x2045, 0xed);
  m[0x2070] = m[0x2036];
  m[0x2071] = m[0x2056];
  handleAlienShot(g);
  if (m[0x2076] >= 0x10) m[0x2076] = m[0x1b48];
  if (m[0x2078]) { fromShotStruct(g, 0x2045); return; }
  blockCopy(g, 0x2040, 0x1b40, 0x10);
  if (m[0x2082] === 1) m[0x206e] = 1;
  g.sw(0x2048, g.w(0x2076));
}

/** $050F: the squiggly shot (game object 4 when there's no saucer). */
function squigglyShot(g) {
  const m = g.m;
  toShotStruct(g, 0x2055, 0xdb);
  m[0x2070] = m[0x2046];
  m[0x2071] = m[0x2036];
  handleAlienShot(g);
  if (m[0x2076] >= 0x15) m[0x2076] = m[0x1b58];
  if (m[0x2078]) { fromShotStruct(g, 0x2055); return; }
  blockCopy(g, 0x2050, 0x1b50, 0x10);
  g.sw(0x2058, g.w(0x2076));
}

/** $0563: start, move or blow up the alien shot in $2073. */
function handleAlienShot(g) {
  const m = g.m;
  g.t += 250;
  if (!(m[0x2073] & 0x80)) {
    if (m[0x20c1] !== 4) {
      if (!m[0x2069]) return;
      m[0x2074] = 0;
      // too soon after another shot?
      for (const a of [m[0x2070], m[0x2071]]) if (a && m[0x20cf] >= a) return;
      let col;
      if (m[0x2075] === 0) {
        col = findColumn(g, (m[0x201b] + 8) & 0xff).c;
        if (col >= 0x0c) col = 0x0b;
      } else {
        const p = g.w(0x2076);
        col = m[p];
        g.sw(0x2076, p + 1);
      }
      const idx = findInColumn(g, col);
      if (idx < 0) return;
      const { l, c } = getAlienCoords(g, idx);
      g.sw(0x207b, (((c + 7) & 0xff) << 8) | ((l - 0x0a) & 0xff));
    }
    m[0x2073] |= 0x80;
    m[0x2074]++;
    return;
  }
  if (!compYToBeam(g, 0x207c)) return;
  if (m[0x2073] & 1) { shotBlowingUp(g); return; }
  m[0x2074]++;
  eraseAlienShot(g);
  let pic = (m[0x2079] + 3) & 0xff;
  if (pic >= m[0x207f]) pic = (pic - 0x0c) & 0xff;
  m[0x2079] = pic;
  m[0x207b] = (m[0x207b] + m[0x207e]) & 0xff;
  drawAlienShot(g);
  const y = m[0x207b];
  if (y >= 0x15) {
    if (!m[0x2061]) return;
    if (y >= 0x1e && y < 0x27 && !g.assist.invincible) m[0x2015] = 0; // hit the player
  }
  m[0x2073] |= 1;
}

const drawAlienShot = (g) => drawSprCollision(g, readDesc(g, 0x2079));
const eraseAlienShot = (g) => eraseShifted(g, readDesc(g, 0x2079));

/** $0644 */
function shotBlowingUp(g) {
  const m = g.m;
  const a = --m[0x2078];
  if (a === 3) {
    eraseAlienShot(g);
    g.sw(0x2079, 0x1cdc);
    m[0x207c] = (m[0x207c] - 2) & 0xff;
    m[0x207b] = (m[0x207b] - 2) & 0xff;
    m[0x207d] = 6;
    drawAlienShot(g);
  } else if (a === 0) eraseAlienShot(g);
}

/** $062F: index of the lowest live alien in column c (1-11), or -1. */
function findInColumn(g, c) {
  const m = g.m, h = m[0x2067] << 8;
  let l = (c - 1) & 0xff;
  for (let d = 5; d; d--) {
    if (m[h | l]) return l;
    l = (l + 0x0b) & 0xff;
  }
  return -1;
}

/** $0682: game object 4, the saucer (or the squiggly shot). */
function gameObj4(g) {
  const m = g.m;
  if (m[0x2080] !== 2) return;
  if (!m[0x2083] || m[0x2056]) { squigglyShot(g); return; }
  if (!m[0x2084]) {
    if (m[0x2082] < 8) { squigglyShot(g); return; }
    m[0x2084] = 1;
    drawSaucer(g);
  }
  if (!compYToBeam(g, 0x208a)) return;
  if (m[0x2085]) { saucerHit(g); return; }
  m[0x208a] = (m[0x208a] + m[0x208c]) & 0xff;
  drawSaucer(g);
  if (m[0x208a] < 0x28 || m[0x208a] >= 0xe1) removeSaucer(g);
}

/** $0742: the saucer's descriptor with the position as a screen address. */
function saucerDesc(g) {
  const d = readDesc(g, 0x2087);
  d.hl = convToScr(d.hl);
  return d;
}
function drawSaucer(g) { const d = saucerDesc(g); drawSimpSprite(g, d.hl, d.de, d.b); }

/** $06F9 */
function removeSaucer(g) {
  const d = saucerDesc(g);
  clearSmallSprite(g, d.hl, d.b);
  blockCopy(g, 0x2083, 0x1b83, 0x0a);
  soundBits3Off(g, 0xfe);
}

/** $06D6: the saucer's explosion, then its score, then gone. */
function saucerHit(g) {
  const m = g.m;
  soundBits3Off(g, 0xfe);
  const a = --m[0x2086];
  if (a === 0x1f) {
    m[0x2098] |= 0x10;
    g.out5(m[0x2098] & 0x30);
    g.sw(0x2087, 0x1d7c);
    drawSaucer(g);
  } else if (a === 0x18) {
    m[0x20f1] = 1;
    const b = m[g.w(0x208d)];
    let hl = 0x1d50, de = 0x1d4c;
    for (let c = 4; c; c--) { if (m[de] === b) break; hl++; de++; }
    m[0x2087] = m[hl];
    g.sw(0x20f2, b * 16);
    const d = saucerDesc(g);
    printMessage(g, d.hl, d.de, 3);
  } else if (a === 0) {
    m[0x2098] &= 0xef;
    g.out5(m[0x2098] & 0x20);
    removeSaucer(g);
  }
}

// ---- the alien rack ----

/** $0100: draw the alien under the cursor (or time an explosion). */
function drawAlien(g) {
  const m = g.m;
  g.t += 150;
  if (m[0x2002]) { aExplodeTime(g); return; }
  if (m[(m[0x2067] << 8) | m[0x2006]]) {
    let de = 0x1c00 + (m[0x2004] & 0xfe) * 8;
    if (m[0x2005]) de += 0x30;
    drawSprite(g, g.w(0x200b), de, 0x10);
  }
  m[0x2000] = 0;
}

/** $1538 */
function aExplodeTime(g) {
  const m = g.m;
  if (--m[0x2003]) return;
  eraseSimpleSprite(g, g.w(0x2064), 0x10);
  m[0x2025] = 4;
  m[0x2002] = 0;
  soundBits3Off(g, 0xf7);
}

/** $0141: move the cursor to the next live alien; past the last, move the rack. */
function cursorNextAlien(g) {
  const m = g.m;
  if (!m[0x2068]) return;
  if (m[0x2000]) return;
  const h = m[0x2067] << 8;
  let a = m[0x2006], d = 2;
  g.t += 150;
  for (;;) {
    g.t += 45;
    a = (a + 1) & 0xff;
    if (a === 0x37) {
      if (--d === 0) return; // no aliens left
      moveRefAlien(g);
      a = 0;
    }
    if (m[h | a] === 1) break;
  }
  m[0x2006] = a;
  const { l, c, d: row } = getAlienCoords(g, a);
  g.sw(0x200b, (c << 8) | l);
  if (l < 0x28) {
    m[0x206d] = 1;
    throw new Restart(invaded);
  }
  m[0x2004] = row;
  m[0x2000] = 1;
}

/** $01A1: move the reference alien by its deltas and flip the animation frame. */
function moveRefAlien(g) {
  const m = g.m;
  m[0x2006] = 0;
  const dy = m[0x2007];
  m[0x2007] = 0;
  addDelta(g, 0x2007, dy);
  m[0x2005] = (m[0x2005] + 1) & 1;
}

/** $01D9: add c and [hl+1] to [hl+2] and [hl+3]; returns the new [hl+3]. */
function addDelta(g, hl, c) {
  const m = g.m;
  const b = m[hl + 1];
  m[hl + 2] = (m[hl + 2] + c) & 0xff;
  m[hl + 3] = (m[hl + 3] + b) & 0xff;
  return m[hl + 3];
}

/** $017A: an alien's position (l = y, c = x) and row (d) from its index. */
export function getAlienCoords(g, a) {
  let b = g.m[0x2009], c = g.m[0x200a], d = 0;
  while (((a - 0x0b) & 0x80) === 0) { a = (a - 0x0b) & 0xff; b = (b + 0x10) & 0xff; d++; }
  while (a) { c = (c + 0x10) & 0xff; a--; }
  return { l: b, c, d };
}

/** $1554: count the 16s that take a up to h; returns the final a and the count. */
function cnt16s(a, h) {
  let c = 0;
  if (a >= h) do { c++; a = (a + 0x10) & 0xff; } while (a & 0x80);
  while (a < h) { a = (a + 0x10) & 0xff; c++; }
  return { a, c };
}

/** $1562: the rack row for a y coordinate: b = row number, l = that row's y. */
export function findRow(g, l) {
  const { a, c } = cnt16s(g.m[0x2009], l);
  return { b: (c - 1) & 0xff, l: (a - 0x10) & 0xff };
}

/** $156F: the rack column for an x coordinate: c = column number (from 1), h = its x. */
export function findColumn(g, h) {
  const { a, c } = cnt16s(g.m[0x200a], h);
  return { c, h: (a - 0x10) & 0xff };
}

/** $0913: count down to the next saucer (only once the rack has come down from its first height). */
function timeToSaucer(g) {
  const m = g.m;
  if (m[0x2009] >= 0x78) return;
  let t = g.w(0x2091);
  if (t === 0) { t = 0x600; m[0x2083] = 1; }
  g.sw(0x2091, t - 1);
}

// ---- sound ----

/** $18FA / $19DC */
export function soundBits3On(g, b) { g.m[0x2094] |= b; g.out3(g.m[0x2094]); }
export function soundBits3Off(g, b) { g.m[0x2094] &= b; g.out3(g.m[0x2094]); }

/** $176D */
export function fleetSoundOff(g) { g.out5(g.m[0x2098] & 0x30); }

/** $1740: time the fleet's four-note march. */
function timeFleetSound(g) {
  const m = g.m;
  if (--m[0x209b] === 0) fleetSoundOff(g);
  if (!m[0x2068]) { fleetSoundOff(g); return; }
  if (--m[0x2096]) return;
  g.out5(m[0x2098]);
  if (!m[0x2082]) { fleetSoundOff(g); return; }
  m[0x2096] = m[0x2097];
  m[0x2095] = 1;
  m[0x209b] = 4;
}

// ---- splash animations ----

/** $1868: move the splash sprite a step towards its target. */
function splashSprite(g) {
  const m = g.m;
  m[0x20c2]++;
  const y = addDelta(g, 0x20c3, m[0x20c3]);
  if (m[0x20ca] === y) { m[0x20cb] = 1; return; }
  let img = g.w(0x20cc);
  if (!(m[0x20c2] & 4)) img += 0x30;
  g.sw(0x20c7, img);
  drawSprite(g, g.w(0x20c5), g.w(0x20c7), m[0x20c9]);
}

