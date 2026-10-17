// node --experimental-strip-types scripts/generate-stipple-screen.mjs
// Original procedural asset: periodic Poisson points -> distance field -> uniform ranks.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { makeInkScreen } from '../pages/stipple/ink-screen.ts';

const resolution = 1024;
const pixels = makeInkScreen(256, resolution);
function chunk(type, bytes) {
  const name = Buffer.from(type);
  const payload = Buffer.concat([name, bytes]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(bytes.length + 12);
  result.writeUInt32BE(bytes.length);
  payload.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
const header = Buffer.alloc(13);
header.writeUInt32BE(resolution, 0);
header.writeUInt32BE(resolution, 4);
header[8] = 8;
header[9] = 6;
const rows = Buffer.alloc(resolution * (resolution * 4 + 1));
for (let y = 0; y < resolution; y++) {
  rows.set(pixels.subarray(y * resolution * 4, (y + 1) * resolution * 4), y * (resolution * 4 + 1) + 1);
}
writeFileSync(new URL('../pages/stipple/assets/ink-screen.png', import.meta.url), Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]));
console.log('Generated periodic, tone-calibrated ink screen.');
