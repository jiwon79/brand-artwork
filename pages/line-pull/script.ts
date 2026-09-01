import GUI from 'lil-gui';
import { exposeGuiInDebugMode } from '../../common/debug';

const SVG_NS = 'http://www.w3.org/2000/svg';
const RETURN_EPSILON = 0.08;
const SPEED_EPSILON = 0.08;

const stage = document.querySelector<HTMLElement>('#stage');
const artwork = document.querySelector<SVGSVGElement>('#artwork');
const lineField = document.querySelector<SVGGElement>('#line-field');
const reveal = document.querySelector<SVGGElement>('#reveal');
const revealPath = document.querySelector<SVGPathElement>('#reveal-path');
const revealBackground = document.querySelector<SVGRectElement>('#reveal-background');
const revealCopy = document.querySelector<SVGTextElement>('#reveal-copy');
const revealStaticEdge = document.querySelector<SVGPathElement>('#reveal-static-edge');
const hint = document.querySelector<HTMLElement>('#hint');

if (
  !stage
  || !artwork
  || !lineField
  || !reveal
  || !revealPath
  || !revealBackground
  || !revealCopy
  || !revealStaticEdge
  || !hint
) {
  throw new Error('Line Pull: required DOM nodes are missing.');
}

const params = {
  lineGap: 70,
  lineWidth: 3,
  panelRows: 2.15,
  returnStiffness: 205,
  returnDamping: 24,
  background: '#050505',
  lineColor: '#f4f2ec',
  hoverColor: '#ffffff',
  panelColor: '#c61f3f',
  textColor: '#f4f0df',
};

const messages = [
  ['Invisible'],
  ['More', 'Detail'],
  ['Hidden', 'Layers'],
  ['Pull', 'Further'],
];

interface LineState {
  baseY: number;
  path: SVGPathElement;
}

interface DragState {
  pointerId: number;
  originIndex: number;
  originY: number;
  apexX: number;
  apexY: number;
  velocityY: number;
  returning: boolean;
  messageIndex: number;
}

let width = 0;
let height = 0;
let lines: LineState[] = [];
let drag: DragState | null = null;
let hoveredIndex = -1;
let lastFrameTime = performance.now();
let hasInteracted = false;
let interactionCount = 0;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createSvgPath(): SVGPathElement {
  return document.createElementNS(SVG_NS, 'path');
}

function toLocalPoint(event: PointerEvent): { x: number; y: number } {
  const bounds = stage.getBoundingClientRect();
  return {
    x: clamp(event.clientX - bounds.left, 0, bounds.width),
    y: event.clientY - bounds.top,
  };
}

