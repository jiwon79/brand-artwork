import {
  GOOGLE_COLORS,
  TOKENS,
  buildContactGraph,
  createGoogleGMask,
  createPropagationSchedule,
  findNearestLoop,
  findSeedLoop,
  generateLoops,
  pointAt,
} from './core.js';

const CYCLE_SECONDS = 12;
const SEED = 8421;
const TARGET_LOOP_COUNT = 45;

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
const errorEl = document.getElementById('error') as HTMLDivElement;

type Layout = {
  width: number;
  height: number;
  mask: ReturnType<typeof createGoogleGMask>;
  loops: any[];
  graph: { adjacency: any[][]; edgeCount: number };
};

let layout: Layout | null = null;
let schedule: number[] = [];
let cycleStart = performance.now();
let needsResize = true;
let hoveredLoop = -1;
let pointerDown = false;

window.addEventListener('error', (event) => {
  errorEl.textContent = event.message || 'Render error';
  errorEl.classList.add('show');
});

const resizeObserver = new ResizeObserver(() => {
  needsResize = true;
});
resizeObserver.observe(canvas);

canvas.addEventListener('pointerdown', (event) => {
  pointerDown = true;
  canvas.setPointerCapture(event.pointerId);
  const point = toCanvasPoint(event);
  const nearest = layout ? findNearestLoop(layout.loops, point.x, point.y) : { index: -1, distance: Infinity };
  if (layout && nearest.index >= 0) {
    restartPropagation(nearest.index);
  }
});

canvas.addEventListener('pointermove', (event) => {
  const point = toCanvasPoint(event);
  accelerateNear(point.x, point.y, pointerDown);
});

