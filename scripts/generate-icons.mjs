// Generates the PWA icons without external dependencies (hand-rolled PNG encoder).
// Usage: npm run icons   (outputs are committed; re-run only when the design changes)
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = join(root, "apps", "web");

const BG = [15, 23, 42]; // slate-900
const RING = [45, 212, 191]; // teal-400
const DOT = [248, 250, 252]; // slate-50

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Design: a progress ring with a gap and a dot on the gap's leading end.
 * `shape`: "rounded" (transparent corners), "full" (opaque full-bleed square: maskable / apple-touch).
 */
function render(size, shape) {
  const out = Buffer.alloc(size * size * 4);
  const SS = 3; // supersampling per axis
  const c = size / 2;
  const ringR = size * 0.27;
  const ringW = size * 0.085;
  const gapStart = (-50 * Math.PI) / 180;
  const gapEnd = (10 * Math.PI) / 180;
  const dotAngle = gapEnd + 0.12;
  const dotX = c + Math.cos(dotAngle) * ringR;
  const dotY = c + Math.sin(dotAngle) * ringR;
  const dotR = ringW * 0.9;
  const cornerR = size * 0.22;

  const inRoundedRect = (x, y) => {
    const dx = Math.max(Math.abs(x - c) - (c - cornerR), 0);
    const dy = Math.max(Math.abs(y - c) - (c - cornerR), 0);
    return dx * dx + dy * dy <= cornerR * cornerR;
  };

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS;
          const y = py + (sy + 0.5) / SS;
          if (shape === "rounded" && !inRoundedRect(x, y)) continue;
          let color = BG;
          const dist = Math.hypot(x - c, y - c);
          const angle = Math.atan2(y - c, x - c);
          const inGap = angle > gapStart && angle < gapEnd;
          if (Math.abs(dist - ringR) <= ringW / 2 && !inGap) color = RING;
          if (Math.hypot(x - dotX, y - dotY) <= dotR) color = DOT;
          r += color[0]; g += color[1]; b += color[2]; a += 1;
        }
      }
      const i = (py * size + px) * 4;
      const n = SS * SS;
      if (a > 0) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
        out[i + 3] = Math.round((a / n) * 255);
      }
    }
  }
  return encodePng(size, out);
}

const targets = [
  [join(webDir, "public", "icons", "icon-192.png"), 192, "rounded"],
  [join(webDir, "public", "icons", "icon-512.png"), 512, "rounded"],
  [join(webDir, "public", "icons", "icon-maskable-512.png"), 512, "full"],
  [join(webDir, "public", "icons", "apple-touch-icon.png"), 180, "full"],
  [join(webDir, "src", "app", "icon.png"), 192, "rounded"],
  [join(webDir, "src", "app", "apple-icon.png"), 180, "full"],
];

for (const [file, size, shape] of targets) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, render(size, shape));
  console.log(`wrote ${file.replace(root + "/", "")} (${size}x${size}, ${shape})`);
}
