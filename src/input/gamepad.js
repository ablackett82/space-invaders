// Gamepad API: d-pad or left stick to move, A / B / X / Y or a shoulder
// button to fire, Start to start a game.
export class Gamepad {
  constructor() { this.startPressed = false; this.lastButtons = 0; this.any = false; }
  read(into) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let buttons = 0;
    this.any = false;
    for (const p of pads) {
      if (!p) continue;
      const b = p.buttons;
      const ax = p.axes[0] || 0;
      const l = b[14]?.pressed || ax < -0.5, r = b[15]?.pressed || ax > 0.5;
      const fire = [0, 1, 2, 3, 4, 5, 6, 7].some((i) => b[i]?.pressed);
      if (l) into.left = true;
      if (r) into.right = true;
      if (fire) into.fire = true;
      if (l || r || fire) this.any = true;
      for (let i = 0; i < b.length; i++) if (b[i]?.pressed) buttons |= 1 << i;
    }
    const fresh = buttons & ~this.lastButtons;
    this.startPressed = !!(fresh & (1 << 9));
    if (fresh) this.any = true;
    this.lastButtons = buttons;
  }
}
