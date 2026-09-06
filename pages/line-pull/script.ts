import GUI from 'lil-gui';
import { exposeGuiInDebugMode } from '../../common/debug';
import { createFrameLoop } from './frame-loop';
import { themeForInteraction, type RevealTheme } from './palette';
import { canKeepOpening, isNestedSlot, layerGap, lineRows, pointInOpening } from './layers';
import {
  boundaryPoint, copyLayout, crossingTimes, lensProgress, linePoint, pointsPath,
  pullDelta, restY, sampleXs, type Point, type Pull, type Surface,
} from './geometry';

const SVG_NS = 'http://www.w3.org/2000/svg';
function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error('Line Pull: missing ' + selector);
  return element;
}
function svg<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

const stage = required<HTMLElement>('#stage');
const artwork = required<SVGSVGElement>('#artwork');
const defs = required<SVGDefsElement>('#artwork-defs');
const surfaceGrain = required<HTMLElement>('#surface-grain');
const hint = required<HTMLElement>('#hint');
const closeButton = required<HTMLButtonElement>('#close-layer');
const params = {
  lineGap: 56, lineWidth: 3, surfaceCurvature: 0.022,
  lensStrength: 0.20, horizontalLens: 0.27, boundaryEase: 0.65,
  boundaryCreep: 0.02, apexSpacing: 0.16, followSpeed: 32,
  returnStiffness: 205, returnDamping: 24,
  background: '#050505', lineColor: '#f4f2ec', hoverColor: '#ffffff',
  ...themeForInteraction(0),
};
const messages = [['Invisible'], ['More', 'Detail'], ['Hidden', 'Layers'], ['Pull', 'Further']];

interface View {
  group: SVGGElement; clip: SVGClipPathElement; clipPath: SVGPathElement;
  reveal: SVGGElement; background: SVGRectElement; copy: SVGTextElement;
  origin: SVGPathElement; field: SVGGElement;
}
interface DragState extends Pull {
  pointerId: number; previousPoint: Point; originIndex: number | null;
  grabOffsetY: number; targetY: number; velocityY: number;
  returning: boolean; pinned: boolean; messageIndex: number;
}
type ActiveDrag = DragState & { originIndex: number };
interface Layer {
  depth: number; parent: Layer | null; child: Layer | null;
  view: View; model: Surface; theme: RevealTheme;
  lines: { row: number; baseY: number; path: SVGPathElement }[];
  pull: DragState | null; polygon: Point[]; dirty: boolean; hoveredIndex: number;
}

const rootView: View = {
  group: required('#root-surface'), clip: required('#reveal-clip'), clipPath: required('#reveal-path'),
  reveal: required('#reveal'), background: required('#reveal-background'), copy: required('#reveal-copy'),
  origin: required('#origin-pull-path'), field: required('#line-field'),
};
let width = 0, height = 0, viewId = 0, interactionCount = 0;
let root: Layer;
let pointerLayer: Layer | null = null;
let hoverLayer: Layer | null = null;
let styledLayer: Layer | null = null;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const render = createFrameLoop(animate);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const isActive = (pull: DragState): pull is ActiveDrag => pull.originIndex !== null;
const surface = (depth: number): Surface => ({ ...params, width, height, lineGap: layerGap(params.lineGap, depth) });

function createView(parent: Layer): View {
  const clip = svg('clipPath'), clipPath = svg('path');
  clip.id = 'nested-clip-' + ++viewId;
  clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
  clip.appendChild(clipPath);
  defs.appendChild(clip);
  const group = svg('g'), reveal = svg('g'), background = svg('rect'), copy = svg('text');
  const origin = svg('path'), field = svg('g');
  group.setAttribute('data-layer-depth', String(parent.depth + 1));
  reveal.setAttribute('class', 'reveal');
  reveal.setAttribute('clip-path', 'url(#' + clip.id + ')');
  copy.setAttribute('text-anchor', 'middle');
  copy.setAttribute('dominant-baseline', 'middle');
  origin.setAttribute('class', 'origin-pull-path');
  field.setAttribute('class', 'line-field');
  reveal.append(background, copy);
  group.append(reveal, origin, field);
  // Nest the actual group inside the parent's clip, not a rectangular approximation.
  parent.view.reveal.appendChild(group);
  return { group, clip, clipPath, reveal, background, copy, origin, field };
}

