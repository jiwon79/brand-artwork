import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bakeRelief, grainOverlay, reliefOverlay } from '../../scripts/generate-line-pull-texture.mjs';

const clamp = x => Math.min(1, Math.max(0, x));
test('base relief blend preserves the previous multiply/screen result for any backdrop', () => {
  for (let i = 0; i <= 100; i++) {
    const value = i / 100;
    const multiply = clamp(clamp((value - 0.5) * 1.2 + 0.5) * 1.8);
    const screen = clamp((value - 0.5) * 2.2 + 0.5) * 0.32;
    const { gray, alpha } = reliefOverlay(value);
    for (const backdrop of [0, 5 / 255, 31 / 255, 63 / 255, 198 / 255, 244 / 255, 1]) {
      const shaded = backdrop * (0.5 + 0.5 * multiply);
      const old = shaded + (1 - shaded) * screen * 0.34;
      const baked = Math.round(gray * 255) / 255 * (Math.round(alpha * 255) / 255)
        + backdrop * (1 - Math.round(alpha * 255) / 255);
      assert.ok(Math.abs(old - baked) <= 1 / 255, 'baked overlay changed a backdrop color');
    }
  }
});

test('grain is deterministic, visible on black, and subtly colored', () => {
  const pixels = [];
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const pixel = grainOverlay(reliefOverlay(0.48), x, y);
    assert.deepEqual(pixel, grainOverlay(reliefOverlay(0.48), x, y));
    assert.ok(pixel.every(value => value >= 0 && value <= 1));
    const [r, g, b, alpha] = pixel;
    pixels.push([r, g, b].map(value => value * alpha * 255 + 5 * (1 - alpha)));
  }
  const values = pixels.map(([r,g,b]) => 0.2126*r+0.7152*g+0.0722*b).sort((a,b) => a-b);
  const mean = values.reduce((a,b) => a+b, 0) / values.length;
  const deviation = Math.sqrt(values.reduce((a,b) => a+(b-mean)**2, 0) / values.length);
  assert.ok(mean > 13 && mean < 20, 'keep a black ground, not a gray wash');
  assert.ok(deviation > 7, 'grain must remain visible over black');
  assert.ok(values[Math.floor(values.length * 0.99)] > 40, 'retain sparse bright flecks');
  const chroma = pixels.reduce((sum,pixel) => sum + Math.max(...pixel)-Math.min(...pixel),0)/pixels.length;
  assert.ok(chroma > 1 && chroma < 4, 'color noise should be present but subtle');
});

test('high-density tiles preserve the CSS-pixel grain pattern', () => {
  const source = Buffer.alloc(8 * 8 * 4);
  for (let i = 0; i < source.length; i += 4) { source.fill(96, i, i + 3); source[i + 3] = 255; }
  const output = bakeRelief(source, 8, 8);
  for (const density of [2,3]) {
    const width = 8*density, scaled = Buffer.alloc(width*width*4);
    for (let i=0;i<scaled.length;i+=4) { scaled.fill(96,i,i+3); scaled[i+3]=255; }
    const result = bakeRelief(scaled,width,width,density);
    for (let y=0;y<width;y++) for (let x=0;x<width;x++) {
      const i=(y*width+x)*4, original=(Math.floor(y/density)*8+Math.floor(x/density))*4;
      assert.deepEqual(result.subarray(i,i+4),output.subarray(original,original+4));
    }
  }
});
