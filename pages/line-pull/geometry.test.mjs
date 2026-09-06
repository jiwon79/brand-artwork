import { expect, test } from 'vitest';
import { boundaryPoint, copyLayout, crossingTime, lensProgress, linePoint, restY, sampleXs } from './geometry.ts';

const surface = {
  width: 720, height: 1280, lineGap: 56, lineWidth: 3, surfaceCurvature: 0.022,
  lensStrength: 0.2, horizontalLens: 0.27, boundaryEase: 0.65,
  boundaryCreep: 0.02, apexSpacing: 0.16,
};
const near = (a, b, epsilon = 1e-6) => expect(Math.abs(a - b), `${a} != ${b}`).toBeLessThanOrEqual(epsilon);
const pullAt = (distance, x = 440, originY = 437) => ({
  originY, apexX: x, apexY: restY(surface, x, originY) + distance,
});

test('upper boundary approaches its neighbor, then creeps with it without crossing', () => {
  for (const direction of [-1, 1]) {
    let lastGap = Infinity;
    for (const distance of [0.01, 35, 70, 140, 210, 340, 700, 2100]) {
      const pull = pullAt(direction * distance);
      const boundary = boundaryPoint(surface, pull, pull.apexX).y;
      const neighbor = linePoint(surface, pull, pull.originY - direction * surface.lineGap, pull.apexX).y;
      const gap = direction * (boundary - neighbor);
      expect(gap >= surface.lineWidth - 1e-9 && gap <= lastGap + 1e-9).toBeTruthy();
      lastGap = gap;
    }
    const a = boundaryPoint(surface, pullAt(direction * 340), 440).y;
    const b = boundaryPoint(surface, pullAt(direction * 2100), 440).y;
    expect(Math.abs(a - b), 'long pull must not send the upper boundary flying').toBeLessThan(4);
  }
});

test('attached strokes touch edge-to-edge and retain twice the painted thickness', () => {
  for (const width of [390, 720, 1920]) for (const lineWidth of [0.5, 3, 6]) {
    const model = { ...surface, width, lineWidth };
    for (const direction of [-1, 1]) for (const x of [0, width / 2, width]) {
      const pull = { originY: 437, apexX: width / 2, apexY: 437 + direction * 5000 };
      const baseY = pull.originY - direction * model.lineGap;
      const neighbor = linePoint(model, pull, baseY, x);
      const boundary = boundaryPoint(model, pull, x);
      const left = linePoint(model, pull, baseY, x - 0.01);
      const right = linePoint(model, pull, baseY, x + 0.01);
      const slope = (right.y - left.y) / (right.x - left.x);
      const normalDistance = direction * (boundary.y - neighbor.y) / Math.hypot(1, slope);
      near(normalDistance, lineWidth);
      near(normalDistance + lineWidth, lineWidth * 2);
    }
  }
});

test('every reached line keeps a distinct, ordered tip in both directions', () => {
  for (const direction of [-1, 1]) {
    for (const distance of [70, 210, 340, 700, 2100]) {
      const pull = pullAt(direction * distance);
      let previous = linePoint(surface, pull, pull.originY, pull.apexX).y;
      for (let i = 1; i <= 35; i++) {
        const y = linePoint(surface, pull, pull.originY + direction * i * surface.lineGap, pull.apexX).y;
        expect(direction * (y - previous), 'tips must not collapse to one point').toBeGreaterThanOrEqual(surface.lineGap * 0.15);
        previous = y;
      }
    }
  }
});

test('main tip stays in pointer coordinates at every x and at unlimited heights', () => {
  for (const x of [0, 1, 27, 360, 440, 719, 720]) {
    for (const distance of [-5000, -340, -70, -1, 0, 1, 70, 340, 5000]) {
      const pull = pullAt(distance, x);
      const tip = linePoint(surface, pull, pull.originY, x);
      near(tip.x, x);
      near(tip.y, pull.apexY);
      expect(sampleXs(surface, pull).includes(x)).toBeTruthy();
    }
  }
});

test('lens strength never decreases as pull distance grows', () => {
  let previous = 0;
  for (let distance = 0; distance <= 5000; distance += 5) {
    const strength = lensProgress(surface, pullAt(distance));
    expect(strength >= previous && strength <= 1).toBeTruthy();
    near(strength, lensProgress(surface, pullAt(-distance)));
    previous = strength;
  }
});

test('neighboring lines acquire and release their bend continuously', () => {
  for (const direction of [-1, 1]) {
    for (let distance = 0; distance < 600; distance += 0.5) {
      for (let i = 1; i < 6; i++) {
        const y = 437 + direction * i * surface.lineGap;
        const before = linePoint(surface, pullAt(direction * distance), y, 440).y;
        const after = linePoint(surface, pullAt(direction * (distance + 0.001)), y, 440).y;
        expect(Math.abs(after - before), 'newly reached line jumped').toBeLessThan(0.003);
      }
    }
  }
});

test('hit testing finds fast diagonal and horizontal crossings of curved lines', () => {
  near(crossingTime(surface, { x: 360, y: 400 }, { x: 360, y: 600 }, 437), 0.185);
  expect(crossingTime(surface, { x: 360, y: 400 }, { x: 360, y: 410 }, 437)).toBe(null);
  for (const [from, to] of [
    [{ x: 0, y: 300 }, { x: 700, y: 900 }],
    [{ x: 700, y: 900 }, { x: 0, y: 300 }],
    [{ x: 0, y: 439 }, { x: 360, y: 439 }],
  ]) {
    const t = crossingTime(surface, from, to, 437);
    expect(t > 0 && t <= 1).toBeTruthy();
    near(from.y + (to.y - from.y) * t, restY(surface, from.x + (to.x - from.x) * t, 437));
  }
});

test('copy stays centered and unchanged when only the pointer moves sideways', () => {
  for (const width of [390, 720, 1440]) {
    const model = { ...surface, width };
    for (const distance of [-600, -140, 140, 600]) {
      for (const count of [1, 2]) {
        const pull = { originY: 437, apexY: 437 + distance, apexX: width / 2 };
        const expected = copyLayout(model, pull, count);
        near(expected.x, width / 2);
        for (const x of [0, width * 0.1, width * 0.9, width]) {
          expect(copyLayout(model, { ...pull, apexX: x }, count)).toStrictEqual(expected);
        }
        near(expected.scaleX, 1);
      }
    }
  }
});

test('copy retains pull-driven magnification without stretching Hangul sideways', () => {
  for (const direction of [-1, 1]) {
    let previous = 0;
    for (const distance of [0, 10, 40, 100, 300, 1000]) {
      const layout = copyLayout(surface, pullAt(direction * distance), 1);
      near(layout.scaleX, 1);
      expect(layout.fontSize).toBeGreaterThan(previous);
      previous = layout.fontSize;
    }
  }
});