function createLayer(parent: Layer | null, phase: number): Layer {
  const depth = parent ? parent.depth + 1 : 0;
  const view = parent ? createView(parent) : rootView;
  const model = surface(depth);
  view.field.replaceChildren();
  return {
    depth, parent, child: null, view, model, theme: { ...themeForInteraction(0) },
    pull: null, polygon: [], dirty: true, hoveredIndex: -1,
    lines: lineRows(height, model.lineGap, phase).map(row => {
      const path = svg('path');
      path.setAttribute('data-row', String(row.row));
      path.setAttribute('data-content', isNestedSlot(row.row, depth) ? 'nested' : 'copy');
      view.field.appendChild(path);
      return { ...row, path };
    }),
  };
}

function removeChild(layer: Layer): void {
  const child = layer.child;
  if (!child) return;
  removeChild(child);
  if (hoverLayer === child) hoverLayer = null;
  if (styledLayer === child) styledLayer = null;
  child.view.group.remove();
  child.view.clip.remove();
  layer.child = null;
}

function clearPull(layer: Layer): void {
  removeChild(layer);
  layer.pull = null;
  layer.polygon = [];
  layer.dirty = true;
}

function activate(layer: Layer, current: DragState, index: number): void {
  current.originIndex = index;
  current.originY = layer.lines[index].baseY;
  current.messageIndex = interactionCount % messages.length;
  layer.theme = { ...themeForInteraction(interactionCount++) };
  Object.assign(params, layer.theme);
  styledLayer = layer;
  panelColorController.updateDisplay();
  textColorController.updateDisplay();
  layer.view.copy.replaceChildren(...messages[current.messageIndex].map(text => {
    const span = svg('tspan'); span.textContent = text; return span;
  }));
  if (isNestedSlot(layer.lines[index].row, layer.depth)) {
    layer.child = createLayer(layer, current.originY + layerGap(params.lineGap, layer.depth + 1) * 0.56);
  }
  layer.view.reveal.setAttribute('data-content', layer.child ? 'nested' : 'copy');
  layer.view.copy.setAttribute('display', layer.child ? 'none' : 'inline');
  hint.classList.add('is-hidden');
  layer.dirty = true;
}

function renderLayer(layer: Layer): void {
  if (layer.dirty) {
    const { view, model, pull } = layer;
    const current = pull && isActive(pull) ? pull : null;
    const xs = sampleXs(model, current);
    const ink = layer.parent ? layer.parent.theme.textColor : params.lineColor;
    view.group.setAttribute('data-state', !pull ? 'closed' : pull.pinned ? 'open' : pull.returning ? 'returning' : 'dragging');
    view.background.setAttribute('width', String(width));
    view.background.setAttribute('height', String(height));
    view.background.setAttribute('fill', layer.theme.panelColor);
    view.copy.setAttribute('fill', layer.theme.textColor);
    layer.lines.forEach((line, index) => {
      const points = xs.map(x => current?.originIndex === index
        ? boundaryPoint(model, current, x) : linePoint(model, current, line.baseY, x));
      line.path.setAttribute('d', pointsPath(points));
      line.path.setAttribute('stroke-width', String(model.lineWidth));
      line.path.setAttribute('stroke', index === layer.hoveredIndex && !pull && !layer.parent ? params.hoverColor : ink);
    });
    if (current && Math.abs(pullDelta(model, current)) >= 0.01) {
      const upper = xs.map(x => boundaryPoint(model, current, x));
      const lower = xs.map(x => linePoint(model, current, current.originY, x));
      layer.polygon = [...upper, ...[...lower].reverse()];
      view.clipPath.setAttribute('d', pointsPath(layer.polygon, true));
      view.reveal.setAttribute('opacity', '1');
      view.origin.setAttribute('d', pointsPath(lower));
      view.origin.setAttribute('stroke', ink);
      view.origin.setAttribute('stroke-width', String(model.lineWidth));
      view.origin.setAttribute('opacity', '1');
      if (!layer.child) {
        const spans = [...view.copy.children];
        const { x, y, fontSize, scaleX, lineHeight } = copyLayout(model, current, spans.length);
        view.copy.setAttribute('font-size', String(fontSize));
        view.copy.setAttribute('transform', 'translate(' + x + ' 0) scale(' + scaleX + ' 1) translate(' + -x + ' 0)');
        view.copy.setAttribute('x', String(x));
        view.copy.setAttribute('y', String(y));
        spans.forEach((span, index) => {
          span.setAttribute('x', String(x));
          span.setAttribute('dy', index === 0 ? '0' : String(lineHeight));
        });
      }
    } else {
      layer.polygon = [];
      view.reveal.setAttribute('opacity', '0');
      view.clipPath.setAttribute('d', '');
      view.origin.setAttribute('opacity', '0');
      view.origin.setAttribute('d', '');
    }
    layer.dirty = false;
  }
  if (layer.child) renderLayer(layer.child);
}

