import { Delaunay } from 'd3-delaunay';

type Point = {
  x: number;
  y: number;
};

type Shard = {
  polygon: Point[];
  center: Point;
  lift: number;
  tint: number;
  angle: number;
  split: number;
  phase: number;
};

type CrackEdge = {
  a: Point;
  b: Point;
  weight: number;
};

type BreakZone = {
  id: number;
  seed: number;
  center: Point;
  radius: number;
  damage: number;
  mix: number;
  fractureCount: number;
  progress: number;
  target: number;
  shards: Shard[];
  edges: CrackEdge[];
  crumbs: Array<Point & { size: number; phase: number }>;
};

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
const resetButton = document.querySelector('.reset-button') as HTMLButtonElement;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const EPSILON = 0.0001;

const palette = {
  wax: '#c7f06b',
  waxLight: '#eefca4',
  waxDark: '#7d9a26',
  core: '#fbfbf6',
  coreHot: '#ffffff',
  coreDeep: '#d9ded7',
  rubber: '#eafcff',
  crack: '#f9fbf2',
  table: '#171214',
};

let width = 0;
let height = 0;
let dpr = 1;
let ball: { x: number; y: number; radius: number } = { x: 0, y: 0, radius: 1 };
let pointer: Point = { x: 0, y: 0 };
let pressure = 0;
let targetPressure = 0;
let isDown = false;
let activePointerId: number | null = null;
let zones: BreakZone[] = [];
let zoneId = 1;
let audioContext: AudioContext | null = null;
let lastTimestamp = performance.now();
let lastBreakAt = 0;
let lastHoldBreakAt = 0;
let holdDuration = 0;
let inputForce = 1;

function resize(): void {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const viewportLimit = Math.min(width * 0.78, height * 0.78);
  ball = {
    x: width * 0.5,
    y: height * (width < height ? 0.5 : 0.52),
    radius: Math.max(128, Math.min(335, viewportLimit * 0.5)),
  };

  if (zones.length > 0) resetArtwork();
}

function resetArtwork(): void {
  zones = [];
  pressure = 0;
  targetPressure = 0;
  zoneId = 1;
  pointer = { x: ball.x, y: ball.y };
}

function createBreakZone(point: Point, force = 1): BreakZone {
  const center = clampToBall(point, 0.94);
  const seed = Math.floor(Math.random() * 1_000_000_000) + zoneId * 1009;
  const rng = mulberry32(seed);
  const forceScale = Math.min(1.8, Math.max(0.45, force));
  const impactRadius = ball.radius
    * (0.22 + rng() * 0.1)
    * (0.88 + forceScale * 0.16);
  const pointCount = Math.round(12 + forceScale * 4 + rng() * 6);
  const impactPolygon = createImpactPolygon(center, impactRadius, 15 + Math.floor(rng() * 7), rng);
  const points = createImpactPoints(center, impactRadius, impactPolygon, pointCount, rng);
  const cells = createVoronoiCells(points, impactPolygon, boundsFromPolygon(impactPolygon, impactRadius * 0.55));
  const shards: Shard[] = [];
  const edgeMap = new Map<string, CrackEdge & { count: number }>();

  cells.forEach((cell, index) => {
    addShard(cell, shards, edgeMap, seed + index * 37);
  });

  const edges = Array.from(edgeMap.values())
    .filter((edge) => edge.count > 1)
    .map((edge) => ({ a: edge.a, b: edge.b, weight: edge.weight }));
  const crumbs = createCrumbsFromEdges(edges, seed);

  return {
    id: zoneId++,
    seed,
    center,
    radius: impactRadius,
    damage: forceScale,
    mix: 0,
    fractureCount: 0,
    progress: 0,
    target: 1,
    shards,
    edges,
    crumbs,
  };
}

function addShard(
  polygon: Point[],
  shards: Shard[],
  edgeMap: Map<string, CrackEdge & { count: number }>,
  seed: number,
  split = 0,
  minArea = 24,
): void {
  if (Math.abs(polygonArea(polygon)) < minArea) return;

  const center = polygonCentroid(polygon);
  const shard: Shard = {
    polygon,
    center,
    lift: 2.5 + noise(seed) * 7 + split * 0.7,
    tint: noise(seed + 9) - 0.5,
    angle: (noise(seed + 18) - 0.5) * (0.04 + split * 0.01),
    split,
    phase: noise(seed + 29) * Math.PI * 2,
  };

  shards.push(shard);
  registerShardEdges(shard, edgeMap, seed);
}

