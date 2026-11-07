'use strict';
/* 生成 PWA 图标：黑底 + 两根 K 线 */
const fs = require('fs');
const zlib = require('zlib');

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crcBuf]);
}

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function draw(size) {
  const buf = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) set(x, y, 10, 10, 10, 255);

  const bar = (x0, x1, y0, y1, r, g, b) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, r, g, b, 255);
  };
  const s = size / 100;

  // 绿柱
  bar(Math.round(26 * s), Math.round(42 * s), Math.round(28 * s), Math.round(62 * s), 38, 166, 154);
  bar(Math.round(33 * s), Math.round(35 * s), Math.round(18 * s), Math.round(72 * s), 38, 166, 154);

  // 红柱
  bar(Math.round(56 * s), Math.round(72 * s), Math.round(42 * s), Math.round(80 * s), 239, 83, 80);
  bar(Math.round(63 * s), Math.round(65 * s), Math.round(33 * s), Math.round(88 * s), 239, 83, 80);

  return png(size, size, buf);
}

fs.writeFileSync(__dirname + '/icon-192.png', draw(192));
fs.writeFileSync(__dirname + '/icon-512.png', draw(512));
console.log('icons written');