function deepestPinned(): Layer | null {
  let found: Layer | null = null;
  for (let layer: Layer | null = root; layer; layer = layer.child) if (layer.pull?.pinned) found = layer;
  return found;
}

function renderFrame(): void {
  renderLayer(root);
  stage.style.backgroundColor = params.background;
  const current = root.pull && isActive(root.pull) ? root.pull : null;
  const strength = current ? lensProgress(root.model, current) : 0;
  surfaceGrain.style.transform = 'scale(' + (1 + 0.05 * strength) + ')';
  surfaceGrain.style.transformOrigin = current ? current.apexX + 'px ' + current.originY + 'px' : '50% 50%';
  closeButton.hidden = !deepestPinned();
}

function visibleInLayer(layer: Layer, point: Point): boolean {
  for (let parent = layer.parent; parent; parent = parent.parent) {
    if (!pointInOpening(parent.polygon, point, parent.model.lineWidth + 1)) return false;
  }
  return true;
}

function pickLayer(point: Point): Layer {
  let layer = root;
  while (layer.child && layer.pull?.pinned
    && pointInOpening(layer.polygon, point, layer.model.lineWidth + 1)) layer = layer.child;
  return layer;
}

function lineAt(layer: Layer, point: Point): number | null {
  if (!visibleInLayer(layer, point)) return null;
  let nearest: number | null = null;
  let distance = Math.max(8, layer.model.lineWidth * 2);
  layer.lines.forEach((line, index) => {
    const y = restY(layer.model, point.x, line.baseY);
    const next = Math.abs(y - point.y);
    if (next <= distance && visibleInLayer(layer, { x: point.x, y })) { distance = next; nearest = index; }
  });
  return nearest;
}

function firstCrossing(layer: Layer, from: Point, to: Point): number | null {
  let first: number | null = null, time = Infinity;
  layer.lines.forEach((line, index) => {
    for (const next of crossingTimes(layer.model, from, to, line.baseY)) {
      if (next < time && visibleInLayer(layer, {
        x: from.x + (to.x - from.x) * next, y: from.y + (to.y - from.y) * next,
      })) { first = index; time = next; }
    }
  });
  return first;
}

function localPoint(event: PointerEvent): Point {
  const bounds = stage.getBoundingClientRect();
  return { x: clamp(event.clientX - bounds.left, 0, width), y: event.clientY - bounds.top };
}

