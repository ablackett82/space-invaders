// Minimal dependency-free PNG encoder (8-bit RGB, no alpha).
import zlib from 'node:zlib';

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A simple RGB raster with integer upscaling on encode. */
export class Raster {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 3);
  }

  set(x, y, [r, g, b]) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 3;
    this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b;
  }

  fill(x, y, w, h, rgb) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, rgb);
  }

  /** Copy from an RGBA buffer of the same size. */
  fromRGBA(rgba) {
    for (let i = 0, j = 0; i < this.data.length; i += 3, j += 4) {
      this.data[i] = rgba[j]; this.data[i + 1] = rgba[j + 1]; this.data[i + 2] = rgba[j + 2];
    }
    return this;
  }

  encode(scale = 1) {
    const W = this.width * scale, H = this.height * scale;
    const raw = Buffer.alloc((W * 3 + 1) * H);
    for (let y = 0; y < H; y++) {
      const row = y * (W * 3 + 1);
      raw[row] = 0; // filter: none
      const sy = Math.floor(y / scale);
      for (let x = 0; x < W; x++) {
        const si = (sy * this.width + Math.floor(x / scale)) * 3;
        raw.set(this.data.subarray(si, si + 3), row + 1 + x * 3);
      }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(W, 0);
    ihdr.writeUInt32BE(H, 4);
    ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}
