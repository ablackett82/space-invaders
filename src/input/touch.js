// Touch controls for iPad. One half of the screen moves the cannon, the other
// half fires; every finger is tracked on its own (Pointer Events), so one
// thumb can hold left or right while the other taps fire. Nothing latches: an
// input is live exactly while a finger is on it.
//
// Two layouts for the moving half:
//   buttons - a fixed left/right pad in the bottom corner; the whole half of
//             the screen belongs to it, and the side of its centre a finger is
//             on decides the direction.
//   stick   - floating: the centre is wherever the thumb lands, and slides
//             along if the thumb goes past the end.
// A quick tap anywhere starts a game (consumeStart).
//
// Visibility: 'auto' shows the controls on the first touch and hides them as
// soon as a keyboard or gamepad is used; 'on' / 'off' force it.

const STORE_KEY = 'invaders.touch';
const DEFAULTS = { enabled: 'auto', layout: 'buttons', size: 1, opacity: 0.4, swap: false };
const DEAD = 0.12;   // fraction of the pad's half-width that counts as neither way

export class Touch {
  constructor(el) {
    this.el = el;
    this.settings = { ...DEFAULTS, ...load() };
    this.pointers = new Map(); // id -> { kind: 'move'|'fire', cx, x, t }
    this.startTapped = false;
    this.seenTouch = false;
    this.otherInputSeen = false;
    this.stickX = null;
    this.state = { left: false, right: false, fire: false };
    this.buildOverlay();
    this.bindEvents();
    this.applySettings();
    window.addEventListener('resize', () => this.layout());
  }

  get active() {
    const e = this.settings.enabled;
    return e === 'on' || (e === 'auto' && this.seenTouch && !this.otherInputSeen);
  }

  /** Called by the main loop when a keyboard/gamepad input is live. */
  notifyOtherInput() {
    if (!this.otherInputSeen) { this.otherInputSeen = true; this.applySettings(); }
  }

  read(into) {
    if (this.settings.enabled === 'off') return;
    for (const k in this.state) if (this.state[k]) into[k] = true;
  }

  /** Let go of everything (a new game, a menu opening). */
  release() { this.pointers.clear(); this.stickX = null; this.recompute(); }

  /** True once per tap (used for "tap to start"). */
  consumeStart() {
    const t = this.startTapped; this.startTapped = false; return t;
  }