function releasePointer(normalRelease: boolean, immediate = false): void {
  const layer = pointerLayer, current = layer?.pull;
  if (!layer || !current) return;
  const pointerId = current.pointerId;
  const clips: Point[][] = [];
  for (let parent = layer.parent; parent; parent = parent.parent) clips.push(parent.polygon);
  // A move and release may arrive in the same frame, especially with reduced motion.
  const xs = sampleXs(layer.model, current);
  const polygon = isActive(current) ? [
    ...xs.map(x => boundaryPoint(layer.model, current, x)),
    ...[...xs].reverse().map(x => linePoint(layer.model, current, current.originY, x)),
  ] : [];
  // Detach ownership before lostpointercapture is delivered.
  pointerLayer = null;
  current.pointerId = -1;
  if (!immediate && normalRelease && layer.child && isActive(current)
    && canKeepOpening(polygon, current.apexX, height, layer.child.model.lineGap, clips)) {
    current.pinned = true;
    current.velocityY = 0;
  } else if (immediate || !isActive(current) || reducedMotion.matches) clearPull(layer);
  else { current.returning = true; current.velocityY = 0; }
  if (stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId);
  stage.classList.remove('is-dragging');
  layer.dirty = true;
  render();
}

function onPointerDown(event: PointerEvent): void {
  if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0) || pointerLayer) return;
  event.preventDefault();
  const point = localPoint(event);
  const layer = pickLayer(point);
  // Outside an open pocket, start again on its parent. Returning layers never lock input.
  if (layer.pull) clearPull(layer);
  const index = lineAt(layer, point);
  const originY = index === null ? point.y : layer.lines[index].baseY;
  const restingY = index === null ? point.y : restY(layer.model, point.x, originY);
  layer.pull = {
    pointerId: event.pointerId, previousPoint: point, originIndex: null, originY,
    apexX: point.x, apexY: restingY, grabOffsetY: point.y - restingY,
    targetY: restingY, velocityY: 0, returning: false, pinned: false, messageIndex: 0,
  };
  pointerLayer = layer;
  if (index !== null) activate(layer, layer.pull, index);
  if (hoverLayer) { hoverLayer.hoveredIndex = -1; hoverLayer.dirty = true; hoverLayer = null; }
  layer.dirty = true;
  stage.classList.add('is-dragging');
  stage.setPointerCapture(event.pointerId);
  render();
}

function onPointerMove(event: PointerEvent): void {
  const point = localPoint(event), layer = pointerLayer, current = layer?.pull;
  if (layer && current && current.pointerId === event.pointerId) {
    event.preventDefault();
    if (!isActive(current)) {
      const index = firstCrossing(layer, current.previousPoint, point);
      if (index !== null) {
        activate(layer, current, index);
        current.apexY = restY(layer.model, point.x, current.originY);
        current.grabOffsetY = 0;
      }
    }
    current.previousPoint = point;
    current.apexX = point.x;
    current.targetY = point.y - current.grabOffsetY;
    if (reducedMotion.matches) current.apexY = current.targetY;
    layer.dirty = true;
    render();
  } else if (!pointerLayer && event.pointerType !== 'touch') {
    const next = pickLayer(point);
    if (hoverLayer && hoverLayer !== next) { hoverLayer.hoveredIndex = -1; hoverLayer.dirty = true; }
    const index = next.pull ? -1 : lineAt(next, point) ?? -1;
    if (next.hoveredIndex !== index || hoverLayer !== next) {
      next.hoveredIndex = index; next.dirty = true; hoverLayer = next; render();
    }
  }
}

function finishPointer(event: PointerEvent): void {
  if (pointerLayer?.pull?.pointerId === event.pointerId) releasePointer(event.type === 'pointerup');
}

function advanceLayer(layer: Layer, dt: number): boolean {
  const current = layer.pull;
  let moving = false;
  if (current && isActive(current)) {
    if (current.returning) {
      const restingY = restY(layer.model, current.apexX, current.originY);
      const steps = Math.max(1, Math.ceil(dt * 120));
      let closed = reducedMotion.matches;
      for (let i = 0; i < steps && !closed; i++) {
        const before = current.apexY - restingY;
        current.velocityY += ((restingY - current.apexY) * params.returnStiffness
          - current.velocityY * params.returnDamping) * dt / steps;
        current.apexY += current.velocityY * dt / steps;
        if (before * (current.apexY - restingY) <= 0) closed = true;
      }
      if (closed || (Math.abs(restingY - current.apexY) < 0.12 && Math.abs(current.velocityY) < 0.5)) clearPull(layer);
      else moving = true;
      layer.dirty = true;
    } else if (Math.abs(current.targetY - current.apexY) > 0.001) {
      current.apexY += (current.targetY - current.apexY)
        * (reducedMotion.matches ? 1 : -Math.expm1(-params.followSpeed * dt));
      layer.dirty = true;
      moving = Math.abs(current.targetY - current.apexY) > 0.001;
    }
  }
  if (layer.child) moving = advanceLayer(layer.child, dt) || moving;
  return moving;
}

