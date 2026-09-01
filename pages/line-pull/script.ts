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
const originPullPath = document.querySelector<SVGPathElement>('#origin-pull-path');
const hint = document.querySelector<HTMLElement>('#hint');

if (
  !stage
  || !artwork
  || !lineField
  || !reveal
  || !revealPath
  || !revealBackground
  || !revealCopy
  || !originPullPath
  || !hint
) {
  throw new Error('Line Pull: required DOM nodes are missing.');
}

const params = {
  lineGap: 70,
  lineWidth: 3,
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
  startY: number;
  previousY: number;
  originIndex: number | null;
  originY: number;
  apexX: number;
  apexY: number;
  velocityY: number;
  returning: boolean;
  messageIndex: number;
}

type ActiveDragState = DragState & { originIndex: number };

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

function findLineAtY(y: number): number | null {
  const index = findNearestLine(y);
  const hitSlop = Math.max(8, params.lineWidth * 2);
  return Math.abs(lines[index].baseY - y) <= hitSlop ? index : null;
}

function findFirstCrossedLine(fromY: number, toY: number): number | null {
  if (toY > fromY) {
    for (let index = 0; index < lines.length; index += 1) {
      const lineY = lines[index].baseY;
      if (lineY > fromY && lineY <= toY) return index;
    }
  } else if (toY < fromY) {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const lineY = lines[index].baseY;
      if (lineY < fromY && lineY >= toY) return index;
    }
  }

  return null;
}

function isActiveDrag(currentDrag: DragState): currentDrag is ActiveDragState {
  return currentDrag.originIndex !== null;
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

function clearReveal(): void {
  reveal.setAttribute('opacity', '0');
  revealPath.setAttribute('d', '');
  originPullPath.setAttribute('opacity', '0');
  originPullPath.setAttribute('d', '');
}

function renderReveal(currentDrag: ActiveDragState): void {
  const delta = currentDrag.apexY - currentDrag.originY;
  const strength = clamp(Math.abs(delta) / 10, 0, 1);

  if (strength <= 0.001) {
    clearReveal();
    return;
  }

  const path = [
    `M 0 ${currentDrag.originY.toFixed(2)}`,
    `L ${currentDrag.apexX.toFixed(2)} ${currentDrag.apexY.toFixed(2)}`,
    `L ${width.toFixed(2)} ${currentDrag.originY.toFixed(2)}`,
    'Z',
  ].join(' ');

  revealPath.setAttribute('d', path);
  reveal.setAttribute('opacity', strength.toFixed(3));
  originPullPath.setAttribute(
    'd',
    pulledPath(currentDrag.originY, currentDrag.apexX, currentDrag.apexY),
  );
  originPullPath.setAttribute('stroke', params.lineColor);
  originPullPath.setAttribute('stroke-width', params.lineWidth.toFixed(2));
  originPullPath.setAttribute('stroke-linecap', 'square');
  originPullPath.setAttribute('stroke-linejoin', 'miter');
  originPullPath.setAttribute('opacity', strength.toFixed(3));

  const copyY = currentDrag.originY + delta * 0.52;
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

  const activeDrag = drag && isActiveDrag(drag) ? drag : null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const pulled = activeDrag
      ? isLinePulled(line.baseY, activeDrag.originY, activeDrag.apexY)
      : false;
    const keepOriginal = activeDrag?.originIndex === index;

    line.path.setAttribute('visibility', 'visible');
    line.path.setAttribute(
      'd',
      pulled && activeDrag && !keepOriginal
        ? pulledPath(line.baseY, activeDrag.apexX, activeDrag.apexY)
        : horizontalPath(line.baseY),
    );
    line.path.setAttribute('stroke-width', params.lineWidth.toFixed(2));
    line.path.setAttribute(
      'stroke',
      index === hoveredIndex && !drag ? params.hoverColor : params.lineColor,
    );
  }

  if (activeDrag) renderReveal(activeDrag);
  else clearReveal();
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

  if (!isActiveDrag(drag) || immediate || reducedMotion.matches) {
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
  const originIndex = findLineAtY(point.y);
  const originY = originIndex === null ? point.y : lines[originIndex].baseY;

  drag = {
    pointerId: event.pointerId,
    startY: point.y,
    previousY: point.y,
    originIndex,
    originY,
    apexX: point.x,
    apexY: point.y,
    velocityY: 0,
    returning: false,
    messageIndex: interactionCount % messages.length,
  };

  if (isActiveDrag(drag)) {
    interactionCount += 1;
    setMessage(messages[drag.messageIndex]);
  }
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
    const previousY = drag.previousY;
    drag.apexX = point.x;
    drag.apexY = point.y;
    drag.previousY = point.y;
    drag.velocityY = 0;

    if (!isActiveDrag(drag)) {
      const crossedIndex = findFirstCrossedLine(previousY, point.y);
      if (crossedIndex !== null) {
        drag.originIndex = crossedIndex;
        drag.originY = lines[crossedIndex].baseY;
        drag.messageIndex = interactionCount % messages.length;
        interactionCount += 1;
        setMessage(messages[drag.messageIndex]);
      }
    }

    render();
    return;
  }

  if (!drag && event.pointerType !== 'touch') {
    const nextHoveredIndex = findLineAtY(point.y) ?? -1;
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

  if (drag?.returning && isActiveDrag(drag)) {
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
gui.add(params, 'returnStiffness', 80, 420, 1).name('return stiffness');
gui.add(params, 'returnDamping', 8, 42, 0.5).name('return damping');
gui.addColor(params, 'background').name('background').onChange(render);
gui.addColor(params, 'lineColor').name('line').onChange(render);
gui.addColor(params, 'panelColor').name('panel').onChange(render);
gui.addColor(params, 'textColor').name('text').onChange(render);
exposeGuiInDebugMode(gui);

resize();
requestAnimationFrame(animate);
