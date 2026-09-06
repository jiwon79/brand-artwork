import GUI from 'lil-gui';
import { exposeGuiInDebugMode } from '../../common/debug';
import { createFrameLoop } from './frame-loop';
import { themeForInteraction } from './palette';
import {
  advanceRipple, createReleaseRipple, rippleOffset, ripplePoint,
  type ReleaseRipple, type RippleColumn,
} from './ripple';
import {
  boundaryPoint, copyLayout, crossingTime, lensProgress, linePoint, pointsPath,
  pullDelta, restY, sampleXs, surfacePoint,
  type Point, type Pull, type Surface,
} from './geometry';

const SVG_NS = 'http://www.w3.org/2000/svg';

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Line Pull: missing ${selector}`);
  return element;
}

const stage = required<HTMLElement>('#stage');
const surfaceGrain = required<HTMLElement>('#surface-grain');
const artwork = required<SVGSVGElement>('#artwork');
const lineField = required<SVGGElement>('#line-field');
const reveal = required<SVGGElement>('#reveal');
const revealPath = required<SVGPathElement>('#reveal-path');
const revealBackground = required<SVGRectElement>('#reveal-background');
const revealCopy = required<SVGTextElement>('#reveal-copy');
const originPullPath = required<SVGPathElement>('#origin-pull-path');
const hint = required<HTMLElement>('#hint');

const params = {
  lineGap: 56,
  lineWidth: 3,
  surfaceCurvature: 0.022,
  lensStrength: 0.20,
  horizontalLens: 0.27,
  boundaryEase: 0.65,
  boundaryCreep: 0.02,
  apexSpacing: 0.16,
  followSpeed: 32,
  returnStiffness: 205,
  returnDamping: 24,
  releaseWave: 1,
  background: '#050505',
  lineColor: '#f4f2ec',
  hoverColor: '#ffffff',
  ...themeForInteraction(0),
};

const messages = [['Invisible'], ['More', 'Detail'], ['Hidden', 'Layers'], ['Pull', 'Further']];

interface LineState { baseY: number; path: SVGPathElement }
interface DragState extends Pull {
  pointerId: number;
  previousPoint: Point;
  originIndex: number | null;
  grabOffsetY: number;
  targetY: number;
  velocityY: number;
  returning: boolean;
  messageIndex: number;
}
type ActiveDrag = DragState & { originIndex: number };

let width = 0;
let height = 0;
let lines: LineState[] = [];
let drag: DragState | null = null;
let ripple: ReleaseRipple | null = null;
let hoveredIndex = -1;
let interactionCount = 0;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const render = createFrameLoop(animate);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function surface(): Surface { return { ...params, width, height }; }
function isActive(current: DragState): current is ActiveDrag { return current.originIndex !== null; }

function localPoint(event: PointerEvent): Point {
  const bounds = stage.getBoundingClientRect();
  return { x: clamp(event.clientX - bounds.left, 0, width), y: event.clientY - bounds.top };
}

function lineAt(point: Point): number | null {
  const model = surface();
  let nearest: number | null = null;
  let distance = Math.max(8, params.lineWidth * 2);
  lines.forEach((line, index) => {
    const next = Math.abs(restY(model, point.x, line.baseY) - point.y);
    if (next <= distance) { distance = next; nearest = index; }
  });
  return nearest;
}

function firstCrossing(from: Point, to: Point): number | null {
  const model = surface();
  let first: number | null = null;
  let time = Infinity;
  lines.forEach((line, index) => {
    const next = crossingTime(model, from, to, line.baseY);
    if (next !== null && next < time) { first = index; time = next; }
  });
  return first;
}

function activate(current: DragState, index: number): void {
  current.originIndex = index;
  current.originY = lines[index].baseY;
  current.messageIndex = interactionCount % messages.length;
  Object.assign(params, themeForInteraction(interactionCount++));
  panelColorController.updateDisplay();
  textColorController.updateDisplay();
  revealCopy.replaceChildren(...messages[current.messageIndex].map(text => {
    const span = document.createElementNS(SVG_NS, 'tspan');
    span.textContent = text;
    return span;
  }));
  hint.classList.add('is-hidden');
}

function clearReveal(): void {
  reveal.setAttribute('opacity', '0');
  revealPath.setAttribute('d', '');
  originPullPath.setAttribute('opacity', '0');
  originPullPath.setAttribute('d', '');
}

function renderReveal(model: Surface, current: ActiveDrag, xs: number[], columns?: RippleColumn[]): void {
  const delta = pullDelta(model, current);
  if (Math.abs(delta) < 0.01) { clearReveal(); return; }
  const upper = xs.map((x, i) => ripplePoint(boundaryPoint(model, current, x), columns?.[i]));
  const lower = xs.map((x, i) => ripplePoint(linePoint(model, current, current.originY, x), columns?.[i]));
  revealPath.setAttribute('d', pointsPath([...upper, ...[...lower].reverse()], true));
  reveal.setAttribute('opacity', '1');
  originPullPath.setAttribute('d', pointsPath(lower));
  originPullPath.setAttribute('stroke', params.lineColor);
  originPullPath.setAttribute('stroke-width', String(params.lineWidth));
  originPullPath.setAttribute('opacity', '1');

  const spans = [...revealCopy.children];
  const { x: copyX, y: copyY, fontSize, scaleX, lineHeight } = copyLayout(model, current, spans.length);
  revealCopy.setAttribute('font-size', String(fontSize));
  revealCopy.setAttribute('transform', `translate(${copyX} 0) scale(${scaleX} 1) translate(${-copyX} 0)`);
  revealCopy.setAttribute('x', String(copyX));
  revealCopy.setAttribute('y', String(copyY));
  spans.forEach((span, index) => {
    span.setAttribute('x', String(copyX));
    span.setAttribute('dy', index === 0 ? '0' : String(lineHeight));
  });
}

function renderFrame(): void {
  const model = surface();
  const current = drag && isActive(drag) ? drag : null;
  const xs = sampleXs(model, current);
  // Share horizontal wave samples across every line and the reveal clip.
  const wave = ripple;
  const columns = wave ? xs.map(x => {
    const center = surfacePoint(model, current, x, wave.originY);
    return { offset: rippleOffset(wave, center.x), centerY: center.y, spread: wave.spread };
  }) : undefined;
  const strength = current ? lensProgress(model, current) : 0;
  stage.style.backgroundColor = params.background;
  // Only the grain is CSS-scaled. All interactive geometry stays in pointer coordinates.
  // Update only the composited layer, not inherited variables across the SVG tree.
  surfaceGrain.style.transform = `scale(${1 + 0.05 * strength})`;
  surfaceGrain.style.transformOrigin = current ? `${current.apexX}px ${current.originY}px` : '50% 50%';
  revealBackground.setAttribute('width', String(width));
  revealBackground.setAttribute('height', String(height));
  revealBackground.setAttribute('fill', params.panelColor);
  revealCopy.setAttribute('fill', params.textColor);
  lines.forEach((line, index) => {
    const points = xs.map((x, i) => ripplePoint(current?.originIndex === index
      ? boundaryPoint(model, current, x)
      : linePoint(model, current, line.baseY, x), columns?.[i]));
    line.path.setAttribute('d', pointsPath(points));
    line.path.setAttribute('stroke-width', String(params.lineWidth));
    line.path.setAttribute('stroke', index === hoveredIndex && !drag ? params.hoverColor : params.lineColor);
  });
  if (current) renderReveal(model, current, xs, columns);
  else clearReveal();
}

function cancelDrag(immediate = false, emitRipple = false): void {
  if (!emitRipple || immediate || reducedMotion.matches) ripple = null;
  if (!drag) { render(); return; }
  const pointerId = drag.pointerId;
  if (emitRipple && !immediate && isActive(drag) && !reducedMotion.matches) {
    ripple = createReleaseRipple({
      x: drag.apexX, originY: drag.originY, travel: pullDelta(surface(), drag),
      lineGap: params.lineGap, width, strength: params.releaseWave,
    });
  }
  // Change state before releasing capture: lostpointercapture must not restart the spring.
  if (immediate || !isActive(drag) || reducedMotion.matches) drag = null;
  else { drag.returning = true; drag.pointerId = -1; drag.velocityY = 0; }
  if (pointerId >= 0 && stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId);
  stage.classList.remove('is-dragging');
  render();
}

function resize(): void {
  cancelDrag(true);
  width = stage.clientWidth;
  height = stage.clientHeight;
  artwork.setAttribute('viewBox', `0 0 ${width} ${height}`);
  artwork.setAttribute('width', String(width));
  artwork.setAttribute('height', String(height));
  lineField.replaceChildren();
  const firstY = params.lineGap * 0.56 - params.lineGap * 3;
  const count = Math.ceil((height - firstY) / params.lineGap) + 4;
  lines = Array.from({ length: count }, (_, index) => {
    const path = document.createElementNS(SVG_NS, 'path');
    lineField.appendChild(path);
    return { baseY: firstY + index * params.lineGap, path };
  });
  hoveredIndex = -1;
  render();
}

function onPointerDown(event: PointerEvent): void {
  if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
  if (drag?.returning) cancelDrag(true);
  if (drag) return;
  // New input owns the surface immediately, including after the spring has closed.
  ripple = null;
  event.preventDefault();
  const point = localPoint(event);
  const index = lineAt(point);
  const originY = index === null ? point.y : lines[index].baseY;
  const restingY = index === null ? point.y : restY(surface(), point.x, originY);
  drag = {
    pointerId: event.pointerId, previousPoint: point,
    originIndex: null, originY, apexX: point.x, apexY: restingY,
    grabOffsetY: point.y - restingY, targetY: restingY,
    velocityY: 0, returning: false, messageIndex: 0,
  };
  if (index !== null) activate(drag, index);
  hoveredIndex = -1;
  stage.classList.add('is-dragging');
  stage.setPointerCapture(event.pointerId);
  render();
}

function onPointerMove(event: PointerEvent): void {
  const point = localPoint(event);
  if (drag && drag.pointerId === event.pointerId && !drag.returning) {
    event.preventDefault();
    if (!isActive(drag)) {
      const index = firstCrossing(drag.previousPoint, point);
      if (index !== null) {
        activate(drag, index);
        drag.apexY = restY(surface(), point.x, drag.originY);
        drag.grabOffsetY = 0;
      }
    }
    drag.previousPoint = point;
    drag.apexX = point.x;
    drag.targetY = point.y - drag.grabOffsetY;
    if (reducedMotion.matches) drag.apexY = drag.targetY;
    render();
  } else if (!drag && event.pointerType !== 'touch') {
    const index = lineAt(point) ?? -1;
    if (index !== hoveredIndex) { hoveredIndex = index; render(); }
  }
}

function finishPointer(event: PointerEvent): void {
  if (drag && drag.pointerId === event.pointerId && !drag.returning) {
    cancelDrag(false, event.type === 'pointerup');
  }
}

function animate(dt: number): boolean {
  ripple = reducedMotion.matches ? null : advanceRipple(ripple, dt);
  if (drag && isActive(drag)) {
    if (drag.returning) {
      const restingY = restY(surface(), drag.apexX, drag.originY);
      // Small integration steps keep the return stable on slow frames and touch devices.
      const steps = Math.max(1, Math.ceil(dt * 120));
      let closed = false;
      for (let i = 0; i < steps; i++) {
        const before = drag.apexY - restingY;
        drag.velocityY += ((restingY - drag.apexY) * params.returnStiffness
          - drag.velocityY * params.returnDamping) * dt / steps;
        drag.apexY += drag.velocityY * dt / steps;
        if (before * (drag.apexY - restingY) <= 0) { closed = true; break; }
      }
      if (closed || (Math.abs(restingY - drag.apexY) < 0.12 && Math.abs(drag.velocityY) < 0.5)) drag = null;
    } else if (Math.abs(drag.targetY - drag.apexY) > 0.001) {
      drag.apexY += (drag.targetY - drag.apexY)
        * (reducedMotion.matches ? 1 : -Math.expm1(-params.followSpeed * dt));
    }
  }
  renderFrame();
  return !!ripple || !!(drag && isActive(drag)
    && (drag.returning || Math.abs(drag.targetY - drag.apexY) > 0.001));
}

stage.addEventListener('pointerdown', onPointerDown);
stage.addEventListener('pointermove', onPointerMove);
stage.addEventListener('pointerup', finishPointer);
stage.addEventListener('pointercancel', finishPointer);
stage.addEventListener('lostpointercapture', finishPointer);
stage.addEventListener('pointerleave', event => {
  if (!drag && event.pointerType !== 'touch') { hoveredIndex = -1; render(); }
});
window.addEventListener('blur', () => cancelDrag());
window.addEventListener('resize', resize);
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) cancelDrag(true);
});

const gui = new GUI({ title: 'Line Pull' });
gui.add(params, 'lineGap', 42, 120, 1).name('line gap').onFinishChange(resize);
gui.add(params, 'lineWidth', 0.5, 6, 0.1).name('line width').onChange(render);
gui.add(params, 'surfaceCurvature', 0, 0.06, 0.001).name('surface curve').onChange(render);
gui.add(params, 'lensStrength', 0, 0.4, 0.005).name('lens strength').onChange(render);
gui.add(params, 'horizontalLens', 0, 0.4, 0.005).name('horizontal lens').onChange(render);
gui.add(params, 'boundaryEase', 0.2, 1.5, 0.01).name('boundary approach').onChange(render);
gui.add(params, 'boundaryCreep', 0, 0.1, 0.001).name('boundary creep').onChange(render);
gui.add(params, 'apexSpacing', 0.05, 0.4, 0.01).name('tip spacing').onChange(render);
gui.add(params, 'followSpeed', 16, 80, 1).name('pull response');
gui.add(params, 'returnStiffness', 80, 420, 1).name('return stiffness');
gui.add(params, 'returnDamping', 8, 42, 0.5).name('return damping');
gui.add(params, 'releaseWave', 0, 1, 0.05).name('release wave');
gui.addColor(params, 'background').name('background').onChange(render);
gui.addColor(params, 'lineColor').name('line').onChange(render);
const panelColorController = gui.addColor(params, 'panelColor').name('panel').onChange(render);
const textColorController = gui.addColor(params, 'textColor').name('text').onChange(render);
exposeGuiInDebugMode(gui);

resize();