function animate(dt: number): boolean {
  const moving = advanceLayer(root, dt);
  renderFrame();
  return moving;
}

function closeDeepest(): void {
  if (pointerLayer) { releasePointer(false, true); return; }
  const layer = deepestPinned();
  if (!layer?.pull) return;
  if (layer.child) clearPull(layer.child);
  layer.pull.pinned = false;
  layer.pull.returning = true;
  layer.pull.velocityY = 0;
  layer.dirty = true;
  render();
}

function resize(): void {
  releasePointer(false, true);
  if (root) removeChild(root);
  width = stage.clientWidth; height = stage.clientHeight;
  artwork.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  artwork.setAttribute('width', String(width)); artwork.setAttribute('height', String(height));
  hoverLayer = null; styledLayer = null;
  root = createLayer(null, params.lineGap * 0.56);
  render();
}

function updateModels(): void {
  for (let layer: Layer | null = root; layer; layer = layer.child) {
    layer.model = surface(layer.depth); layer.dirty = true;
  }
  render();
}

stage.addEventListener('pointerdown', onPointerDown);
stage.addEventListener('pointermove', onPointerMove);
stage.addEventListener('pointerup', finishPointer);
stage.addEventListener('pointercancel', finishPointer);
stage.addEventListener('lostpointercapture', finishPointer);
stage.addEventListener('pointerleave', () => {
  if (!pointerLayer && hoverLayer) { hoverLayer.hoveredIndex = -1; hoverLayer.dirty = true; hoverLayer = null; render(); }
});
closeButton.addEventListener('pointerdown', event => event.stopPropagation());
closeButton.addEventListener('click', closeDeepest);
window.addEventListener('keydown', event => { if (event.key === 'Escape') closeDeepest(); });
window.addEventListener('blur', () => releasePointer(false));
window.addEventListener('resize', resize);
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) releasePointer(false, true);
  render();
});

const gui = new GUI({ title: 'Line Pull' });
gui.add(params, 'lineGap', 42, 120, 1).name('line gap').onFinishChange(resize);
gui.add(params, 'lineWidth', 0.5, 6, 0.1).name('line width').onChange(updateModels);
gui.add(params, 'surfaceCurvature', 0, 0.06, 0.001).name('surface curve').onChange(updateModels);
gui.add(params, 'lensStrength', 0, 0.4, 0.005).name('lens strength').onChange(updateModels);
gui.add(params, 'horizontalLens', 0, 0.4, 0.005).name('horizontal lens').onChange(updateModels);
gui.add(params, 'boundaryEase', 0.2, 1.5, 0.01).name('boundary approach').onChange(updateModels);
gui.add(params, 'boundaryCreep', 0, 0.1, 0.001).name('boundary creep').onChange(updateModels);
gui.add(params, 'apexSpacing', 0.05, 0.4, 0.01).name('tip spacing').onChange(updateModels);
gui.add(params, 'followSpeed', 16, 80, 1).name('pull response');
gui.add(params, 'returnStiffness', 80, 420, 1).name('return stiffness');
gui.add(params, 'returnDamping', 8, 42, 0.5).name('return damping');
gui.addColor(params, 'background').name('background').onChange(render);
gui.addColor(params, 'lineColor').name('line').onChange(updateModels);
function updateTheme(): void {
  if (styledLayer) styledLayer.theme = { panelColor: params.panelColor, textColor: params.textColor };
  updateModels();
}
const panelColorController = gui.addColor(params, 'panelColor').name('panel').onChange(updateTheme);
const textColorController = gui.addColor(params, 'textColor').name('text').onChange(updateTheme);
exposeGuiInDebugMode(gui);
resize();
