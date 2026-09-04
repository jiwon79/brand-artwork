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
  surfaceCurvature: 0.022,
  lensStrength: 0.26,
  dragZoom: 0.035,
  splitLift: 1.02,
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
  previousX: number;
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

function findNearestLine(x: number, y: number): number {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < lines.length; index += 1) {
    const distance = Math.abs(distortedY(x, lines[index].baseY) - y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  return nearestIndex;
}

function findLineAtY(x: number, y: number): number | null {
  const index = findNearestLine(x, y);
  const hitSlop = Math.max(8, params.lineWidth * 2);
  return Math.abs(distortedY(x, lines[index].baseY) - y) <= hitSlop ? index : null;
}

function findFirstCrossedLine(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): number | null {
  const sampleX = (fromX + toX) / 2;

  if (toY > fromY) {
    for (let index = 0; index < lines.length; index += 1) {
      const lineY = distortedY(sampleX, lines[index].baseY);
      if (lineY > fromY && lineY <= toY) return index;
    }
  } else if (toY < fromY) {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const lineY = distortedY(sampleX, lines[index].baseY);
      if (lineY < fromY && lineY >= toY) return index;
    }
  }

  return null;
}

function isActiveDrag(currentDrag: DragState): currentDrag is ActiveDragState {
  return currentDrag.originIndex !== null;
}

function lensProgress(currentDrag: ActiveDragState): number {
  const distance = Math.abs(currentDrag.apexY - currentDrag.originY);
  return 1 - Math.exp(-distance / Math.max(params.lineGap * 1.7, 1));
}

function lensCenterY(currentDrag: ActiveDragState): number {
  return currentDrag.originY
    + (currentDrag.apexY - currentDrag.originY) * 0.5;
}

function baseSurfaceY(x: number, baseY: number): number {
  const centerY = height / 2;
  const normalizedX = (x - width / 2) / Math.max(width / 2, 1);
  return centerY
    + (baseY - centerY) * (1 - params.surfaceCurvature * normalizedX ** 2);
}

function distortedY(
  x: number,
  baseY: number,
  currentDrag: ActiveDragState | null = null,
): number {
  const curvedY = baseSurfaceY(x, baseY);

  if (!currentDrag) return curvedY;

  const delta = currentDrag.apexY - currentDrag.originY;
  const direction = Math.sign(delta);

  if (direction === 0) return curvedY;

  const normalizedLensX = (
    x - currentDrag.apexX
  ) / Math.max(width * 0.72, 1);
  const horizontalFalloff = 0.55
    + 0.45 * Math.exp(-(normalizedLensX ** 2) * 1.6);
  const scale = 1
    + params.lensStrength * lensProgress(currentDrag) * horizontalFalloff;
  const signedFromOrigin = (baseY - currentDrag.originY) * direction;

  if (signedFromOrigin <= 0) {
    const originSurfaceY = baseSurfaceY(x, currentDrag.originY);
    const splitOffset = -delta * params.splitLift;
    return originSurfaceY
      + splitOffset
      + (curvedY - originSurfaceY) * scale;
  }

  const signedFromApex = (baseY - currentDrag.apexY) * direction;

  if (signedFromApex >= 0) {
    const apexSurfaceY = baseSurfaceY(x, currentDrag.apexY);
    return currentDrag.apexY + (curvedY - apexSurfaceY) * scale;
  }

  return curvedY;
}

function horizontalPath(
  y: number,
  currentDrag: ActiveDragState | null = null,
): string {
  const segmentCount = Math.max(24, Math.ceil(width / 28));
  const points: string[] = [];

  for (let index = 0; index <= segmentCount; index += 1) {
    const x = (index / segmentCount) * width;
    const pointY = distortedY(x, y, currentDrag);
    points.push(`${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${pointY.toFixed(2)}`);
  }

  return points.join(' ');
}

function splitBoundaryPath(currentDrag: ActiveDragState): string {
  return horizontalPath(currentDrag.originY, currentDrag);
}

function pulledPath(
  baseY: number,
  apexX: number,
  apexY: number,
): string {
  return [
    `M 0 ${baseSurfaceY(0, baseY).toFixed(2)}`,
    `L ${apexX.toFixed(2)} ${apexY.toFixed(2)}`,
    `L ${width.toFixed(2)} ${baseSurfaceY(width, baseY).toFixed(2)}`,
  ].join(' ');
}

