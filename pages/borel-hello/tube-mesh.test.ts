import { expect, test } from 'vitest';
import { composeText } from './lettering';
import { preparePen } from './pen-geometry';
import { catalog, shaper } from './test-font';
import { createTubeFrames, createTubePaths, sampleTube, TUBE_SIDES } from './tube-geometry';
import { TubeBodyGeometry } from './tube-mesh';
import { createTubeColors } from './tube-color';

for (const text of ['hello', 'jiwon', 'fdbxk']) {
  test(`real tube buffers stay closed and recover exactly after frame/weight scrubbing: ${text}`, () => {
    const pens = composeText(text, shaper, catalog).strokes.map(preparePen);
    const paths = createTubePaths(pens, [0, 0]);
    const frames = createTubeFrames(paths), colors = createTubeColors(pens);
    for (const [i, path] of paths.entries()) {
      if (path.length <= .1) continue;
      const geometry = new TubeBodyGeometry(path, frames[i], colors[i]);
      geometry.setProgress(path.length, 1);
      const final = Array.from(geometry.getAttribute('position').array);
      const normals = Array.from(geometry.getAttribute('normal').array);
      const finalColors = Array.from(geometry.getAttribute('color').array);
      const plain = new TubeBodyGeometry(path, frames[i]);
      plain.setProgress(path.length, 1);
      expect(Array.from(plain.getAttribute('position').array)).toEqual(final);
      expect(Array.from(plain.getAttribute('normal').array)).toEqual(normals);
      plain.dispose();
      // The two strips on either side of every internal join meet exactly.
      const ringValues = (TUBE_SIDES + 1) * 3;
      for (let s = 0; s < path.points.length - 2; s++) {
        expect(final.slice((s * 2 + 1) * ringValues, (s * 2 + 2) * ringValues))
          .toEqual(final.slice((s * 2 + 2) * ringValues, (s * 2 + 3) * ringValues));
        expect(finalColors.slice((s * 2 + 1) * ringValues, (s * 2 + 2) * ringValues))
          .toEqual(finalColors.slice((s * 2 + 2) * ringValues, (s * 2 + 3) * ringValues));
      }
      for (const weight of [1.5, .5, 1]) for (const progress of [.02, .11, .64, .12, 0, .86, 1]) {
        const written = path.length * progress, { point, frame, color } = geometry.setProgress(written, weight);
        const expected = sampleTube(path, written);
        expect(point).toEqual(expected.point);
        expect(geometry.drawRange.count).toBe(progress ? (expected.segment + 1) * TUBE_SIDES * 6 : 0);
        if (!progress) continue;
        const positions = geometry.getAttribute('position'), offset = (expected.segment * 2 + 1) * (TUBE_SIDES + 1);
        const ringColors = geometry.getAttribute('color');
        // Completed rings retain their final colors at every intermediate
        // frame: revealing more tube must never stretch the visible rainbow.
        expect(Array.from(ringColors.array.slice(0, offset * 3))).toEqual(finalColors.slice(0, offset * 3));
        // The moving end ring lies on the same plane as the flat cap.
        for (let j = 0; j <= TUBE_SIDES; j++) {
          const delta = [positions.getX(offset + j) - point.center[0], positions.getY(offset + j) - point.center[1], positions.getZ(offset + j) - point.center[2]];
          expect(Math.hypot(...delta)).toBeCloseTo(point.radius * weight, 5);
          expect(delta.reduce((sum, value, axis) => sum + value * frame.tangent[axis], 0)).toBeCloseTo(0, 5);
          // Every side of the moving end has exactly the cap's material color.
          expect(ringColors.getX(offset + j)).toBeCloseTo(color.r, 6);
          expect(ringColors.getY(offset + j)).toBeCloseTo(color.g, 6);
          expect(ringColors.getZ(offset + j)).toBeCloseTo(color.b, 6);
        }
      }
      expect(Array.from(geometry.getAttribute('position').array)).toEqual(final);
      expect(Array.from(geometry.getAttribute('normal').array)).toEqual(normals);
      expect(Array.from(geometry.getAttribute('color').array)).toEqual(finalColors);
      geometry.dispose();
    }
  });
}