  bindEvents() {
    const el = this.el;
    const opts = { passive: false };
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      if (!this.seenTouch || this.otherInputSeen) { this.seenTouch = true; this.otherInputSeen = false; this.applySettings(); }
      try { el.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
      this.down(e.pointerId, e.clientX);
    }, opts);
    el.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      e.preventDefault();
      this.move(e.pointerId, e.clientX);
    }, opts);
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      el.addEventListener(ev, (e) => this.up(e.pointerId, ev === 'pointerup'), opts);
    }
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => this.release());
  }

  down(id, x) {
    const g = this.geom;
    const moveSide = this.settings.swap ? x > g.mid : x < g.mid;
    const t = performance.now();
    if (!moveSide || this.settings.enabled === 'off') { this.pointers.set(id, { kind: 'fire', x, t }); this.recompute(); return; }
    const stick = this.settings.layout === 'stick';
    this.pointers.set(id, { kind: 'move', cx: stick ? x : g.padX, x, t });
    if (stick) this.stickX = x;
    this.recompute();
  }

  move(id, x) {
    const p = this.pointers.get(id);
    p.x = x;
    if (p.kind === 'move' && this.settings.layout === 'stick') {
      const R = this.geom.padW / 2, dx = x - p.cx;
      if (Math.abs(dx) > R) { p.cx = x - Math.sign(dx) * R; this.stickX = p.cx; }
    }
    this.recompute();
  }

  up(id, lifted) {
    const p = this.pointers.get(id);
    if (!p) return;
    this.pointers.delete(id);
    if (lifted && performance.now() - p.t < 400) this.startTapped = true;
    if (![...this.pointers.values()].some((q) => q.kind === 'move')) this.stickX = null;
    this.recompute();
  }

  /** Derive left / right / fire from every live finger. */
  recompute() {
    const s = this.state;
    s.left = s.right = s.fire = false;
    const R = this.geom.padW / 2;
    for (const p of this.pointers.values()) {
      if (p.kind === 'fire') { s.fire = true; continue; }
      const dx = p.x - p.cx;
      if (dx < -R * DEAD) s.left = true;
      else if (dx > R * DEAD) s.right = true;
    }
    if (s.left && s.right) s.left = s.right = false;
    this.paint();
  }

  // ---- visual side ----------------------------------------------------------

  buildOverlay() {
    const el = this.el;
    el.innerHTML = `
      <div class="tc-pad"><div class="tc-arrow tc-l">&#9664;</div><div class="tc-arrow tc-r">&#9654;</div></div>
      <div class="tc-fire">FIRE</div>
      <button class="tc-gear" type="button" aria-label="Settings"><svg viewBox="0 0 10 10" shape-rendering="crispEdges" aria-hidden="true"><path d="M4 0h2v1h-2zM1 1h1v1h-1zM3 1h4v1h-4zM8 1h1v1h-1zM0 2h10v1h-10zM1 3h3v1h-3zM6 3h3v1h-3zM0 4h3v2h-3zM7 4h3v2h-3zM1 6h3v1h-3zM6 6h3v1h-3zM0 7h10v1h-10zM1 8h1v1h-1zM3 8h4v1h-4zM8 8h1v1h-1zM4 9h2v1h-2z"/></svg></button>
      <button class="tc-pause" type="button" aria-label="Pause"><svg viewBox="0 0 10 10" shape-rendering="crispEdges" aria-hidden="true"><rect x="2" y="1" width="2" height="8"/><rect x="6" y="1" width="2" height="8"/></svg></button>
      <div class="tc-panel tc-menu" hidden>
        <h2>Paused</h2>
        <button class="tc-resume" type="button">Resume</button>
        <button class="tc-restart" type="button">Restart game</button>
        <button class="tc-quit" type="button">Quit to title</button>
      </div>
      <div class="tc-panel tc-settings" hidden>
        <h2>Settings</h2>
        <label>Players <select class="tc-players"><option value="1">1 player</option><option value="2">2 players (take turns)</option></select></label>
        <h3>Cheats</h3>
        <label>Difficulty <select class="tc-level"><option value="0">Normal (arcade)</option><option value="1">Easy</option><option value="2">Super easy</option></select></label>
        <label><input class="tc-cheat" data-cheat="unlimited" type="checkbox"> Unlimited lives</label>
        <label><input class="tc-cheat" data-cheat="rapidFire" type="checkbox"> Rapid fire (fast shots)</label>
        <label><input class="tc-cheat" data-cheat="noLanding" type="checkbox"> Invaders never land</label>
        <button class="tc-skip" type="button">Skip this wave</button>
        <p class="tc-note">Only Normal games with no cheats set the high score.</p>
        <h3>Controls</h3>
        <label><input class="tc-cheat" data-cheat="autoFire" type="checkbox"> Keep firing while fire is held</label>
        <label>Touch controls <select name="enabled"><option value="auto">Auto</option><option value="on">Always</option><option value="off">Off</option></select></label>
        <label>Move with <select name="layout"><option value="buttons">Left/right pad</option><option value="stick">Floating slider</option></select></label>
        <label>Size <input name="size" type="range" min="0.6" max="1.6" step="0.1"></label>
        <label>Opacity <input name="opacity" type="range" min="0.1" max="0.9" step="0.05"></label>
        <label><input name="swap" type="checkbox"> Fire on the left</label>
        <button class="tc-close" type="button">Done</button>
      </div>`;
    this.pad = el.querySelector('.tc-pad');
    this.fireEl = el.querySelector('.tc-fire');
    this.arrows = { left: el.querySelector('.tc-l'), right: el.querySelector('.tc-r') };
    this.panel = el.querySelector('.tc-settings');
    this.menu = el.querySelector('.tc-menu');
    this.gear = el.querySelector('.tc-gear');
    this.pauseBtn = el.querySelector('.tc-pause');
    // main.js hooks these
    this.onPanelToggle = null;
    this.onLevel = null;
    this.onCheat = null;
    this.onSkip = null;
    this.onPlayers = null;
    this.onPause = null;
    this.onRestart = null;
    this.onQuit = null;
    this.onLayout = null;
    this.playersBox = el.querySelector('.tc-players');
    this.playersBox.addEventListener('change', () => this.onPlayers?.(Number(this.playersBox.value)));
    this.levelBox = el.querySelector('.tc-level');
    this.levelBox.addEventListener('change', () => this.onLevel?.(Number(this.levelBox.value)));
    this.cheatBoxes = [...el.querySelectorAll('.tc-cheat')];
    for (const b of this.cheatBoxes) b.addEventListener('change', () => this.onCheat?.(b.dataset.cheat, b.checked));
    el.querySelector('.tc-skip').addEventListener('click', () => { this.onSkip?.(); this.openPanel(false); });
    const stop = (e) => e.stopPropagation();
    for (const n of [this.gear, this.panel, this.pauseBtn, this.menu]) for (const ev of ['pointerdown', 'pointerup', 'pointermove']) n.addEventListener(ev, stop);
    this.gear.addEventListener('click', () => this.openPanel(true));
    this.pauseBtn.addEventListener('click', () => this.onPause?.(true));
    el.querySelector('.tc-resume').addEventListener('click', () => this.onPause?.(false));
    el.querySelector('.tc-restart').addEventListener('click', () => this.onRestart?.());
    el.querySelector('.tc-quit').addEventListener('click', () => this.onQuit?.());
    el.querySelector('.tc-close').addEventListener('click', () => this.openPanel(false));
    this.panel.addEventListener('input', (e) => {
      const f = e.target;
      if (!f.name) return; // players, difficulty and cheats are game settings
      this.settings[f.name] = f.type === 'checkbox' ? f.checked : f.type === 'range' ? Number(f.value) : f.value;
      save(this.settings);
      this.release();
      this.applySettings();
    });
  }

  setLevel(n) { this.levelBox.value = String(n); }
  setPlayers(n) { this.playersBox.value = String(n); }
  setCheats(c) { for (const b of this.cheatBoxes) b.checked = !!c[b.dataset.cheat]; }

  /** Main loop: whether a game is on (shows the pause button) and whether it's paused (shows the menu). */
  setPlayState(playing, paused) {
    this.el.classList.toggle('tc-playing', playing);
    const show = playing && paused && this.panel.hidden;
    if (this.menu.hidden === show) { this.menu.hidden = !show; this.release(); }
  }

  openPanel(open) {
    this.panel.hidden = !open;
    this.release();
    this.onPanelToggle?.(open);
  }

  applySettings() {
    const s = this.settings, el = this.el;
    for (const f of this.panel.querySelectorAll('[name]')) {
      if (f.type === 'checkbox') f.checked = !!s[f.name]; else f.value = String(s[f.name]);
    }
    el.style.setProperty('--tc-opacity', s.opacity);
    el.classList.toggle('tc-visible', this.active);
    el.classList.toggle('tc-stick', s.layout === 'stick');
    this.layout();
    this.onLayout?.();
  }

  /** Geometry in window pixels, used for both hit-testing and drawing. */
  layout() {
    const W = window.innerWidth, H = window.innerHeight;
    const cs = getComputedStyle(document.documentElement);
    const inset = (n) => parseFloat(cs.getPropertyValue(n)) || 0;
    const sb = inset('--sat-b'), sl = inset('--sat-l'), sr = inset('--sat-r');
    const u = this.settings.size * Math.min(W, H) * 0.1;
    const padW = 3.6 * u, padH = 1.5 * u, fireR = 1.25 * u;
    const swap = this.settings.swap;
    const padX = swap ? W - sr - padW / 2 - u * 0.5 : sl + padW / 2 + u * 0.5;
    const padY = H - sb - padH / 2 - u * 0.7;
    const fireX = swap ? sl + fireR + u * 0.7 : W - sr - fireR - u * 0.7;
    const fireY = H - sb - fireR - u * 0.6;
    this.geom = { mid: W / 2, padX, padY, padW, padH, fireX, fireY, fireR, u };
    const f = this.fireEl.style;
    f.left = `${fireX - fireR}px`; f.top = `${fireY - fireR}px`; f.width = f.height = `${2 * fireR}px`;
    f.fontSize = `${u * 0.42}px`;
    this.pad.style.fontSize = `${u * 0.55}px`;
    this.paint();
  }

  paint() {
    const g = this.geom, s = this.state;
    const cx = this.settings.layout === 'stick' && this.stickX !== null ? this.stickX : g.padX;
    this.pad.classList.toggle('tc-hidden', this.settings.layout === 'stick' && this.stickX === null);
    const p = this.pad.style;
    p.left = `${cx - g.padW / 2}px`; p.top = `${g.padY - g.padH / 2}px`;
    p.width = `${g.padW}px`; p.height = `${g.padH}px`;
    this.arrows.left.classList.toggle('on', s.left);
    this.arrows.right.classList.toggle('on', s.right);
    this.fireEl.classList.toggle('on', s.fire);
  }

  /** The height at the bottom of the screen the controls take up (for portrait layout). */
  get reserved() {
    const g = this.geom;
    return this.active ? window.innerHeight - (Math.min(g.padY - g.padH / 2, g.fireY - g.fireR) - g.u * 0.3) : 0;
  }
}

function load() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } }
function save(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* private mode / quota */ } }
