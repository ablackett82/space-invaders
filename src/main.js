// Entry point: runs the engine at the arcade's 60 Hz and draws it. The title
// screen is the arcade's own attract mode; starting a game drops a coin in
// and presses the start button, as on the cabinet. The cheats, the saved
// high score and pausing live here, outside the engine.
import { Machine, FRAME_HZ, IN_COIN, IN_START1, IN_START2, IN_FIRE, IN_LEFT, IN_RIGHT } from './game/machine.js';
import { printHiScore } from './game/draw.js';
import { Screen, SCREEN_W, SCREEN_H, overlay as inkAt } from './render/screen.js';
import { Sound } from './render/audio.js';
import { Keyboard } from './input/keyboard.js';
import { Gamepad } from './input/gamepad.js';
import { Touch } from './input/touch.js';

const STEP = 1 / FRAME_HZ;
const MAX_CATCHUP = 0.1;
// difficulty: 0 the arcade exactly, 1 easy, 2 super easy
const LEVELS = [
  { name: 'NORMAL', speed: 1, reload: 1 },
  { name: 'EASY', speed: 0.75, reload: 2 },
  { name: 'SUPER EASY', speed: 0.6, reload: 2, invincible: true },
];
const CHEATS = ['unlimited', 'rapidFire', 'noLanding']; // (autoFire is a control option, not a cheat)
const STORE = 'invaders.';