function registerShardEdges(
  shard: Shard,
  edgeMap: Map<string, CrackEdge & { count: number }>,
  seed: number,
): void {
  const fromBall = normalize(sub(shard.center, ball));

  for (let i = 0; i < shard.polygon.length; i += 1) {
    const a = shard.polygon[i];
    const b = shard.polygon[(i + 1) % shard.polygon.length];
    const key = edgeKey(a, b);
    const edge = edgeMap.get(key);
    if (edge) {
      edge.count += 1;
    } else {
      edgeMap.set(key, {
        a,
        b,
        count: 1,
        weight: 1.2 + Math.max(0, dot(fromBall, normalize(sub(midpoint(a, b), ball)))) * 1.2 + noise(seed + i * 7) * 1.4,
      });
    }
  }
}

function createImpactPolygon(center: Point, radius: number, sides: number, rng: () => number): Point[] {
  const points: Point[] = [];
  const lean = (rng() - 0.5) * 0.18;

  for (let i = 0; i < sides; i += 1) {
    const angle = (i / sides) * Math.PI * 2 + lean * Math.sin(i * 0.7);
    const variance = 0.9 + rng() * 0.16;
    points.push(clampToBall({
      x: center.x + Math.cos(angle) * radius * variance,
      y: center.y + Math.sin(angle) * radius * variance * (0.86 + rng() * 0.1),
    }, 0.992));
  }

  return points;
}

function createImpactPoints(
  center: Point,
  radius: number,
  polygon: Point[],
  count: number,
  rng: () => number,
): Point[] {
  const points: Point[] = [center];
  const boundaryCount = 8;

  for (let i = 0; i < boundaryCount; i += 1) {
    const angle = (i / boundaryCount) * Math.PI * 2 + (rng() - 0.5) * 0.18;
    points.push(clampToBall({
      x: center.x + Math.cos(angle) * radius * (0.72 + rng() * 0.16),
      y: center.y + Math.sin(angle) * radius * (0.64 + rng() * 0.16),
    }, 0.992));
  }

  let attempts = 0;
  while (points.length < count && attempts < count * 80) {
    attempts += 1;
    const angle = rng() * Math.PI * 2;
    const band = Math.sqrt(rng());
    const point = clampToBall({
      x: center.x + Math.cos(angle) * radius * band * (0.98 + rng() * 0.12),
      y: center.y + Math.sin(angle) * radius * band * (0.84 + rng() * 0.1),
    }, 0.992);

    if (pointInPolygon(point, polygon) && isInsideBall(point)) {
      points.push(point);
    }
  }

  return points;
}

function createVoronoiCells(
  points: Point[],
  clipPolygon: Point[],
  bounds: [number, number, number, number],
  minArea = 42,
): Point[][] {
  if (points.length < 3) return [];

  const delaunay = Delaunay.from(points, (point) => point.x, (point) => point.y);
  const voronoi = delaunay.voronoi(bounds);
  const polygons: Point[][] = [];

  for (let i = 0; i < points.length; i += 1) {
    const cell = voronoi.cellPolygon(i);
    if (!cell || cell.length < 4) continue;
    const subject = cell.slice(0, -1).map(([x, y]) => ({ x, y }));
    const clipped = clipPolygonToConvex(subject, clipPolygon);
    if (clipped.length >= 3 && Math.abs(polygonArea(clipped)) > minArea) {
      polygons.push(clipped);
    }
  }

  return polygons;
}

function clipPolygonToConvex(subject: Point[], clip: Point[]): Point[] {
  let output = subject.slice();
  const clipSign = Math.sign(polygonArea(clip)) || 1;

  for (let i = 0; i < clip.length; i += 1) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    if (input.length === 0) break;

    let start = input[input.length - 1];
    for (const end of input) {
      const endInside = isInsideClip(end, a, b, clipSign);
      const startInside = isInsideClip(start, a, b, clipSign);

      if (endInside) {
        if (!startInside) output.push(lineIntersection(start, end, a, b));
        output.push(end);
      } else if (startInside) {
        output.push(lineIntersection(start, end, a, b));
      }

      start = end;
    }
  }

  return dedupePoints(output);
}

