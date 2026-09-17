import * as fs from "node:fs";
import * as zlib from "node:zlib";

function crc32(buf) {
  let crc = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}
const table = new Int32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  table[i] = c;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

const width = 128;
const height = 128;
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

const raw = Buffer.alloc(height * (1 + width * 4));
let offset = 0;

for (let y = 0; y < height; y++) {
  raw[offset++] = 0; // filter byte
  for (let x = 0; x < width; x++) {
    // Rounded squircle boundary
    const dx = Math.abs(x - 63.5);
    const dy = Math.abs(y - 63.5);
    const cornerDist = Math.max(dx - 44, 0) ** 2 + Math.max(dy - 44, 0) ** 2;

    if (cornerDist > 18 * 18) {
      raw[offset++] = 0;
      raw[offset++] = 0;
      raw[offset++] = 0;
      raw[offset++] = 0;
      continue;
    }

    // Gradient background: dark slate to deep indigo
    const t = (x + y) / 256;
    let r = Math.round(15 * (1 - t) + 24 * t);
    let g = Math.round(23 * (1 - t) + 70 * t);
    let b = Math.round(42 * (1 - t) + 160 * t);
    let a = 255;

    // Outer subtle border
    if (cornerDist > 16.5 * 16.5 || dx > 59 || dy > 59) {
      r = Math.min(255, r + 40);
      g = Math.min(255, g + 60);
      b = Math.min(255, b + 90);
    }

    // Central glowing dot
    const distCenter = Math.hypot(x - 64, y - 64);
    if (distCenter <= 6) {
      r = 56;
      g = 189;
      b = 248; // cyan-400
    } else if (distCenter <= 8) {
      r = 14;
      g = 116;
      b = 144; // cyan glow
    }

    // Link rings
    // Left link ring center (50, 74), radius 17
    const d1 = Math.abs(Math.hypot(x - 50, y - 74) - 17);
    const inLeftRing = d1 <= 3.5 && x + y <= 136;

    // Right link ring center (78, 54), radius 17
    const d2 = Math.abs(Math.hypot(x - 78, y - 54) - 17);
    const inRightRing = d2 <= 3.5 && x + y >= 120;

    if (inLeftRing || inRightRing) {
      r = 241;
      g = 245;
      b = 249; // light slate
    }

    raw[offset++] = r;
    raw[offset++] = g;
    raw[offset++] = b;
    raw[offset++] = a;
  }
}

const idatData = zlib.deflateSync(raw);
const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = Buffer.concat([
  signature,
  chunk("IHDR", ihdr),
  chunk("IDAT", idatData),
  chunk("IEND", Buffer.alloc(0)),
]);

fs.writeFileSync("extension/media/icon.png", png);
console.log("Successfully generated extension/media/icon.png (bytes:", png.length, ")");
