import type { Lettering } from './lettering';
import { penGeometry, type PenPath } from './pen-geometry';
import { strokeState, type PenPlayback } from './pen-playback';
import { GradientInkView } from './gradient-ink-view';
import { StrokeOrderView } from './stroke-order-view';
import { svgElement } from './svg';

export interface InkStyle {
  weight: number;
  ink: string;
  paper: string;
  gradient: boolean;
  guides: boolean;
  reference: boolean;
}
interface StrokePath {
  path: SVGPathElement;
  written?: number;
  pressure?: number;
  weight?: number;
}

/** Own the SVG layers and render caches; playback and physics stay outside. */
export class ArtworkView {
  readonly order = new StrokeOrderView();
  private orderPrepared = false;
  private gradient = new GradientInkView();
  private inkShape = svgElement('g', { id: 'cursive-ink-shape' });
  private solidInk = svgElement('use', { href: '#cursive-ink-shape' });
  private inkLayer = svgElement('g');
  private reference = svgElement('g', { fill: 'currentColor', opacity: '.13', 'pointer-events': 'none' });
  private guides = svgElement('g', { fill: 'none', stroke: '#dc7962', 'stroke-width': '5', opacity: '.65', 'pointer-events': 'none' });
  private strokes: StrokePath[] = [];
  private ropeGradient = new GradientInkView('cursive-rope');
  private ropeShape = svgElement('g', { id: 'cursive-rope-ink-shape' });
  private solidRope = svgElement('use', { href: '#cursive-rope-ink-shape' });
  private ropeLayer = svgElement('g', { fill: 'currentColor', 'pointer-events': 'none' });
  private ropePaths: SVGPathElement[] = [];
  private ropePlayback: PenPlayback | undefined;
  private renderedRopePens: PenPath[] = [];
  private ropeWeight = 0;

  constructor(readonly artwork: SVGSVGElement) {
    const definitions = svgElement('defs');
    definitions.append(this.inkShape, this.ropeShape);
    this.inkLayer.append(this.solidInk, this.gradient.layer);
    this.ropeLayer.append(this.solidRope, this.ropeGradient.layer);
    artwork.replaceChildren(definitions, this.gradient.definitions, this.reference, this.inkLayer,
      this.guides, this.order.layer, this.ropeGradient.definitions, this.ropeLayer);
  }

  setLettering(lettering: Lettering, playback: PenPlayback) {
    this.orderPrepared = false;
    this.order.layer.replaceChildren(); this.order.steps = [];
    this.inkShape.replaceChildren(); this.reference.replaceChildren(); this.guides.replaceChildren();
    this.strokes = lettering.strokes.map(stroke => {
      const path = svgElement('path', { d: '', fill: 'currentColor' });
      this.inkShape.append(path);
      this.guides.append(svgElement('path', { d: stroke.d }));
      return { path };
    });
    for (const d of lettering.outlines) if (d) this.reference.append(svgElement('path', { d }));
    this.gradient.setPens(playback.strokes.map(stroke => stroke.pen));
    this.ropeGradient.setPens([]); this.ropePaths = []; this.ropeShape.replaceChildren();
    this.ropePlayback = undefined;
  }

  prepareOrder(playback: PenPlayback) {
    if (this.orderPrepared) return;
    this.order.setPlayback(playback); this.orderPrepared = true;
  }

  resetRope(playback: PenPlayback) {
    this.renderedRopePens = []; this.ropeWeight = 0;
    this.ropePaths = playback.strokes.map(() => svgElement('path'));
    this.ropeShape.replaceChildren(...this.ropePaths);
    if (this.ropePlayback !== playback) {
      this.ropeGradient.setPens(playback.strokes.map(stroke => stroke.pen));
      this.ropePlayback = playback;
    }
  }

  render(playback: PenPlayback, time: number, style: InkStyle, inspecting: boolean, ropePens?: readonly PenPath[]) {
    const roping = ropePens !== undefined;
    if (!roping) for (const [index, stroke] of this.strokes.entries()) {
      const timed = playback.strokes[index];
      const { written, pressure } = strokeState(timed, time);
      if ((!style.gradient || inspecting) && (written !== stroke.written || pressure !== stroke.pressure || style.weight !== stroke.weight)) {
        stroke.path.setAttribute('d', penGeometry(timed.pen, written, pressure, style.weight));
        stroke.written = written; stroke.pressure = pressure; stroke.weight = style.weight;
      }
      stroke.path.style.visibility = written > 0 ? 'visible' : 'hidden';
      if (style.gradient && !inspecting) this.gradient.renderStroke(index, written, pressure, style.weight);
    }
    if (ropePens) {
      for (const [index, path] of this.ropePaths.entries()) {
        const pen = ropePens[index];
        if (!style.gradient && (pen !== this.renderedRopePens[index] || style.weight !== this.ropeWeight)) {
          path.setAttribute('d', penGeometry(pen, undefined, 1, style.weight));
          this.renderedRopePens[index] = pen;
        }
        if (style.gradient) this.ropeGradient.renderDeformedStroke(index, pen, style.weight);
      }
      if (!style.gradient) this.ropeWeight = style.weight;
      this.solidRope.style.display = style.gradient ? 'none' : '';
      this.ropeGradient.layer.style.display = style.gradient ? '' : 'none';
    }
    this.ropeLayer.style.display = roping ? '' : 'none';
    this.inkLayer.style.display = roping ? 'none' : '';
    this.guides.style.display = style.guides && !inspecting && !roping ? '' : 'none';
    this.reference.style.display = !roping && (style.reference || inspecting) ? '' : 'none';
    this.inkLayer.style.opacity = inspecting ? '.12' : '1';
    this.solidInk.style.display = style.gradient && !inspecting ? 'none' : '';
    this.gradient.layer.style.display = style.gradient && !inspecting ? '' : 'none';
    this.order.layer.style.display = inspecting ? '' : 'none';
    this.artwork.style.color = style.ink;
    document.documentElement.style.background = style.paper;
    return inspecting ? this.order.render(playback, time) : undefined;
  }
}
