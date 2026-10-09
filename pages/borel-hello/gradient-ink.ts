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
  axis: readonly [number, number, number, number];
}

/** Fixed colors follow written arc length, including connected letter handoffs.
 * They never rescale to the currently visible portion during playback.
 */
export function gradientPieces(pens: readonly PenPath[]): GradientPiece[][] {
  const total = pens.reduce((sum, pen) => sum + (pen.retrace ? 0 : pen.length), 0) || 1;
  let offset = 0;
  return pens.map(pen => {
    if (pen.retrace || !pen.points.length) return [];
    const pieces: GradientPiece[] = [];
    let first = 0;
    const append = (last: number) => {
      const start = pen.points[first].distance, end = pen.points[last].distance;
      const a = pen.points[first], b = pen.points[last], length = end - start || 1;
      const dx = b.x - a.x || (b.y === a.y ? 1 : 0), dy = b.y - a.y;
      // Extend the full spectrum beyond both brush caps. Clamping a separate
      // two-stop gradient at each interval would stamp visible flat-color discs.
      const x1 = a.x - dx * (offset + start) / length, y1 = a.y - dy * (offset + start) / length;
      pieces.push({
        pen: { ...pen, length: end - start, points: pen.points.slice(first, last + 1).map(point => ({ ...point, distance: point.distance - start })) },
        start, end, from: gradientColor((offset + start) / total), to: gradientColor((offset + end) / total),
        axis: [x1, y1, x1 + dx * total / length, y1 + dy * total / length],
      });
      first = last;
    };
    for (let i = 1; i < pen.points.length; i++) {
      append(i);
    }
    if (!pieces.length) append(0);
    offset += pen.length;
    return pieces;
  });
}

/** A small color bleed covers antialias fringes. The shared authored-ink mask
 * supplies the exact silhouette, including pressure-sensitive dots.
 */
export function gradientPieceGeometry(piece: GradientPiece, written: number, pressure: number): string {
  const distance = Math.min(piece.pen.length, written - piece.start);
  if (distance <= 0 || pressure <= 0) return '';
  return penGeometry({ ...piece.pen, points: piece.pen.points.map(point => ({ ...point, radius: point.radius * pressure + 12 })) }, distance);
}