function isInsideClip(point: Point, a: Point, b: Point, sign: number): boolean {
  const value = cross(sub(b, a), sub(point, a));
  return sign >= 0 ? value >= -EPSILON : value <= EPSILON;
}

function lineIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point {
  const r = sub(p2, p1);
  const s = sub(p4, p3);
  const denom = cross(r, s);
  if (Math.abs(denom) < EPSILON) return { ...p2 };
  const t = cross(sub(p3, p1), s) / denom;
  return {
    x: p1.x + r.x * t,
    y: p1.y + r.y * t,
  };
}

function dedupePoints(points: Point[]): Point[] {
  const deduped: Point[] = [];

  for (const point of points) {
    const previous = deduped[deduped.length - 1];
    if (!previous || distance(previous, point) > 0.2) {
      deduped.push(point);
    }
  }

  if (deduped.length > 1 && distance(deduped[0], deduped[deduped.length - 1]) < 0.2) {
    deduped.pop();
  }

  return deduped;
}

function draw(timestamp: number): void {
  const dt = Math.min(0.04, (timestamp - lastTimestamp) / 1000);
  lastTimestamp = timestamp;
  pressure += (targetPressure - pressure) * (reducedMotion ? 0.4 : 0.16);

  if (isDown && isInsideBall(pointer)) {
    holdDuration += dt;
    const holdForce = Math.min(2.2, inputForce + holdDuration * 0.7);
    targetPressure = Math.max(targetPressure, Math.min(1.3, holdForce * 0.58));
    mixTouchedZones(pointer, holdForce, dt);

    const interval = Math.max(90, 260 - holdForce * 58);
    if (timestamp - lastHoldBreakAt > interval) {
      triggerBreak(pointer, holdForce, true);
      lastHoldBreakAt = timestamp;
    }
  }

  zones.forEach((zone) => {
    zone.progress += (zone.target - zone.progress) * (reducedMotion ? 0.5 : 0.08);
  });

  drawBackdrop();
  drawShadow();
  drawCore(timestamp);
  drawWaxShell(timestamp);
  zones.forEach((zone) => drawZone(zone, timestamp));
  drawRubberMembrane(timestamp);
  drawFingerDent();

  requestAnimationFrame(draw);
}

