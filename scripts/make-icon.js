// Generates media/icon.png (128×128), the Marketplace icon.
// A placeholder until the final design: a softly glowing dot on a dark
// rounded square. Plain Node, no image libraries: we draw pixels and write
// the PNG format by hand.
//   node scripts/make-icon.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 128;
const SS = 4; // supersampling for smooth edges

const BG = [30, 31, 36];      // dark tile
const DOT = [55, 148, 255];   // "needs you" blue
const RING = [55, 148, 255];

function sample(x, y) {
  // Rounded square
  const r = 28;
  const cx = Math.min(Math.max(x, r), SIZE - r);
  const cy = Math.min(Math.max(y, r), SIZE - r);
  if (Math.hypot(x - cx, y - cy) > r) return null; // transparent corner

  const d = Math.hypot(x - SIZE / 2, y - SIZE / 2);
  let color = BG;
  // Soft glow
  const glow = Math.max(0, 1 - d / 52) ** 2 * 0.35;
  color = mix(color, DOT, glow);
  // Ring
  if (d > 33 && d < 39) color = mix(color, RING, 0.45);
  // Dot
  if (d < 20) color = DOT;
  return color;
}

function mix(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}

// Render with supersampling
const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let rgb = [0, 0, 0];
    let alpha = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const c = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        if (c) {
          rgb = rgb.map((v, i) => v + c[i]);
          alpha++;
        }
      }
    }
    const i = (y * SIZE + x) * 4;
    pixels[i] = alpha ? rgb[0] / alpha : 0;
    pixels[i + 1] = alpha ? rgb[1] / alpha : 0;
    pixels[i + 2] = alpha ? rgb[2] / alpha : 0;
    pixels[i + 3] = (alpha / (SS * SS)) * 255;
  }
}

// ---- PNG encoding ----
function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // no filter
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = path.join(__dirname, '..', 'media', 'icon.png');
fs.writeFileSync(out, png);
console.log('Wrote', out);