function revealClipPath(currentDrag: ActiveDragState): string {
  const leftY = baseSurfaceY(0, currentDrag.originY);
  const rightY = baseSurfaceY(width, currentDrag.originY);

  return [
    splitBoundaryPath(currentDrag),
    `L ${width.toFixed(2)} ${rightY.toFixed(2)}`,
    `L ${currentDrag.apexX.toFixed(2)} ${currentDrag.apexY.toFixed(2)}`,
    `L 0 ${leftY.toFixed(2)}`,
    'Z',
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

  revealPath.setAttribute('d', revealClipPath(currentDrag));
  reveal.setAttribute('opacity', strength.toFixed(3));
  originPullPath.setAttribute(
    'd',
    pulledPath(
      currentDrag.originY,
      currentDrag.apexX,
      currentDrag.apexY,
    ),
  );
  originPullPath.setAttribute('stroke', params.lineColor);
  originPullPath.setAttribute('stroke-width', params.lineWidth.toFixed(2));
  originPullPath.setAttribute('stroke-linecap', 'square');
  originPullPath.setAttribute('stroke-linejoin', 'miter');
  originPullPath.setAttribute('opacity', strength.toFixed(3));

  const splitBoundaryY = distortedY(
    currentDrag.apexX,
    currentDrag.originY,
    currentDrag,
  );
  const copyY = (splitBoundaryY + currentDrag.apexY) / 2;
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
  const zoom = activeDrag ? 1 + params.dragZoom * lensProgress(activeDrag) : 1;

  stage.style.setProperty(
    '--surface-origin',
    activeDrag
      ? `${activeDrag.apexX.toFixed(2)}px ${lensCenterY(activeDrag).toFixed(2)}px`
      : '50% 50%',
  );
  stage.style.setProperty('--surface-scale', zoom.toFixed(4));

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
        ? pulledPath(
          line.baseY,
          activeDrag.apexX,
          activeDrag.apexY,
        )
        : keepOriginal && activeDrag
          ? splitBoundaryPath(activeDrag)
          : horizontalPath(line.baseY, activeDrag),
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
  if (drag?.returning) {
    drag = null;
    stage.classList.remove('is-dragging');
    render();
  }

  if (drag || (event.pointerType === 'mouse' && event.button !== 0)) return;

  event.preventDefault();
  const point = toLocalPoint(event);
  const originIndex = findLineAtY(point.x, point.y);
  const originY = originIndex === null ? point.y : lines[originIndex].baseY;

  drag = {
    pointerId: event.pointerId,
    startY: point.y,
    previousX: point.x,
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
    const previousX = drag.previousX;
    const previousY = drag.previousY;
    drag.apexX = point.x;
    drag.apexY = point.y;
    drag.previousX = point.x;
    drag.previousY = point.y;
    drag.velocityY = 0;

    if (!isActiveDrag(drag)) {
      const crossedIndex = findFirstCrossedLine(
        previousX,
        previousY,
        point.x,
        point.y,
      );
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
    const nextHoveredIndex = findLineAtY(point.x, point.y) ?? -1;
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
gui.add(params, 'surfaceCurvature', 0, 0.06, 0.001).name('surface curve').onChange(render);
gui.add(params, 'lensStrength', 0, 0.4, 0.005).name('lens strength').onChange(render);
gui.add(params, 'dragZoom', 0, 0.08, 0.001).name('drag zoom').onChange(render);
gui.add(params, 'splitLift', 0, 1.2, 0.01).name('split lift').onChange(render);
gui.add(params, 'returnStiffness', 80, 420, 1).name('return stiffness');
gui.add(params, 'returnDamping', 8, 42, 0.5).name('return damping');
gui.addColor(params, 'background').name('background').onChange(render);
gui.addColor(params, 'lineColor').name('line').onChange(render);
gui.addColor(params, 'panelColor').name('panel').onChange(render);
gui.addColor(params, 'textColor').name('text').onChange(render);
exposeGuiInDebugMode(gui);

resize();
requestAnimationFrame(animate);
