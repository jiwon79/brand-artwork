import { penGeometry, type PenPath } from './pen-geometry';

// Spectrum reference: https://developer.apple.com/videos/play/wwdc2022/10037/
export const gradientPalette = ['#2589a6', '#70b49c', '#cedb56', '#f4d35e', '#f5a16c', '#eb7266', '#d57ba5', '#9764aa', '#6b83c6', '#7ab6da'];
export function gradientColor(progress: number): string {
  const position = Math.max(0, Math.min(1, progress)) * (gradientPalette.length - 1);
  const index = Math.min(gradientPalette.length - 2, Math.floor(position)), fraction = position - index;
  const channels = (hex: string) => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));
  const a = channels(gradientPalette[index]), b = channels(gradientPalette[index + 1]);
  return '#' + a.map((value, i) => Math.round(value + (b[i] - value) * fraction).toString(16).padStart(2, '0')).join('');
}

export interface GradientPiece {
  pen: PenPath;
  start: number;
  end: number;
  from: string;
  to: string;
  solid?: string;
  axis: readonly [number, number, number, number];
}

/** Fixed body colors follow arc length, including connected letter handoffs.
 * Deferred dots and t crossbars borrow their bodies' colors without advancing it.
 * Colors never rescale to the currently visible portion during playback.
 */
export function gradientPieces(pens: readonly PenPath[]): GradientPiece[][] {
  let total = 0;
  const offsets = pens.map(pen => {
    const offset = total;
    if (!pen.retrace && !pen.colorAnchors) total += pen.length;
    return offset;
  });
  total ||= 1;
  return pens.map((pen, stroke) => {
    if (pen.retrace || !pen.points.length) return [];
    const offset = offsets[stroke];
    const anchors = pen.colorAnchors?.map(([x, y]) => {
      let nearest = Infinity, position = offset;
      pens.forEach((body, index) => {
        if (body.retrace || body.colorAnchors || body.length <= .1) return;
        for (let i = 1; i < body.points.length; i++) {
          const a = body.points[i - 1], b = body.points[i], dx = b.x - a.x, dy = b.y - a.y;
          const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
          const distance = (a.x + dx * t - x) ** 2 + (a.y + dy * t - y) ** 2;
          // At a retraced stem use the last visible pass, including exact ties.
          if (distance <= nearest + 1e-8) {
            nearest = distance; position = offsets[index] + a.distance + (b.distance - a.distance) * t;
          }
        }
      });
      return { x, y, progress: position / total };
    });
    let anchoredAxis: GradientPiece['axis'] | undefined;
    let solid = pen.length <= .1 ? gradientColor(offset / total) : undefined;
    if (anchors?.length) {
      const a = anchors[0], b = anchors[anchors.length - 1], span = b.progress - a.progress;
      if (Math.abs(span) < 1e-8 || Math.hypot(b.x - a.x, b.y - a.y) < 1e-8) solid = gradientColor(a.progress);
      else {
        // All capsules of a shared tt crossbar use one continuous color field.
        // Its two stem crossings match the colors already painted underneath.
        const dx = (b.x - a.x) / span, dy = (b.y - a.y) / span;
        const x = a.x - dx * a.progress, y = a.y - dy * a.progress;
        anchoredAxis = [x, y, x + dx, y + dy];
      }
    }
    const pieces: GradientPiece[] = [];
    let first = 0;
    const append = (last: number) => {
      const start = pen.points[first].distance, end = pen.points[last].distance;
      const a = pen.points[first], b = pen.points[last], length = end - start || 1;
      const dx = b.x - a.x || (b.y === a.y ? 1 : 0), dy = b.y - a.y;
      // Extend the full spectrum beyond both brush caps. Clamping a separate
      // two-stop gradient at each interval would stamp visible flat-color discs.
      const x1 = a.x - dx * (offset + start) / length, y1 = a.y - dy * (offset + start) / length;
      const axis = anchoredAxis ?? [x1, y1, x1 + dx * total / length, y1 + dy * total / length] as const;
      const colorAt = (x: number, y: number) => {
        const [ax, ay, bx, by] = axis, dx = bx - ax, dy = by - ay;
        return solid ?? gradientColor(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1));
      };
      pieces.push({
        pen: { ...pen, length: end - start, points: pen.points.slice(first, last + 1).map(point => ({ ...point, distance: point.distance - start })) },
        start, end, solid,
        from: anchors ? colorAt(a.x, a.y) : gradientColor((offset + start) / total),
        to: anchors ? colorAt(b.x, b.y) : gradientColor((offset + end) / total), axis,
      });
      first = last;
    };
    for (let i = 1; i < pen.points.length; i++) {
      append(i);
    }
    if (!pieces.length) append(0);
    return pieces;
  });
}

/** Color belongs only to the nib's swept area. Expanding a patch would recolor
 * earlier ink at crossings, even when a shared mask preserves the silhouette.
 */
export function gradientPieceGeometry(piece: GradientPiece, written: number, pressure: number, weight = 1): string {
  const distance = Math.min(piece.pen.length, written - piece.start);
  if (distance <= 0 || pressure <= 0) return '';
  return penGeometry(piece.pen, distance, pressure, weight);
}