function drawBackdrop(): void {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#251c1f');
  gradient.addColorStop(0.55, palette.table);
  gradient.addColorStop(1, '#0e0b0d');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#ffe9c4';
  ctx.beginPath();
  ctx.ellipse(ball.x - ball.radius * 0.16, ball.y - ball.radius * 0.18, ball.radius * 0.92, ball.radius * 0.66, -0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawShadow(): void {
  ctx.save();
  ctx.globalAlpha = 0.62;
  ctx.filter = `blur(${Math.max(14, ball.radius * 0.09)}px)`;
  ctx.fillStyle = '#050405';
  ctx.beginPath();
  ctx.ellipse(ball.x, ball.y + ball.radius * 0.84, ball.radius * 0.88, ball.radius * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCore(timestamp: number): void {
  const wobble = reducedMotion ? 0 : Math.sin(timestamp * 0.0021) * 0.018;
  const dent = isInsideBall(pointer) ? pressure * 0.055 : 0;
  const radius = ball.radius * (0.84 + wobble);
  const gradient = ctx.createRadialGradient(
    ball.x - ball.radius * 0.28,
    ball.y - ball.radius * 0.24,
    ball.radius * 0.05,
    ball.x,
    ball.y,
    radius,
  );
  gradient.addColorStop(0, palette.coreHot);
  gradient.addColorStop(0.46, palette.core);
  gradient.addColorStop(1, palette.coreDeep);

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(ball.x, ball.y + ball.radius * dent, radius * (1 + pressure * 0.025), radius * (0.96 - pressure * 0.02), 0, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.globalAlpha = 0.16 + pressure * 0.08;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1.2, ball.radius * 0.012);
  for (let i = 0; i < 7; i += 1) {
    const y = ball.y - ball.radius * 0.34 + i * ball.radius * 0.1 + Math.sin(timestamp * 0.0015 + i) * 3;
    ctx.beginPath();
    ctx.ellipse(ball.x + Math.sin(i * 1.7) * ball.radius * 0.12, y, ball.radius * (0.2 - i * 0.012), ball.radius * 0.018, -0.2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWaxShell(timestamp: number): void {
  const gradient = ctx.createRadialGradient(
    ball.x - ball.radius * 0.34,
    ball.y - ball.radius * 0.34,
    ball.radius * 0.05,
    ball.x,
    ball.y,
    ball.radius,
  );
  gradient.addColorStop(0, palette.waxLight);
  gradient.addColorStop(0.52, palette.wax);
  gradient.addColorStop(1, palette.waxDark);

  ctx.save();
  clipBall(0.98);
  ctx.globalAlpha = 0.98;
  ctx.fillStyle = gradient;
  ctx.fillRect(ball.x - ball.radius, ball.y - ball.radius, ball.radius * 2, ball.radius * 2);

  ctx.globalAlpha = 0.2;
  for (let i = 0; i < 120; i += 1) {
    const angle = i * 2.39996;
    const radius = ball.radius * Math.sqrt(noise(i * 53));
    const x = ball.x + Math.cos(angle) * radius;
    const y = ball.y + Math.sin(angle) * radius;
    ctx.fillStyle = i % 2 === 0 ? '#f7ffc4' : '#6d8621';
    ctx.fillRect(x, y, 1.2 + noise(i) * 1.6, 1.2 + noise(i + 1) * 1.6);
  }

  ctx.globalAlpha = 0.25 + Math.sin(timestamp * 0.0012) * 0.04;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(ball.x - ball.radius * 0.34, ball.y - ball.radius * 0.38, ball.radius * 0.22, ball.radius * 0.055, -0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawZone(zone: BreakZone, timestamp: number): void {
  const t = smoothstep(zone.progress);
  const mix = smoothstep(zone.mix);
  ctx.save();
  clipBall(0.992);

  drawCoreReveal(zone, t, mix);

  for (const shard of zone.shards) {
    const outward = normalize(sub(shard.center, zone.center));
    const splitJitter = reducedMotion ? 0 : Math.sin(timestamp * 0.003 + shard.phase) * shard.split * 0.18;
    const offset = mul(outward, (shard.lift + splitJitter) * t * (1 + zone.damage * 0.12));
    const angle = shard.angle * t * (1 + zone.damage * 0.16);
    const color = adjustWaxColor(shard.tint, t, mix);

    ctx.save();
    ctx.globalAlpha = 0.93 + t * 0.06;
    ctx.translate(shard.center.x + offset.x, shard.center.y + offset.y);
    ctx.rotate(angle);
    ctx.translate(-shard.center.x, -shard.center.y);
    drawPolygon(shard.polygon);
    ctx.fillStyle = color;
    ctx.shadowColor = `rgba(91, 111, 30, ${0.16 * t})`;
    ctx.shadowBlur = 6 * t;
    ctx.shadowOffsetY = 2 * t;
    ctx.fill();
    ctx.restore();
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  drawMixedCracks(zone, t, mix, timestamp);

  zone.edges.forEach((edge, index) => {
    const pulse = 0.88 + Math.sin(timestamp * 0.003 + zone.id + index) * 0.12;
    ctx.strokeStyle = `rgba(255, 255, 248, ${(0.42 + mix * 0.2) * t})`;
    ctx.lineWidth = (2.1 + edge.weight * (0.82 + zone.damage * 0.16)) * t * pulse;
    drawJaggedLine(edge.a, edge.b, zone.id * 1000 + index * 13);
  });

  zone.edges.forEach((edge, index) => {
    const pulse = 0.9 + Math.sin(timestamp * 0.003 + zone.id + index) * 0.1;
    ctx.strokeStyle = `rgba(107, 126, 42, ${(0.18 - mix * 0.05) * t})`;
    ctx.lineWidth = (0.58 + edge.weight * (0.22 + zone.damage * 0.035)) * t * pulse;
    drawJaggedLine(edge.a, edge.b, zone.id * 1000 + index * 13);
  });

  zone.crumbs.forEach((crumb) => {
    const drift = reducedMotion ? 0 : Math.sin(timestamp * 0.004 + crumb.phase) * 1.8;
    ctx.globalAlpha = 0.2 + t * 0.52;
    ctx.fillStyle = '#edf9a6';
    ctx.beginPath();
    ctx.arc(crumb.x + drift, crumb.y - drift * 0.35, crumb.size * t, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

function drawCoreReveal(zone: BreakZone, progress: number, mix: number): void {
  if (progress <= 0.01) return;

  const gradient = ctx.createRadialGradient(
    zone.center.x - zone.radius * 0.25,
    zone.center.y - zone.radius * 0.22,
    zone.radius * 0.08,
    zone.center.x,
    zone.center.y,
    zone.radius * 0.92,
  );
  gradient.addColorStop(0, `rgba(255, 255, 255, ${0.84 + mix * 0.12})`);
  gradient.addColorStop(0.5, `rgba(248, 250, 244, ${0.66 + mix * 0.2})`);
  gradient.addColorStop(1, 'rgba(218, 222, 214, 0)');

  ctx.save();
  ctx.globalAlpha = progress * (0.5 + mix * 0.34);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(zone.center.x, zone.center.y, zone.radius * 0.74, zone.radius * 0.62, 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMixedCracks(zone: BreakZone, progress: number, mix: number, timestamp: number): void {
  if (mix <= 0.02) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  zone.edges.forEach((edge, index) => {
    if (index % 2 === 1 && mix < 0.48) return;
    const pulse = 0.82 + Math.sin(timestamp * 0.004 + edge.weight + zone.id) * 0.18;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.28 * progress * mix})`;
    ctx.lineWidth = (4.2 + edge.weight * 1.35) * mix * progress * pulse;
    drawJaggedLine(edge.a, edge.b, zone.id * 5000 + index * 31);
  });
  ctx.restore();
}

function drawRubberMembrane(timestamp: number): void {
  const wobble = reducedMotion ? 0 : Math.sin(timestamp * 0.0017) * 0.006;
  ctx.save();
  ctx.globalAlpha = 0.78;
  ctx.lineWidth = Math.max(5, ball.radius * 0.026);
  ctx.strokeStyle = 'rgba(214, 241, 235, 0.82)';
  ctx.beginPath();
  ctx.ellipse(ball.x, ball.y, ball.radius * (1.02 + wobble), ball.radius * (1.0 - wobble), 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 0.54;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(ball.x + ball.radius * 0.34, ball.y - ball.radius * 0.36, ball.radius * 0.075, ball.radius * 0.04, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFingerDent(): void {
  if (!isInsideBall(pointer) || pressure < 0.02) return;
  const radius = ball.radius * (0.13 + pressure * 0.08);

  ctx.save();
  clipBall(1);
  const gradient = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, radius);
  gradient.addColorStop(0, `rgba(54, 48, 18, ${0.28 * pressure})`);
  gradient.addColorStop(0.6, `rgba(255, 255, 255, ${0.08 * pressure})`);
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(pointer.x, pointer.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function triggerBreak(point: Point, force = 1, fromHold = false): void {
  if (!isInsideBall(point)) return;
  lastBreakAt = performance.now();
  targetPressure = Math.max(targetPressure, 1);

  const touchedZone = findBreakableZone(point);
  if (touchedZone) {
    fractureExistingZone(touchedZone, point, force, fromHold);
    mixTouchedZones(point, force, fromHold ? 0.09 : 0.05);
    playCrack(force * (fromHold ? 0.72 : 1));
    return;
  }

  const zone = createBreakZone(point, force);
  zones.push(zone);
  mixTouchedZones(point, force, fromHold ? 0.08 : 0.04);
  playCrack(force);
}

function findBreakableZone(point: Point): BreakZone | null {
  let nearest: BreakZone | null = null;
  let nearestScore = Infinity;

  for (const zone of zones) {
    const insideShard = zone.shards.some((shard) => pointInPolygon(point, shard.polygon));
    const zoneDistance = distance(point, zone.center);
    const touchesZone = insideShard || zoneDistance < zone.radius * (1.08 + zone.mix * 0.16);
    if (!touchesZone) continue;

    const score = insideShard ? zoneDistance / (zone.radius * 2) : zoneDistance / zone.radius;
    if (score < nearestScore) {
      nearest = zone;
      nearestScore = score;
    }
  }

  return nearest;
}

function fractureExistingZone(zone: BreakZone, point: Point, force: number, fromHold: boolean): void {
  const forceScale = Math.min(2.4, Math.max(0.55, force));
  const seed = zone.seed + zone.fractureCount * 4099 + Math.floor(performance.now());
  const rng = mulberry32(seed);
  const breakRadius = Math.min(
    zone.radius * (0.36 + forceScale * 0.11 + zone.mix * 0.08),
    ball.radius * (0.09 + forceScale * 0.045 + zone.mix * 0.045),
  );
  const candidates = zone.shards
    .map((shard, index) => ({
      shard,
      index,
      contains: pointInPolygon(point, shard.polygon),
      distance: distance(point, shard.center),
    }))
    .filter((candidate) => (
      candidate.contains
      || candidate.distance < breakRadius * (1.05 + Math.min(candidate.shard.split, 4) * 0.08)
    ))
    .sort((a, b) => {
      if (a.contains !== b.contains) return a.contains ? -1 : 1;
      return a.distance - b.distance;
    });

  if (candidates.length === 0 && zone.shards.length > 0) {
    const nearestShard = zone.shards
      .map((shard, index) => ({ shard, index, distance: distance(point, shard.center) }))
      .sort((a, b) => a.distance - b.distance)[0];
    candidates.push({ ...nearestShard, contains: false });
  }

  const selectedCount = Math.min(
    candidates.length,
    Math.max(1, Math.round((fromHold ? 1 : 2) + forceScale * 1.25 + zone.mix * 1.4)),
  );
  const selectedIndexes = new Set(candidates.slice(0, selectedCount).map((candidate) => candidate.index));
  const nextShards: Shard[] = [];
  let didFracture = false;

  zone.shards.forEach((shard, index) => {
    if (!selectedIndexes.has(index)) {
      nextShards.push(shard);
      return;
    }

    const pieces = splitShard(shard, point, forceScale, seed + index * 83);
    if (pieces.length > 1) {
      didFracture = true;
      nextShards.push(...pieces);
    } else {
      nextShards.push({
        ...shard,
        lift: Math.min(22, shard.lift + forceScale * 1.2),
        angle: shard.angle + (rng() - 0.5) * 0.018 * forceScale,
      });
    }
  });

  zone.shards = nextShards;
  zone.fractureCount += 1;
  zone.damage = Math.min(4.2, zone.damage + 0.2 + forceScale * 0.16);
  zone.mix = Math.min(1, zone.mix + (fromHold ? 0.07 : 0.04) * forceScale + (didFracture ? 0.04 : 0.01));
  zone.radius = Math.min(ball.radius * 0.5, zone.radius + forceScale * (fromHold ? 0.7 : 1.1));
  rebuildZoneEdges(zone, seed);
}

function splitShard(shard: Shard, point: Point, forceScale: number, seed: number): Shard[] {
  const area = Math.abs(polygonArea(shard.polygon));
  if (area < 26 || shard.split > 7) return [shard];

  const rng = mulberry32(seed);
  const focus = pointInPolygon(point, shard.polygon) ? point : shard.center;
  const splitCount = Math.min(12, Math.round(3 + forceScale * 2.1 + rng() * 3 + shard.split * 0.55));
  const points = createShardSplitPoints(shard.polygon, focus, splitCount, rng);
  if (points.length < 3) return [shard];

  const cells = createVoronoiCells(
    points,
    shard.polygon,
    boundsFromPolygon(shard.polygon, 8),
    Math.max(8, area / (splitCount * 9)),
  );
  if (cells.length < 2) return [shard];

  const newShards: Shard[] = [];
  const edgeMap = new Map<string, CrackEdge & { count: number }>();
  cells.forEach((cell, index) => {
    const previousLength = newShards.length;
    addShard(cell, newShards, edgeMap, seed + index * 53, shard.split + 1, Math.max(8, area / (splitCount * 14)));
    const created = newShards[newShards.length - 1];
    if (newShards.length > previousLength && created) {
      created.lift = Math.min(23, created.lift + shard.lift * 0.48 + forceScale * 1.2);
      created.angle += shard.angle * 0.58 + (rng() - 0.5) * 0.018 * forceScale;
      created.tint = created.tint * 0.62 + shard.tint * 0.38;
    }
  });

  return newShards.length > 1 ? newShards : [shard];
}

function createShardSplitPoints(
  polygon: Point[],
  focus: Point,
  count: number,
  rng: () => number,
): Point[] {
  const center = polygonCentroid(polygon);
  const points: Point[] = [];
  const start = pointInPolygon(focus, polygon) ? focus : center;
  const maxRadius = polygon.reduce((max, point) => Math.max(max, distance(start, point)), 0);
  const [minX, minY, maxX, maxY] = boundsFromPolygon(polygon, 0);

  points.push(start);
  if (distance(start, center) > 1.5) {
    points.push({
      x: lerp(start.x, center.x, 0.55),
      y: lerp(start.y, center.y, 0.55),
    });
  } else {
    points.push(center);
  }

  let attempts = 0;
  while (points.length < count && attempts < count * 90) {
    attempts += 1;
    let candidate: Point;
    if (rng() < 0.78) {
      const angle = rng() * Math.PI * 2;
      const radius = maxRadius * Math.sqrt(rng()) * (0.18 + rng() * 0.78);
      candidate = {
        x: start.x + Math.cos(angle) * radius,
        y: start.y + Math.sin(angle) * radius,
      };
    } else {
      candidate = {
        x: lerp(minX, maxX, rng()),
        y: lerp(minY, maxY, rng()),
      };
    }

    if (pointInPolygon(candidate, polygon)) {
      points.push(candidate);
    }
  }

  return points;
}

function rebuildZoneEdges(zone: BreakZone, seed: number): void {
  const edgeMap = new Map<string, CrackEdge & { count: number }>();
  zone.shards.forEach((shard, index) => {
    registerShardEdges(shard, edgeMap, seed + index * 37 + shard.split * 131);
  });

  zone.edges = Array.from(edgeMap.values())
    .filter((edge) => edge.count > 1)
    .map((edge) => ({ a: edge.a, b: edge.b, weight: edge.weight }));
  zone.crumbs = createCrumbsFromEdges(zone.edges, seed);
}

function createCrumbsFromEdges(edges: CrackEdge[], seed: number): Array<Point & { size: number; phase: number }> {
  return edges
    .filter((_, index) => index % 3 === 0)
    .slice(0, 42)
    .map((edge, index) => {
      const t = 0.2 + noise(seed + index * 11) * 0.6;
      return {
        x: lerp(edge.a.x, edge.b.x, t),
        y: lerp(edge.a.y, edge.b.y, t),
        size: 1.3 + noise(seed + index * 19) * 2.8,
        phase: noise(seed + index * 43) * Math.PI * 2,
      };
    });
}

function mixTouchedZones(point: Point, force: number, dt: number): void {
  for (const zone of zones) {
    const zoneDistance = distance(point, zone.center);
    const falloff = Math.max(0, 1 - zoneDistance / (zone.radius * 1.12));
    if (falloff <= 0) continue;

    zone.mix = Math.min(1, zone.mix + dt * falloff * (0.42 + force * 0.34));
    zone.damage = Math.min(4.2, zone.damage + dt * falloff * (0.32 + force * 0.28));
    zone.radius = Math.min(ball.radius * 0.5, zone.radius + dt * falloff * force * 2.4);
  }
}

function pointerForce(event: PointerEvent): number {
  const raw = event.pressure && event.pressure > 0 ? event.pressure : 0.62;
  return Math.min(2.4, 0.72 + raw * 1.35 + holdDuration * 0.28);
}

function updatePointer(event: PointerEvent): void {
  const rect = canvas.getBoundingClientRect();
  pointer = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

canvas.addEventListener('pointerdown', (event) => {
  activePointerId = event.pointerId;
  isDown = true;
  holdDuration = 0;
  inputForce = pointerForce(event);
  updatePointer(event);
  canvas.setPointerCapture(event.pointerId);
  triggerBreak(pointer, inputForce);
  lastHoldBreakAt = performance.now();
});

canvas.addEventListener('click', (event) => {
  if (performance.now() - lastBreakAt < 120) return;
  const rect = canvas.getBoundingClientRect();
  pointer = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
  inputForce = 1;
  triggerBreak(pointer, 1);
});

canvas.addEventListener('pointermove', (event) => {
  updatePointer(event);
  inputForce = pointerForce(event);
  targetPressure = isDown ? 1 : 0.08;
});

canvas.addEventListener('pointerup', (event) => {
  isDown = false;
  holdDuration = 0;
  targetPressure = 0.12;
  if (activePointerId === event.pointerId && canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  activePointerId = null;
});

canvas.addEventListener('pointerleave', () => {
  isDown = false;
  holdDuration = 0;
  targetPressure = 0;
});

resetButton.addEventListener('click', resetArtwork);
window.addEventListener('resize', resize);

function playCrack(force: number): void {
  if (reducedMotion) return;
  audioContext ??= new AudioContext();
  const now = audioContext.currentTime;

  for (let i = 0; i < 4; i += 1) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    osc.type = i % 2 === 0 ? 'triangle' : 'square';
    osc.frequency.setValueAtTime(880 + noise(zoneId * 13 + i) * 2400, now + i * 0.018);
    filter.type = 'highpass';
    filter.frequency.value = 520 + i * 180;
    gain.gain.setValueAtTime(0.0001, now + i * 0.018);
    gain.gain.exponentialRampToValueAtTime(0.055 * force, now + i * 0.018 + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.018 + 0.052);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(now + i * 0.018);
    osc.stop(now + i * 0.075);
  }
}

function clipBall(scale: number): void {
  ctx.beginPath();
  ctx.ellipse(ball.x, ball.y, ball.radius * scale, ball.radius * scale, 0, 0, Math.PI * 2);
  ctx.clip();
}

function drawPolygon(points: Point[]): void {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
}

function drawJaggedLine(a: Point, b: Point, seed: number): void {
  const steps = 4;
  const normal = normalize({ x: b.y - a.y, y: a.x - b.x });
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const offset = (noise(seed + i * 19) - 0.5) * 4.5;
    ctx.lineTo(lerp(a.x, b.x, t) + normal.x * offset, lerp(a.y, b.y, t) + normal.y * offset);
  }
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function adjustWaxColor(tint: number, crack: number, mix = 0): string {
  const base = [199, 240, 107];
  const light = [238, 252, 164];
  const dark = [125, 154, 38];
  const core = [249, 250, 244];
  const mixTarget = tint > 0 ? light : dark;
  const amount = Math.abs(tint) * 0.42 + crack * 0.06;
  const coreLift = mix * 0.18;
  const r = Math.round(lerp(lerp(base[0], mixTarget[0], amount), core[0], coreLift));
  const g = Math.round(lerp(lerp(base[1], mixTarget[1], amount), core[1], coreLift));
  const b = Math.round(lerp(lerp(base[2], mixTarget[2], amount), core[2], coreLift));
  return `rgb(${r}, ${g}, ${b})`;
}

function toLocal(point: Point): Point {
  return sub(point, ball);
}

function fromLocal(point: Point): Point {
  return add(point, ball);
}

function clampToBall(point: Point, scale: number): Point {
  const local = toLocal(point);
  const distance = length(local);
  const limit = ball.radius * scale;
  if (distance <= limit) return point;
  return fromLocal(mul(normalize(local), limit));
}

function isInsideBall(point: Point): boolean {
  return distance(point, ball) <= ball.radius * 1.02;
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
}

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects = ((a.y > point.y) !== (b.y > point.y))
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y + EPSILON) + a.x;
    if (intersects) inside = !inside;
  }

  return inside;
}

function boundsFromPolygon(polygon: Point[], padding: number): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of polygon) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return [minX - padding, minY - padding, maxX + padding, maxY + padding];
}

function polygonArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area * 0.5;
}

function polygonCentroid(points: Point[]): Point {
  const area = polygonArea(points);
  if (Math.abs(area) < 0.01) {
    const sum = points.reduce((acc, point) => add(acc, point), { x: 0, y: 0 });
    return { x: sum.x / points.length, y: sum.y / points.length };
  }

  let x = 0;
  let y = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const cross = a.x * b.y - b.x * a.y;
    x += (a.x + b.x) * cross;
    y += (a.y + b.y) * cross;
  }
  return { x: x / (6 * area), y: y / (6 * area) };
}

function edgeKey(a: Point, b: Point): string {
  const aKey = `${Math.round(a.x)},${Math.round(a.y)}`;
  const bKey = `${Math.round(b.x)},${Math.round(b.y)}`;
  return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
}

function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function mul(point: Point, value: number): Point {
  return { x: point.x * value, y: point.y * value };
}

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}

function length(point: Point): number {
  return Math.hypot(point.x, point.y);
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalize(point: Point): Point {
  const size = length(point) || 1;
  return { x: point.x / size, y: point.y / size };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453123;
  return x - Math.floor(x);
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

resize();
resetArtwork();
requestAnimationFrame(draw);
