// Draws video RAM ($2400-$3FFF) as the cabinet shows it. The monitor is
// turned 90 degrees anticlockwise, so each 32-byte row of video RAM is a
// column of the picture, bottom to top, and the picture is 224 wide by 256
// tall. The pixels are white; strips of coloured film over the glass tint the
// saucer's band red and the player's band (and the spare ships) green, as on
// the upright cabinet.

const W = 224, H = 256;
const WHITE = [255, 255, 255], RED = [255, 40, 40], GREEN = [40, 255, 60], BLACK = [0, 0, 0];

/** The overlay colour of picture pixel (x, y), y from the top. */
export function overlay(x, y) {
  if (y >= 32 && y < 64) return RED;
  if (y >= 184 && y < 240) return GREEN;
  if (y >= 240 && x >= 16 && x < 134) return GREEN;
  return WHITE;
}

export class Screen {
  constructor() {
    this.rgba = new Uint8ClampedArray(W * H * 4);
    this.ink = new Uint8Array(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) this.ink.set(overlay(x, y), (y * W + x) * 3);
    for (let i = 3; i < this.rgba.length; i += 4) this.rgba[i] = 255;
  }

  /** Convert the machine's video RAM (m is the 64K address space) to RGBA. */
  draw(m) {
    const { rgba, ink } = this;
    for (let x = 0; x < W; x++) {
      const row = 0x2400 + x * 32;
      for (let b = 0; b < 32; b++) {
        const v = m[row + b];
        for (let bit = 0; bit < 8; bit++) {
          const y = 255 - (b * 8 + bit);
          const p = y * W + x, o = p * 4;
          if ((v >> bit) & 1) { rgba[o] = ink[p * 3]; rgba[o + 1] = ink[p * 3 + 1]; rgba[o + 2] = ink[p * 3 + 2]; }
          else { rgba[o] = BLACK[0]; rgba[o + 1] = BLACK[1]; rgba[o + 2] = BLACK[2]; }
        }
      }
    }
    return rgba;
  }
}

export { W as SCREEN_W, H as SCREEN_H };
