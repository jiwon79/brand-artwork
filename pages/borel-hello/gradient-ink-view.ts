import { gradientPalette, gradientPieces, gradientPieceGeometry, type GradientPiece } from './gradient-ink';
import type { PenPath } from './pen-geometry';
import type { Bounds } from './lettering';

const NS = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string>) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

export class GradientInkView {
  readonly layer = svg('g', { mask: 'url(#borel-ink-mask)' });
  readonly definitions = svg('defs', {});
  private strokes: { piece: GradientPiece; path: SVGPathElement; written?: number; pressure?: number }[][] = [];

  setPens(pens: readonly PenPath[], bounds: Bounds) {
    this.definitions.replaceChildren();
    this.layer.replaceChildren();
    const spectrum = svg('linearGradient', { id: 'borel-spectrum', 'color-interpolation': 'sRGB' });
    spectrum.append(...gradientPalette.map((color, index) => svg('stop', { offset: String(index / (gradientPalette.length - 1)), 'stop-color': color })));
    this.definitions.append(spectrum);
    const [left, top, right, bottom] = bounds;
    // Normalize the color buffer's alpha before the outer ink mask is applied.
    // This keeps edge colors without a colored undercoat or enlarged capsules:
    // neither may spill onto an earlier stroke inside a self-intersection.
    const opaque = svg('filter', { id: 'borel-opaque-color', filterUnits: 'userSpaceOnUse', x: String(left), y: String(top), width: String(right - left), height: String(bottom - top), 'color-interpolation-filters': 'sRGB' });
    const transfer = svg('feComponentTransfer', {});
    transfer.append(svg('feFuncA', { type: 'linear', slope: '0', intercept: '1' }));
    opaque.append(transfer);
    this.definitions.append(opaque);
    const color = svg('g', { filter: 'url(#borel-opaque-color)' });
    this.layer.append(color);
    this.strokes = gradientPieces(pens).map((pieces, stroke) => pieces.map((piece, index) => {
      const id = `borel-color-${stroke}-${index}`, [x1, y1, x2, y2] = piece.axis;
      const gradient = svg('linearGradient', { id, href: '#borel-spectrum', gradientUnits: 'userSpaceOnUse', x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2) });
      this.definitions.append(gradient);
      const path = svg('path', { fill: pens[stroke].length <= .1 ? piece.from : `url(#${id})` });
      color.append(path);
      return { piece, path };
    }));
  }

  renderStroke(index: number, written: number, pressure: number) {
    for (const part of this.strokes[index] ?? []) {
      const distance = Math.max(0, Math.min(part.piece.end, written) - part.piece.start);
      if (part.written === distance && part.pressure === pressure) continue;
      part.path.setAttribute('d', gradientPieceGeometry(part.piece, written, pressure));
      part.written = distance; part.pressure = pressure;
    }
  }
}
