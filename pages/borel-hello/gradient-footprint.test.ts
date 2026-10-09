import { expect, test } from 'vitest';
import { composeText, type Bounds } from './lettering';
import { gradientPieceGeometry, gradientPieces } from './gradient-ink';
import { preparePen, type PenPoint } from './pen-geometry';
import { letterContexts } from './stroke-order';
import { catalog, raster, shaper } from './test-font';

// Independent swept-disc containment in elliptical nib coordinates. A point is
// inside when min_t(|p - (a + t(b-a))|² - (ra + t(rb-ra))²) <= 0.
// This does not read the generated SVG or use penGeometry as its oracle.
function insideSweep(x: number, y: number, a: PenPoint, b: PenPoint, sx: number, sy: number, margin: number) {
  const px = (x - a.x) / sx, py = (y - a.y) / sy;
  const dx = (b.x - a.x) / sx, dy = (b.y - a.y) / sy;
  const ra = a.radius + margin, dr = b.radius - a.radius;
  const quadratic = dx * dx + dy * dy - dr * dr;
  const linear = -2 * (px * dx + py * dy + ra * dr);
  const constant = px * px + py * py - ra * ra;
  const at = (t: number) => quadratic * t * t + linear * t + constant;
  const t = quadratic > 0 ? Math.max(0, Math.min(1, -linear / (2 * quadratic))) : 0;
  return Math.min(at(0), at(1), at(t)) <= 0;
}

const alphabet = 'abcdefghijklmnopqrstuvwxyz';
for (const first of alphabet) {
  test(`gradient paint stays in the authored nib for lowercase ${first} and all 26 following letters`, () => {
    const contexts = letterContexts(first, shaper, catalog).map(context => context.text);
    for (const text of new Set([first, ...[...alphabet].map(last => first + last), ...contexts])) {
      const pens = composeText(text, shaper, catalog).strokes.map(preparePen);
      const pieces = gradientPieces(pens);
      for (const [stroke, parts] of pieces.entries()) {
        const pen = pens[stroke], [sx, sy] = pen.nibScale;
        for (const [interval, part] of parts.entries()) {
          // Test a moving tip as well as each completed interval. For dots,
          // also exercise the growing contact area rather than only full size.
          for (const progress of [.35, 1]) {
            const pressure = pen.length <= .1 ? progress : 1;
            const sourceA = pen.points[interval], sourceB = pen.points[Math.min(interval + 1, pen.points.length - 1)];
            const a = { ...sourceA, radius: sourceA.radius * pressure };
            const b = {
              ...sourceB,
              x: sourceA.x + (sourceB.x - sourceA.x) * progress,
              y: sourceA.y + (sourceB.y - sourceA.y) * progress,
              radius: (sourceA.radius + (sourceB.radius - sourceA.radius) * progress) * pressure,
            };
            const r = Math.max(a.radius, b.radius);
            // Include the former 12-unit overpaint in the observation window.
            const bounds: Bounds = [Math.floor(Math.min(a.x, b.x) - (r + 16) * sx), Math.floor(Math.min(a.y, b.y) - (r + 16) * sy), Math.ceil(Math.max(a.x, b.x) + (r + 16) * sx), Math.ceil(Math.max(a.y, b.y) + (r + 16) * sy)];
            const scale = .5, width = Math.ceil((bounds[2] - bounds[0]) * scale), height = Math.ceil((bounds[3] - bounds[1]) * scale);
            const d = gradientPieceGeometry(part, part.start + part.pen.length * progress, pressure);
            const pixels = raster(`<path d="${d}"/>`, bounds, scale);
            // One diagonal raster pixel of antialias tolerance, in nib space.
            const margin = Math.hypot((bounds[2] - bounds[0]) / width / sx, (bounds[3] - bounds[1]) / height / sy);
            let escaped = 0, painted = 0;
            for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
              if (pixels[(y * width + x) * 4 + 3] < 16) continue;
              painted++;
              const px = bounds[0] + (x + .5) * (bounds[2] - bounds[0]) / width;
              const py = bounds[1] + (y + .5) * (bounds[3] - bounds[1]) / height;
              if (!insideSweep(px, py, a, b, sx, sy, margin)) escaped++;
            }
            if (escaped) throw new Error(`${text}: stroke ${stroke}, interval ${interval}, progress ${progress}: ${escaped} pixels recolor outside the nib`);
            // Avoid an empty renderer satisfying containment vacuously.
            if (Math.min(a.radius, b.radius) * Math.min(sx, sy) > 4) expect(painted, text).toBeGreaterThan(0);
          }
        }
      }
    }
  }, 30_000);
}
