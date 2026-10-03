/** Seal enclosed numeral counters in the housing, while keeping exterior gaps open. */
export function housingMask(glyph: Uint8Array, width: number, height: number): Uint8Array {
  if (glyph.length !== width * height || width < 1 || height < 1) throw new Error('Invalid mask dimensions');
  const exterior = new Uint8Array(glyph.length);
  const queue = new Int32Array(glyph.length);
  let head = 0;
  let tail = 0;
  function visit(index: number) {
    if (!glyph[index] && !exterior[index]) {
      exterior[index] = 1;
      queue[tail++] = index;
    }
  }
  for (let x = 0; x < width; x++) { visit(x); visit((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { visit(y * width); visit(y * width + width - 1); }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    if (x > 0) visit(index - 1);
    if (x < width - 1) visit(index + 1);
    if (index >= width) visit(index - width);
    if (index < glyph.length - width) visit(index + width);
  }
  return Uint8Array.from(exterior, value => 1 - value);
}