canvas.addEventListener('pointerup', (event) => {
  pointerDown = false;
  hoveredLoop = -1;
  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener('pointercancel', () => {
  pointerDown = false;
  hoveredLoop = -1;
});

function rebuildLayout(): void {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const mask = createGoogleGMask(width, height);
  const loops = generateLoops({
    width,
    height,
    seed: SEED,
    targetCount: TARGET_LOOP_COUNT,
    mask,
  });
  const graph = buildContactGraph(loops, mask.scale * 22);
  const seedIndex = findSeedLoop(loops, mask);

  layout = { width, height, mask, loops, graph };
  schedule = createPropagationSchedule(loops, graph, seedIndex);
  needsResize = false;
}

function render(now: number): void {
  if (needsResize || !layout) rebuildLayout();
  if (!layout) return;

  const elapsed = getCycleTime(now);
  const fontSize = clamp(layout.mask.scale * 15, 8.5, 16);

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, layout.width, layout.height);

  drawQuietGrain(now, layout.width, layout.height);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (const loop of layout.loops) {
    const activation = getActivation(loop.id, loop, elapsed);
    drawLoopGlow(loop, activation, fontSize);
  }
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${fontSize}px "Arial Black", Impact, sans-serif`;
  for (const loop of layout.loops) {
    const activation = getActivation(loop.id, loop, elapsed);
    drawTextBelt(loop, activation, elapsed, fontSize);
  }
  ctx.restore();

  requestAnimationFrame(render);
}

function drawTextBelt(loop: any, activation: any, elapsed: number, fontSize: number): void {
  const spacing = Math.max(fontSize * 3.8, loop.radius * 0.86);
  const count = Math.ceil(loop.length / spacing) + 2;
  const speedBoost = loop.id === hoveredLoop ? 1.8 : 1;
  const phase = loop.phase + elapsed * loop.speed * loop.direction * speedBoost;
  const color = GOOGLE_COLORS[loop.colorIndex % GOOGLE_COLORS.length];
  const front = activation.front * loop.length;

  for (let k = 0; k < count; k++) {
    const beltDistance = k * spacing;
    const pathDistance = beltDistance + phase;
    const point = pointAt(loop, pathDistance);
    const token = TOKENS[(loop.tokenOffset + k) % TOKENS.length];
    const arc = mod(beltDistance + loop.phase * 0.15, loop.length);
    const lit = activation.energy > 0.02 && (activation.age > 1.18 || arc <= front);
    const frontDelta = Math.abs(arc - front);
    const leading = activation.age >= 0 && activation.age < 1.25 && frontDelta < spacing * 1.2;

    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(point.angle);
    ctx.shadowBlur = 0;

    if (lit) {
      const alpha = 0.42 + activation.energy * 0.52;
      ctx.fillStyle = hexToRgba(color, alpha);
      ctx.shadowColor = color;
      ctx.shadowBlur = leading ? fontSize * 1.25 : fontSize * 0.42;
    } else {
      const alpha = 0.34 + (1 - activation.energy) * 0.34;
      ctx.fillStyle = `rgba(245, 245, 245, ${alpha})`;
    }

    ctx.fillText(token, 0, 0);
    ctx.restore();
  }
}

function drawLoopGlow(loop: any, activation: any, fontSize: number): void {
  if (activation.energy <= 0.03) return;

  const color = GOOGLE_COLORS[loop.colorIndex % GOOGLE_COLORS.length];
  const samples = loop.samples;
  const progress = activation.age < 1.2 ? clamp(activation.front, 0.04, 1) : 1;
  const limit = Math.max(2, Math.floor(samples.length * progress));

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(samples[0].x, samples[0].y);
  for (let i = 1; i < limit; i++) {
    ctx.lineTo(samples[i].x, samples[i].y);
  }
  if (progress >= 0.98) ctx.closePath();
  ctx.strokeStyle = hexToRgba(color, activation.energy * 0.13);
  ctx.lineWidth = fontSize * 1.8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = fontSize * 1.8 * activation.energy;
  ctx.stroke();
  ctx.restore();
}

function drawQuietGrain(now: number, width: number, height: number): void {
  const shift = Math.floor(now / 120) % 5;
  ctx.save();
  ctx.globalAlpha = 0.045;
  ctx.fillStyle = '#fff';
  for (let y = shift; y < height; y += 5) {
    ctx.fillRect(0, y, width, 1);
  }
  ctx.restore();
}

function getActivation(index: number, loop: any, elapsed: number): { age: number; energy: number; front: number } {
  const start = schedule[index] ?? Infinity;
  const age = elapsed - start;
  if (age < 0) return { age, energy: 0, front: 0 };

  const enter = smoothstep(clamp(age / 0.95, 0, 1));
  const decay = elapsed > 10.4 ? 1 - smoothstep(clamp((elapsed - 10.4) / 1.25, 0, 1)) : 1;
  const energy = enter * decay;
  const travelSeconds = Math.max(0.8, loop.length / Math.max(110, loop.speed * 3));
  const front = clamp(age / travelSeconds, 0, 1);

  return { age, energy, front };
}

function restartPropagation(seedIndex: number): void {
  if (!layout) return;
  schedule = createPropagationSchedule(layout.loops, layout.graph, seedIndex);
  cycleStart = performance.now() - 880;
}

function accelerateNear(x: number, y: number, force: boolean): void {
  if (!layout) return;

  const nearest = findNearestLoop(layout.loops, x, y);
  const loop = layout.loops[nearest.index];
  if (!loop || nearest.distance > loop.radius * (force ? 2.3 : 1.25)) {
    if (!force) hoveredLoop = -1;
    return;
  }

  hoveredLoop = nearest.index;
  const elapsed = getCycleTime(performance.now());
  schedule[nearest.index] = Math.min(schedule[nearest.index] ?? Infinity, Math.max(0, elapsed - 0.12));

  for (const edge of layout.graph.adjacency[nearest.index] || []) {
    schedule[edge.to] = Math.min(schedule[edge.to] ?? Infinity, elapsed + 0.34 + Math.min(edge.distance / 90, 0.45));
  }
}

function getCycleTime(now: number): number {
  return mod((now - cycleStart) / 1000, CYCLE_SECONDS);
}

function toCanvasPoint(event: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

requestAnimationFrame(render);