const store = {
  get(k, d) { try { return localStorage.getItem(STORE + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(STORE + k, String(v)); } catch { /* storage blocked */ } },
};

const toBcd = (n) => parseInt(String(Math.min(n, 9999)), 16);
const fromBcd = (v) => Number(v.toString(16));

async function main() {
  const r = await fetch('data/tables.json');
  if (!r.ok) throw new Error(`data/tables.json: ${r.status}`);
  const tables = await r.json();

  const canvas = document.getElementById('screen');
  canvas.width = SCREEN_W; canvas.height = SCREEN_H;
  const ctx = canvas.getContext('2d', { alpha: false });
  const image = ctx.createImageData(SCREEN_W, SCREEN_H);
  const screen = new Screen();
  const sound = new Sound();
  const keyboard = new Keyboard();
  const gamepad = new Gamepad();
  const touch = new Touch(document.getElementById('touch'));

  let level = Math.min(2, Number(store.get('level', 0)) || 0);
  const cheats = { autoFire: store.get('autoFire', '1') === '1' };
  for (const c of CHEATS) cheats[c] = store.get(c, '0') === '1';
  let highScore = Number(store.get('highscore', 0)) || 0;
  let players = Number(store.get('players', 1)) === 2 ? 2 : 1;
  let paused = false, settingsOpen = false, assisted = false, wasPlaying = false;
  let starting = null;      // {players, t}: dropping the coins and pressing start
  let acc = 0, last = performance.now(), frameNo = 0;
  let g = boot();

  touch.setLevel(level);
  touch.setPlayers(players);
  touch.setCheats(cheats);
  touch.onPanelToggle = (open) => { settingsOpen = open; };
  touch.onPlayers = (n) => { players = n; store.set('players', n); };
  touch.onPause = (on) => { paused = on && inGame(); };
  touch.onRestart = () => restart();
  touch.onQuit = () => quit();
  touch.onLevel = (n) => setLevel(n);
  touch.onCheat = (name, on) => setCheat(name, on);
  touch.onSkip = () => skipWave();

  /** A machine switched on and running its attract mode, with the saved high score. */
  function boot() {
    const m = new Machine(tables);
    m.sw(0x20f4, toBcd(highScore));
    printHiScore(m);
    return m;
  }

  const inGame = () => g.m[0x20ef] === 1;
  const playing = () => inGame() || !!starting;
  const isAssisted = () => level > 0 || CHEATS.some((c) => cheats[c]);

  function applyAssists() {
    const L = LEVELS[level];
    g.assist.invincible = !!L.invincible;
    g.assist.reloadScale = L.reload;
    g.assist.unlimited = cheats.unlimited;
    g.assist.rapidFire = cheats.rapidFire;
    g.assist.noLanding = cheats.noLanding;
  }
  applyAssists();

  function setLevel(n) {
    level = n;
    store.set('level', n);
    touch.setLevel(n);
    if (playing()) assisted ||= isAssisted();
    applyAssists();
  }

  function setCheat(name, on) {
    cheats[name] = on;
    store.set(name, on ? 1 : 0);
    touch.setCheats(cheats);
    if (playing()) assisted ||= isAssisted();
    applyAssists();
  }

  /** Skip wave: every alien in the rack dies at once (not while something is exploding). */
  function skipWave() {
    const m = g.m;
    if (!inGame() || !m[0x2068] || m[0x2002] || m[0x20e9] !== 1) return;
    assisted = true;
    m.fill(0, m[0x2067] << 8, (m[0x2067] << 8) + 0x37);
  }

  function startGame(n) {
    if (playing()) return;
    // after a game the program won't take a coin until its demo has reset
    // the start-button flag; a fresh machine takes one straight away
    if (g.m[0x2093]) { g = boot(); applyAssists(); }
    starting = { players: n, t: 0 };
    assisted = isAssisted();
    touch.release();
    sound.unlock();
  }

  /** The coin and start button presses for a game being started. */
  function startInputs(in1) {
    const s = starting;
    if (!s) return in1;
    const m = g.m, t = s.t++;
    // each coin: four frames in the slot switch, then eight out (the credit
    // counts when the switch opens)
    const c = t - 2;
    if (c >= 0 && Math.floor(c / 12) < s.players && c % 12 < 4) in1 |= IN_COIN;
    if (c >= s.players * 12 && m[0x2093] === 1 && !m[0x20ef]) in1 |= s.players === 2 ? IN_START2 : IN_START1;
    if (m[0x20ef] || t > 900) starting = null;
    return in1;
  }

  window.__inv = { get g() { return g; }, sound, touch }; // debug handle

  // ---- input ----
  const input = { left: false, right: false, fire: false };
  function readInput() {
    for (const k in input) input[k] = false;
    keyboard.read(input);
    gamepad.read(input);
    if (keyboard.any || gamepad.any) touch.notifyOtherInput();
    touch.read(input);
    let fire = input.fire;
    if (fire && cheats.autoFire) fire = frameNo % 8 < 4; // tap the button for them
    let bits = 0;
    if (input.left && !input.right) bits |= IN_LEFT;
    if (input.right && !input.left) bits |= IN_RIGHT;
    if (fire) bits |= IN_FIRE;
    return bits;
  }

  function step(bits) {
    // player 2 plays on the same controls (port 2 has the same bits, over DIP switches all off)
    const in1 = startInputs(bits);
    g.frame(in1, bits);
    frameNo++;
    const now = inGame();
    if (wasPlaying && !now) gameOver();
    wasPlaying = now;
  }

  function gameOver() {
    const hs = fromBcd(g.w(0x20f4));
    if (!assisted && hs > highScore) { highScore = hs; store.set('highscore', highScore); }
    if (assisted) {
      // a cheat game's score doesn't count: put the saved high score back
      g.sw(0x20f4, toBcd(highScore));
      printHiScore(g);
    }
    assisted = false;
    touch.release();
  }

  function quit() {
    if (inGame()) gameOver();
    g = boot();
    applyAssists();
    starting = null;
    wasPlaying = false;
    paused = false;
    sound.stopAll();
  }

  /** Back to the title and straight into a new game with the same players. */
  function restart() {
    const n = inGame() ? (g.m[0x20ce] ? 2 : 1) : players;
    quit();
    startGame(n);
  }

  // ---- text over the picture, in the game's own font ----
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<> =*';
  function text(x, y, s, colour) {
    const out = image.data, m = g.m;
    for (let i = 0; i < s.length; i++) {
      const code = s[i] === '-' ? 0x3f : CHARS.indexOf(s[i]);
      if (code < 0) continue;
      for (let col = 0; col < 8; col++) {
        const bits = m[0x1e00 + code * 8 + col];
        for (let row = 0; row < 8; row++) {
          const px = x + i * 8 + col, py = y + row;
          if (px < 0 || px >= SCREEN_W || py < 0 || py >= SCREEN_H) continue;
          const on = (bits >> (7 - row)) & 1;
          const c = on ? colour || inkAt(px, py) : [0, 0, 0];
          const p = (py * SCREEN_W + px) * 4;
          out[p] = c[0]; out[p + 1] = c[1]; out[p + 2] = c[2];
        }
      }
    }
  }
  const centred = (y, s, colour) => text(Math.floor((SCREEN_W - s.length * 8) / 2), y, s, colour);

  function drawOverlay() {
    if (playing()) {
      // the cheats in force, on the empty top line
      const tags = [];
      if (level) tags.push(level === 2 ? 'SUPER EASY' : 'EASY');
      if (cheats.unlimited) tags.push('INF');
      if (cheats.noLanding) tags.push('SAFE');
      if (cheats.rapidFire) tags.push('RAPID');
      if (tags.length) centred(0, tags.join(' '), [120, 255, 120]);
      return;
    }
    if (frameNo & 32) return;
    const tap = touch.active;
    centred(226, tap ? (players === 2 ? 'TAP FOR 2 PLAYERS' : 'TAP TO START') : 'PRESS SPACE TO START', [255, 255, 255]);
  }

  // ---- layout ----
  function fit() {
    const stage = document.getElementById('stage');
    const vw = stage.clientWidth, vh = stage.clientHeight;
    const portrait = vh > vw;
    const availH = portrait && touch.active ? Math.max(vh * 0.6, vh - touch.reserved) : vh;
    const scale = Math.min(vw / SCREEN_W, availH / SCREEN_H);
    const s = scale >= 1 ? Math.floor(scale * 4) / 4 : scale;
    canvas.style.width = `${Math.round(SCREEN_W * s)}px`;
    canvas.style.height = `${Math.round(SCREEN_H * s)}px`;
    stage.classList.toggle('top', portrait && touch.active);
  }
  window.addEventListener('resize', fit);
  touch.onLayout = fit;
  fit();

  function frame(now) {
    const dt = Math.min(MAX_CATCHUP, (now - last) / 1000);
    last = now;
    const bits = readInput();

    if (keyboard.consume('KeyF')) toggleFullscreen();
    if (keyboard.consume('KeyM')) sound.setMuted(!sound.muted);
    if (keyboard.consume('KeyC')) setLevel((level + 1) % LEVELS.length);
    if (keyboard.consume('KeyL')) setCheat('unlimited', !cheats.unlimited);
    if (keyboard.consume('KeyR')) setCheat('rapidFire', !cheats.rapidFire);
    if (keyboard.consume('KeyG')) setCheat('noLanding', !cheats.noLanding);
    if (keyboard.consume('KeyN')) skipWave();
    if (keyboard.consume('Escape')) quit();
    if (keyboard.consume('KeyP') && inGame()) { paused = !paused; touch.notifyOtherInput(); }
    const start1 = keyboard.consume('Space', 'Enter', 'Digit1');
    const start2 = keyboard.consume('Digit2');
    const startTap = touch.consumeStart() || gamepad.startPressed;
    if (!playing()) {
      if (start2) startGame(2);
      else if (startTap) startGame(players);
      else if (start1) startGame(1);
    }

    if (!inGame()) paused = false;
    touch.setPlayState(inGame(), paused);
    if (!paused && !settingsOpen) {
      acc += dt;
      const stepT = STEP / (inGame() ? LEVELS[level].speed : 1);
      while (acc >= stepT) { step(bits); acc -= stepT; }
      sound.update(g);
    } else sound.stopAll();
    image.data.set(screen.draw(g.m));
    drawOverlay();
    ctx.putImageData(image, 0, 0);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // audio can only start from a user gesture on iOS (touchend and click are the
  // ones a home-screen app reliably counts)
  for (const ev of ['keydown', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'click']) window.addEventListener(ev, () => sound.unlock(), { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && inGame()) paused = true;
    if (!document.hidden) sound.unlock();
  });
}

function toggleFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement) el.requestFullscreen?.();
  else document.exitFullscreen?.();
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f55;padding:1em">${err.stack || err}</pre>`);
});
