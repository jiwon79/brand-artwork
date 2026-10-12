import { deformGradientPiece, gradientPalette, gradientRenderPieces, gradientPieceGeometry, type GradientPiece } from './gradient-ink';
import { expandPenBounds, type PenPath } from './pen-geometry';

const NS = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string>) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}
function cover(rect: SVGRectElement, pen: PenPath, weight: number) {
  if (!pen.points.length) return;
  const p = pen.points[0];
  const [x, y, right, bottom] = expandPenBounds([p.x, p.y, p.x, p.y], [pen], weight);
  for (const [name, value] of Object.entries({ x, y, width: right - x, height: bottom - y })) rect.setAttribute(name, String(value));
}
interface Patch {
  piece: GradientPiece;
  path: SVGPathElement;
  rect: SVGRectElement;
  gradient: SVGLinearGradientElement;
  written?: number;
  pressure?: number;
  weight?: number;
}

/** Opaque color planes clipped once to the actual traveled nib geometry.
 * No full-text filter or alpha mask: edge coverage comes from a vector clip,
 * with full color underneath its antialias fringe even at browser zoom.
 */
export class GradientInkView {
  readonly layer = svg('g', {});
  readonly definitions = svg('defs', {});
  private strokes: Patch[][] = [];
  private deformed: ({ pen: PenPath; weight: number } | undefined)[] = [];

  constructor(private readonly prefix = 'borel') {}

  setPens(pens: readonly PenPath[]) {
    this.definitions.replaceChildren(); this.layer.replaceChildren(); this.deformed = [];
    const spectrum = svg('linearGradient', { id: `${this.prefix}-spectrum`, 'color-interpolation': 'sRGB' });
    spectrum.append(...gradientPalette.map((color, index) => svg('stop', { offset: String(index / (gradientPalette.length - 1)), 'stop-color': color })));
    this.definitions.append(spectrum);
    this.strokes = gradientRenderPieces(pens).map((pieces, stroke) => pieces.map((piece, index) => {
      const id = `${this.prefix}-color-${stroke}-${index}`, [x1, y1, x2, y2] = piece.axis;
      const gradient = svg('linearGradient', { id, href: `#${this.prefix}-spectrum`, gradientUnits: 'userSpaceOnUse', x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2) });
      const clip = svg('clipPath', { id: `${id}-clip`, clipPathUnits: 'userSpaceOnUse' });
      const path = svg('path', { d: '' }); clip.append(path);
      this.definitions.append(gradient, clip);
      const rect = svg('rect', { fill: piece.solid ?? `url(#${id})`, 'clip-path': `url(#${id}-clip)` });
      cover(rect, piece.pen, 1.5); this.layer.append(rect);
      return { piece, path, rect, gradient };
    }));
  }

  renderStroke(index: number, written: number, pressure: number, weight = 1) {
    if (this.deformed[index]) for (const part of this.strokes[index] ?? []) {
      const [x1, y1, x2, y2] = part.piece.axis;
      for (const [name, value] of Object.entries({ x1, y1, x2, y2 })) part.gradient.setAttribute(name, String(value));
      part.rect.setAttribute('fill', part.piece.solid ?? `url(#${part.gradient.id})`);
      cover(part.rect, part.piece.pen, 1.5);
      part.written = undefined;
    }
    this.deformed[index] = undefined;
    for (const part of this.strokes[index] ?? []) {
      const distance = Math.max(0, Math.min(part.piece.end, written) - part.piece.start);
      if (part.written === distance && part.pressure === pressure && part.weight === weight) continue;
      part.path.setAttribute('d', gradientPieceGeometry(part.piece, written, pressure, weight));
      part.written = distance; part.pressure = pressure; part.weight = weight;
    }
  }

  renderDeformedStroke(index: number, pen: PenPath, weight = 1) {
    const previous = this.deformed[index];
    if (previous?.pen === pen && previous.weight === weight) return;
    this.deformed[index] = { pen, weight };
    for (const part of this.strokes[index] ?? []) {
      if (!pen.points.length || part.piece.start >= pen.length) {
        if (part.written !== 0) part.path.setAttribute('d', '');
        part.written = 0; continue;
      }
      const piece = deformGradientPiece(part.piece, pen);
      const [x1, y1, x2, y2] = piece.axis;
      for (const [name, value] of Object.entries({ x1, y1, x2, y2 })) part.gradient.setAttribute(name, String(value));
      part.rect.setAttribute('fill', piece.solid ?? `url(#${part.gradient.id})`);
      cover(part.rect, piece.pen, weight);
      part.path.setAttribute('d', gradientPieceGeometry(piece, pen.length, 1, weight));
      part.written = piece.pen.length;
    }
  }
}