function findNearestLine(y: number): number {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < lines.length; index += 1) {
    const distance = Math.abs(lines[index].baseY - y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  return nearestIndex;
}

function horizontalPath(y: number): string {
  return `M 0 ${y.toFixed(2)} H ${width.toFixed(2)}`;
}

function pulledPath(baseY: number, apexX: number, apexY: number): string {
  return [
    `M 0 ${baseY.toFixed(2)}`,
    `L ${apexX.toFixed(2)} ${apexY.toFixed(2)}`,
    `L ${width.toFixed(2)} ${baseY.toFixed(2)}`,
  ].join(' ');
}

function isLinePulled(baseY: number, originY: number, apexY: number): boolean {
  const minY = Math.min(originY, apexY) - 0.01;
  const maxY = Math.max(originY, apexY) + 0.01;
  return baseY >= minY && baseY <= maxY;
}

function staticPanelEdgeY(currentDrag: DragState): number {
  const edgeDepth = params.lineGap * params.panelRows;
  return currentDrag.apexY >= currentDrag.originY
    ? currentDrag.originY - edgeDepth
    : currentDrag.originY + edgeDepth;
}

function isLineInsidePanel(baseY: number, currentDrag: DragState): boolean {
  if (Math.abs(currentDrag.apexY - currentDrag.originY) < 1) return false;

  const staticEdgeY = staticPanelEdgeY(currentDrag);
  const minY = Math.min(staticEdgeY, currentDrag.originY) + 0.5;
  const maxY = Math.max(staticEdgeY, currentDrag.originY) - 0.5;
  return baseY > minY && baseY < maxY;
}

function setMessage(linesOfCopy: string[]): void {
  revealCopy.replaceChildren();

  const fontSize = clamp(width * 0.22, 64, 190);
  const lineHeight = fontSize * 0.83;
  revealCopy.setAttribute('font-size', fontSize.toFixed(2));

  linesOfCopy.forEach((line, index) => {
    const span = document.createElementNS(SVG_NS, 'tspan');
    span.textContent = line;
    span.setAttribute('x', (width / 2).toFixed(2));
    span.setAttribute('dy', index === 0 ? '0' : lineHeight.toFixed(2));
    revealCopy.appendChild(span);
  });
}

function renderReveal(currentDrag: DragState): void {
  const delta = currentDrag.apexY - currentDrag.originY;
  const strength = clamp(Math.abs(delta) / 10, 0, 1);

  if (strength <= 0.001) {
    reveal.setAttribute('opacity', '0');
    revealPath.setAttribute('d', '');
    revealStaticEdge.setAttribute('opacity', '0');
    revealStaticEdge.setAttribute('d', '');
    return;
  }

  const pullingDown = delta >= 0;
  const staticEdgeY = staticPanelEdgeY(currentDrag);

  const path = pullingDown
    ? [
        `M 0 ${staticEdgeY.toFixed(2)}`,
        `H ${width.toFixed(2)}`,
        `V ${currentDrag.originY.toFixed(2)}`,
        `L ${currentDrag.apexX.toFixed(2)} ${currentDrag.apexY.toFixed(2)}`,
        `L 0 ${currentDrag.originY.toFixed(2)}`,
        'Z',
      ].join(' ')
    : [
        `M 0 ${currentDrag.originY.toFixed(2)}`,
        `L ${currentDrag.apexX.toFixed(2)} ${currentDrag.apexY.toFixed(2)}`,
        `L ${width.toFixed(2)} ${currentDrag.originY.toFixed(2)}`,
        `V ${staticEdgeY.toFixed(2)}`,
        `H 0`,
        'Z',
      ].join(' ');

  revealPath.setAttribute('d', path);
  reveal.setAttribute('opacity', strength.toFixed(3));
  revealStaticEdge.setAttribute('d', horizontalPath(staticEdgeY));
  revealStaticEdge.setAttribute('stroke', params.lineColor);
  revealStaticEdge.setAttribute('stroke-width', params.lineWidth.toFixed(2));
  revealStaticEdge.setAttribute('opacity', strength.toFixed(3));

  const copyY = staticEdgeY + (currentDrag.apexY - staticEdgeY) * 0.42;
  const copyLines = messages[currentDrag.messageIndex];
  const fontSize = Number(revealCopy.getAttribute('font-size')) || 72;
  const totalTextHeight = (copyLines.length - 1) * fontSize * 0.83;
  revealCopy.setAttribute('x', (width / 2).toFixed(2));
  revealCopy.setAttribute('y', (copyY - totalTextHeight / 2).toFixed(2));
}

function render(): void {
  document.documentElement.style.backgroundColor = params.background;
  document.body.style.backgroundColor = params.background;
  stage.style.backgroundColor = params.background;

  revealBackground.setAttribute('x', '0');
  revealBackground.setAttribute('y', '0');
  revealBackground.setAttribute('width', width.toFixed(2));
  revealBackground.setAttribute('height', height.toFixed(2));
  revealBackground.setAttribute('fill', params.panelColor);
  revealCopy.setAttribute('fill', params.textColor);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const pulled = drag
      ? isLinePulled(line.baseY, drag.originY, drag.apexY)
      : false;
    const hiddenByPanel = drag ? isLineInsidePanel(line.baseY, drag) : false;

    line.path.setAttribute('visibility', hiddenByPanel ? 'hidden' : 'visible');
    line.path.setAttribute(
      'd',
      pulled && drag
        ? pulledPath(line.baseY, drag.apexX, drag.apexY)
        : horizontalPath(line.baseY),
    );
    line.path.setAttribute('stroke-width', params.lineWidth.toFixed(2));
    line.path.setAttribute(
      'stroke',
      index === hoveredIndex && !drag ? params.hoverColor : params.lineColor,
    );
  }

  if (drag) renderReveal(drag);
  else {
    reveal.setAttribute('opacity', '0');
    revealPath.setAttribute('d', '');
    revealStaticEdge.setAttribute('opacity', '0');
    revealStaticEdge.setAttribute('d', '');
  }
}

function buildLineField(): void {
  lineField.replaceChildren();
  lines = [];

  const gap = params.lineGap;
  const firstY = gap * 0.56 - gap;
  const lineCount = Math.ceil((height - firstY) / gap) + 1;

  for (let index = 0; index < lineCount; index += 1) {
    const baseY = firstY + index * gap;
    const path = createSvgPath();
    path.setAttribute('d', horizontalPath(baseY));
    path.setAttribute('stroke', params.lineColor);
    path.setAttribute('stroke-width', params.lineWidth.toFixed(2));
    path.setAttribute('stroke-linecap', 'square');
    path.setAttribute('stroke-linejoin', 'miter');
    lineField.appendChild(path);
    lines.push({ baseY, path });
  }
}

