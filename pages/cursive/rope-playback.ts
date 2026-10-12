import type { PenPath } from './pen-geometry';
import { strokeState, type PenPlayback } from './pen-playback';
import { sampleRopePen } from './rope-curve';

/** Freeze only the ink already drawn, including the pressure of a partial dot.
 * Keep stroke indices and color anchors tied to the complete handwriting. */
export function visibleRopePens(playback: PenPlayback, time: number): PenPath[] {
  return playback.strokes.map(stroke => {
    const { pen } = stroke, { written, pressure } = strokeState(stroke, time);
    if (pen.retrace || written <= 0 || pressure <= 0) return { ...pen, points: [], length: 0 };
    if (written >= pen.length && pressure === 1) return pen;
    const points = pen.points.filter(point => point.distance < written).map(point => ({ ...point, radius: point.radius * pressure }));
    const tip = sampleRopePen(pen, written);
    points.push({ ...tip, radius: tip.radius * pressure });
    return { ...pen, points, length: written };
  });
}
