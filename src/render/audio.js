// Sound. The cabinet's sounds are analogue circuits switched by two output
// ports; this plays synthesized stand-ins for them, driven by the same bits:
//   port 3: bit 0 saucer (a warble, held while the bit is on), bit 1 shot,
//           bit 2 cannon explodes, bit 3 invader hit, bit 4 extra ship,
//           bit 5 amplifier on
//   port 5: bits 0-3 the fleet's four march notes, bit 4 saucer hit
// The one-shot sounds start when their bit goes from 0 to 1.

const FLEET_HZ = [98, 87, 78, 69]; // the four descending notes of the march

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.last3 = 0;
    this.last5 = 0;
    this.ufo = null;
  }

  /** Must be called from a user gesture on iOS. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.out = this.ctx.createGain();
      this.out.gain.value = this.muted ? 0 : 0.5;
      this.out.connect(this.ctx.destination);
      // a second of white noise, shared by the noisy effects
      const n = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, n, n);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') this.ctx.resume().catch(() => {});
  }

  setMuted(on) {
    this.muted = on;
    if (this.out) this.out.gain.value = on ? 0 : 0.5;
  }

  /** Called after each batch of frames with the machine's sound ports. */
  update(g) {
    const p3 = g.port3, p5 = g.port5;
    const up3 = p3 & ~this.last3, up5 = p5 & ~this.last5;
    this.last3 = p3; this.last5 = p5;
    if (!this.ctx || this.ctx.state !== 'running') return;
    const amp = p3 & 0x20;
    if (amp) {
      if (up3 & 0x02) this.shot();
      if (up3 & 0x04) this.explosion();
      if (up3 & 0x08) this.invaderHit();
      if (up3 & 0x10) this.extraShip();
      for (let i = 0; i < 4; i++) if (up5 & (1 << i)) this.fleet(i);
      if (up5 & 0x10) this.saucerHit();
    }
    this.saucer(!!(amp && (p3 & 0x01)));
  }

  stopAll() {
    this.saucer(false);
  }

  // ---- building blocks ----

  env(gain, t, attack, peak, decay) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  noiseSource(t, dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur);
    return src;
  }

  // ---- the sounds ----

  /** The cannon firing: a short hiss falling in pitch. */
  shot() {
    const c = this.ctx, t = c.currentTime;
    const src = this.noiseSource(t, 0.35);
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 2.5;
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(500, t + 0.3);
    const gn = c.createGain();
    this.env(gn, t, 0.005, 0.7, 0.3);
    src.connect(f).connect(gn).connect(this.out);
  }

  /** The cannon exploding: a long rumble. */
  explosion() {
    const c = this.ctx, t = c.currentTime;
    const src = this.noiseSource(t, 1.4);
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = 1;
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 1.3);
    const gn = c.createGain();
    this.env(gn, t, 0.01, 0.9, 1.3);
    src.connect(f).connect(gn).connect(this.out);
  }

  /** An invader hit: a short crunch. */
  invaderHit() {
    const c = this.ctx, t = c.currentTime;
    const src = this.noiseSource(t, 0.3);
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.25);
    const gn = c.createGain();
    this.env(gn, t, 0.003, 0.8, 0.25);
    src.connect(f).connect(gn).connect(this.out);
    // with a little pitched thud underneath
    const o = c.createOscillator(), og = c.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.2);
    this.env(og, t, 0.003, 0.15, 0.2);
    o.connect(og).connect(this.out);
    o.start(t); o.stop(t + 0.25);
  }

  /** One note of the fleet's march: a low thump. */
  fleet(i) {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), f = c.createBiquadFilter(), gn = c.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(FLEET_HZ[i], t);
    f.type = 'lowpass'; f.frequency.value = 500;
    this.env(gn, t, 0.004, 0.9, 0.13);
    o.connect(f).connect(gn).connect(this.out);
    o.start(t); o.stop(t + 0.16);
  }

  /** The extra ship: a run of bright beeps. */
  extraShip() {
    const c = this.ctx, t = c.currentTime;
    for (let k = 0; k < 10; k++) {
      const o = c.createOscillator(), gn = c.createGain(), s = t + k * 0.12;
      o.type = 'square';
      o.frequency.value = 1600;
      this.env(gn, s, 0.004, 0.18, 0.07);
      o.connect(gn).connect(this.out);
      o.start(s); o.stop(s + 0.09);
    }
  }

  /** The saucer hit: a warbling fall. */
  saucerHit() {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), lfo = c.createOscillator(), depth = c.createGain(), gn = c.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(1200, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 1.1);
    lfo.frequency.value = 18;
    depth.gain.value = 120;
    lfo.connect(depth).connect(o.frequency);
    this.env(gn, t, 0.01, 0.3, 1.1);
    o.connect(gn).connect(this.out);
    o.start(t); lfo.start(t);
    o.stop(t + 1.2); lfo.stop(t + 1.2);
  }

  /** The saucer flying: a siren warble, on while the bit is set. */
  saucer(on) {
    const c = this.ctx;
    if (on && !this.ufo && c) {
      const t = c.currentTime;
      const o = c.createOscillator(), lfo = c.createOscillator(), depth = c.createGain(), gn = c.createGain();
      o.type = 'triangle';
      o.frequency.value = 700;
      lfo.type = 'triangle';
      lfo.frequency.value = 6;
      depth.gain.value = 260;
      lfo.connect(depth).connect(o.frequency);
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(0.28, t + 0.05);
      o.connect(gn).connect(this.out);
      o.start(t); lfo.start(t);
      this.ufo = { o, lfo, gn };
    } else if (!on && this.ufo) {
      const { o, lfo, gn } = this.ufo, t = c.currentTime;
      gn.gain.cancelScheduledValues(t);
      gn.gain.setValueAtTime(gn.gain.value, t);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      o.stop(t + 0.06); lfo.stop(t + 0.06);
      this.ufo = null;
    }
  }
}