function cancelDrag(immediate: boolean): void {
  if (!drag) return;

  if (immediate || reducedMotion.matches) {
    drag = null;
    stage.classList.remove('is-dragging');
    render();
    return;
  }

  drag.pointerId = -1;
  drag.returning = true;
  drag.velocityY = 0;
  stage.classList.remove('is-dragging');
}

function resize(): void {
  width = window.innerWidth;
  height = window.innerHeight;
  artwork.setAttribute('viewBox', `0 0 ${width} ${height}`);
  artwork.setAttribute('width', width.toFixed(0));
  artwork.setAttribute('height', height.toFixed(0));
  cancelDrag(true);
  buildLineField();
  setMessage(messages[0]);
  render();
}

function onPointerDown(event: PointerEvent): void {
  if (drag || (event.pointerType === 'mouse' && event.button !== 0)) return;

  event.preventDefault();
  const point = toLocalPoint(event);
  const originIndex = findNearestLine(point.y);
  const originY = lines[originIndex].baseY;

  drag = {
    pointerId: event.pointerId,
    originIndex,
    originY,
    apexX: point.x,
    apexY: point.y,
    velocityY: 0,
    returning: false,
    messageIndex: interactionCount % messages.length,
  };

  interactionCount += 1;
  setMessage(messages[drag.messageIndex]);
  hoveredIndex = -1;
  stage.classList.add('is-dragging');
  stage.setPointerCapture(event.pointerId);

  if (!hasInteracted) {
    hasInteracted = true;
    hint.classList.add('is-hidden');
  }

  render();
}

function onPointerMove(event: PointerEvent): void {
  const point = toLocalPoint(event);

  if (drag && drag.pointerId === event.pointerId && !drag.returning) {
    event.preventDefault();
    drag.apexX = point.x;
    drag.apexY = point.y;
    drag.velocityY = 0;
    render();
    return;
  }

  if (!drag && event.pointerType !== 'touch') {
    const nextHoveredIndex = findNearestLine(point.y);
    if (nextHoveredIndex !== hoveredIndex) {
      hoveredIndex = nextHoveredIndex;
      render();
    }
  }
}

function finishPointer(event: PointerEvent): void {
  if (!drag || drag.pointerId !== event.pointerId || drag.returning) return;

  if (stage.hasPointerCapture(event.pointerId)) {
    stage.releasePointerCapture(event.pointerId);
  }
  cancelDrag(false);
}

function onPointerLeave(event: PointerEvent): void {
  if (drag || event.pointerType === 'touch') return;
  hoveredIndex = -1;
  render();
}

function onLostPointerCapture(event: PointerEvent): void {
  if (!drag || drag.pointerId !== event.pointerId || drag.returning) return;
  cancelDrag(false);
}

function animate(now: number): void {
  const deltaTime = Math.min((now - lastFrameTime) / 1000, 0.032);
  lastFrameTime = now;

  if (drag?.returning) {
    const displacement = drag.originY - drag.apexY;
    drag.velocityY += displacement * params.returnStiffness * deltaTime;
    drag.velocityY *= Math.exp(-params.returnDamping * deltaTime);
    drag.apexY += drag.velocityY * deltaTime;

    if (
      Math.abs(displacement) < RETURN_EPSILON
      && Math.abs(drag.velocityY) < SPEED_EPSILON
    ) {
      drag = null;
    }

    render();
  }

  requestAnimationFrame(animate);
}

stage.addEventListener('pointerdown', onPointerDown);
stage.addEventListener('pointermove', onPointerMove);
stage.addEventListener('pointerup', finishPointer);
stage.addEventListener('pointercancel', finishPointer);
stage.addEventListener('pointerleave', onPointerLeave);
stage.addEventListener('lostpointercapture', onLostPointerCapture);
window.addEventListener('blur', () => cancelDrag(false));
window.addEventListener('resize', resize);

const gui = new GUI({ title: 'Line Pull' });
gui.add(params, 'lineGap', 42, 120, 1).name('line gap').onFinishChange(resize);
gui.add(params, 'lineWidth', 0.5, 6, 0.1).name('line width').onChange(render);
gui.add(params, 'panelRows', 0.5, 3, 0.05).name('panel rows').onChange(render);
gui.add(params, 'returnStiffness', 80, 420, 1).name('return stiffness');
gui.add(params, 'returnDamping', 8, 42, 0.5).name('return damping');
gui.addColor(params, 'background').name('background').onChange(render);
gui.addColor(params, 'lineColor').name('line').onChange(render);
gui.addColor(params, 'panelColor').name('panel').onChange(render);
gui.addColor(params, 'textColor').name('text').onChange(render);
exposeGuiInDebugMode(gui);

resize();
requestAnimationFrame(animate);
