import type { PenPath } from './pen-geometry';

export interface TimedStroke {
  pen: PenPath;
  start: number;
  end: number;
  dot: boolean;
}
export interface PenPlayback { strokes: TimedStroke[]; duration: number }

/** Arc length controls writing speed, but a stationary dab still takes time.
 * Pen lifts occupy empty time: they never create a connecting ink path.
 */
export function createPenPlayback(pens: readonly PenPath[]): PenPlayback {
  const length = pens.reduce((sum, pen) => sum + pen.length, 0);
  const writingTime = Math.max(4, Math.min(60, Math.round(length / 1750 * 2) / 2));
  let time = 0;
  const strokes = pens.map((pen, i): TimedStroke => {
    const previous = pens[i - 1], from = previous?.points[previous.points.length - 1], to = pen.points[0];
    const dot = !pen.retrace && pen.length <= .1;
    if (from && to) {
      const gap = Math.hypot(to.x - from.x, to.y - from.y);
      if (gap > 1) time += Math.min(.32, .1 + gap / 6000);
    }
    const start = time;
    time += dot ? .16 : length ? pen.length / length * writingTime : 0;
    return { pen, start, end: time, dot };
  });
  return { strokes, duration: time };
}

/** Dabs build round contact area while the nib presses down. All completed
 * strokes have exactly the same geometry as the untimed final rendering.
 */
export function strokeState(stroke: TimedStroke, time: number) {
  const progress = time <= stroke.start ? 0 : time >= stroke.end ? 1 : (time - stroke.start) / (stroke.end - stroke.start);
  return {
    written: stroke.pen.length * progress,
    pressure: stroke.dot ? progress * progress * (3 - 2 * progress) : 1,
  };
}
