import GUI from 'lil-gui';
import { Delaunay } from 'd3-delaunay';

type Point = { x: number; y: number };
type ShardState = 'solid' | 'cracked' | 'separated' | 'split' | 'detached';
type AudioKind = 'crackSmall' | 'snapClean' | 'crackle' | 'flake';

type Shard = {
  id: number;
  parentId: number | null;
  polygon: Point[];
  children: number[];
  center: Point;
  area: number;
  state: ShardState;
  depth: number;
  hidden: boolean;
  energy: number;
  crackAt: number;
  separateAt: number;
  splitAt: number;
  detachAt: number;
  gap: number;
  offset: Point;
  lift: number;
  thickness: number;
  angle: number;
  targetGap: number;
  targetOffset: Point;
  targetLift: number;
  targetAngle: number;
  breakOrigin: Point | null;
  breakDir: Point;
  baseAngle: number;
  hueShift: number;
  detachDrift: Point;
  path?: Path2D;
};

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
const resetButton = document.getElementById('resetButton') as HTMLButtonElement;
const meterFill = document.getElementById('meterFill') as HTMLSpanElement;

const TWO_PI = Math.PI * 2;
const EPSILON = 0.00001;
const LIGHT = normalize({ x: -0.45, y: -0.75 });

const params = {
  seed: 230623,
  waxColor: '#7ec9af',
  waxWarmth: 0.16,
  initialShards: 14,
  circleSides: 124,
  pressRadius: 186,
  energyRate: 1.28,
  gapScale: 1.12,
  liftScale: 1,
  splitDensity: 3,
  maxDepth: 1,
  maxShards: 90,
  maxSplitsPerFrame: 1,
  separationStrength: 0.9,
  bevelWidth: 1.25,
  shadowStrength: 0.24,
  debugSeeds: false,
};

let dpr = window.devicePixelRatio || 1;
let width = 0;
let height = 0;
let diskCenter: Point = { x: 0, y: 0 };
let diskRadius = 0;
let diskPolygon: Point[] = [];
let shards: Shard[] = [];
let nextShardId = 1;
let rng = mulberry32(params.seed);
let holdPoint: Point | null = null;
let isHolding = false;
let activePointerId: number | null = null;
let lastNow = performance.now();
let splitQueue: number[] = [];
let audio = createAudioSampler();
let palette = makePalette(params.waxColor);

const gui = new GUI({ title: 'wakppu fracture' });
gui.close();
gui.add(params, 'pressRadius', 110, 230, 1);
gui.add(params, 'energyRate', 0.6, 1.8, 0.01);
gui.add(params, 'gapScale', 0.4, 1.8, 0.01);
gui.add(params, 'liftScale', 0, 1.8, 0.01);
gui.add(params, 'separationStrength', 0, 1, 0.01);
gui.add(params, 'splitDensity', 3, 7, 1).onFinishChange(resetArtwork);
gui.add(params, 'maxDepth', 1, 3, 1).onFinishChange(resetArtwork);
gui.addColor(params, 'waxColor').onChange((value: string) => {
  palette = makePalette(value);
});
gui.add(params, 'debugSeeds');

function setupCanvas(): void {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function resetArtwork(): void {
  rng = mulberry32(params.seed);
  nextShardId = 1;
  splitQueue = [];
  holdPoint = null;
  isHolding = false;
  activePointerId = null;

  const portraitLimit = Math.min(width * 0.84, height * 0.74);
  const landscapeLimit = Math.min(width * 0.58, height * 0.82);
  diskRadius = Math.max(130, Math.min(360, (width < height ? portraitLimit : landscapeLimit) * 0.5));
  diskCenter = {
    x: width * 0.5,
    y: height * (width < height ? 0.51 : 0.54),
  };
  diskPolygon = createCirclePolygon(diskCenter, diskRadius, params.circleSides);
  shards = createInitialShards();
  meterFill.style.transform = 'scaleX(0)';
}

function createInitialShards(): Shard[] {
  const points: Point[] = [];
  points.push({ ...diskCenter });

  const ringCount = Math.max(8, params.initialShards - 1);
  for (let i = 0; i < ringCount; i += 1) {
    const band = i / ringCount;
    const angle = band * TWO_PI + rand(-0.18, 0.18);
    const radius = diskRadius * rand(0.2, 0.9) * (i % 3 === 0 ? 0.72 : 1);
    points.push({
      x: diskCenter.x + Math.cos(angle) * radius,
      y: diskCenter.y + Math.sin(angle) * radius,
    });
  }

  const cells = createVoronoiCells(points, diskPolygon, boundsFromPolygon(diskPolygon, 80));
  return cells
    .filter((polygon) => Math.abs(polygonArea(polygon)) > 850)
    .map((polygon) => makeShard(polygon, null, 0, 0));
}

function createVoronoiCells(points: Point[], clipPolygon: Point[], bounds: [number, number, number, number]): Point[][] {
  if (points.length < 3) return [];

  const delaunay = Delaunay.from(points, (p) => p.x, (p) => p.y);
  const voronoi = delaunay.voronoi(bounds);
  const polygons: Point[][] = [];

  for (let i = 0; i < points.length; i += 1) {
    const cell = voronoi.cellPolygon(i);
    if (!cell || cell.length < 4) continue;
    const subject = cell
      .slice(0, -1)
      .map(([x, y]) => ({ x, y }));
    const clipped = clipPolygonToConvex(subject, clipPolygon);
    if (clipped.length >= 3 && Math.abs(polygonArea(clipped)) > 120) {
      polygons.push(clipped);
    }
  }

  return polygons;
}

function makeShard(polygon: Point[], parentId: number | null, depth: number, inheritedEnergy: number): Shard {
  const center = polygonCentroid(polygon);
  const area = Math.abs(polygonArea(polygon));
  const jitter = rand(-0.045, 0.065);
  const depthBias = depth * 0.055;
  const childBias = depth > 0 ? -0.04 : 0;
  const baseAngle = rand(-0.08, 0.08);

  return {
    id: nextShardId++,
    parentId,
    polygon,
    children: [],
    center,
    area,
    state: inheritedEnergy > 0.2 ? 'cracked' : 'solid',
    depth,
    hidden: false,
    energy: inheritedEnergy,
    crackAt: 0.12 + jitter + childBias,
    separateAt: 0.31 + jitter + depthBias,
    splitAt: 0.56 + jitter + depthBias * 1.6,
    detachAt: 1.05 + jitter + depthBias * 2.2,
    gap: 0,
    offset: { x: 0, y: 0 },
    lift: 0,
    thickness: rand(1.8, 3.7),
    angle: 0,
    targetGap: 0,
    targetOffset: { x: 0, y: 0 },
    targetLift: 0,
    targetAngle: 0,
    breakOrigin: null,
    breakDir: normalize(sub(center, diskCenter)),
    baseAngle,
    hueShift: rand(-1, 1),
    detachDrift: {
      x: rand(-0.55, 0.55),
      y: rand(-0.8, 0.2),
    },
    path: pathFromPolygon(polygon),
  };
}

function splitShard(parent: Shard): void {
  if (parent.hidden || parent.depth >= params.maxDepth || shards.length >= params.maxShards) return;

  const count = Math.max(3, Math.min(4, Math.round(params.splitDensity + rand(-0.65, 0.75))));
  const points = randomPointsInPolygon(parent.polygon, count);
  if (points.length < 3) return;

  const cells = createVoronoiCells(points, parent.polygon, boundsFromPolygon(parent.polygon, 60));
  const children = cells
    .filter((polygon) => Math.abs(polygonArea(polygon)) > Math.max(180, parent.area * 0.08))
    .slice(0, 4);

  if (children.length < 2) return;

  parent.hidden = true;
  parent.state = 'split';
  parent.children = [];
  audio.play('crackle');

  for (const polygon of children) {
    if (shards.length >= params.maxShards) break;
    const child = makeShard(polygon, parent.id, parent.depth + 1, parent.energy * rand(0.46, 0.68));
    const localDir = normalize(sub(child.center, parent.center));
    const inheritedDir = parent.breakOrigin
      ? parent.breakDir
      : normalize(sub(parent.center, holdPoint ?? diskCenter));
    const childDir = normalize({
      x: inheritedDir.x * 0.64 + localDir.x * 0.92 + rand(-0.08, 0.08),
      y: inheritedDir.y * 0.64 + localDir.y * 0.92 + rand(-0.08, 0.08),
    });
    child.breakOrigin = parent.breakOrigin ?? holdPoint ?? parent.center;
    child.breakDir = childDir;
    child.gap = parent.gap * rand(0.65, 0.95);
    child.offset = {
      x: parent.offset.x + localDir.x * rand(0.4, 1.2),
      y: parent.offset.y + localDir.y * rand(0.4, 1.2),
    };
    child.targetGap = parent.targetGap * rand(0.72, 0.96);
    child.targetOffset = {
      x: parent.targetOffset.x + localDir.x * rand(1.2, 2.6),
      y: parent.targetOffset.y + localDir.y * rand(1.2, 2.6),
    };
    child.lift = parent.lift * rand(0.45, 0.85);
    child.angle = parent.angle * rand(0.3, 0.8);
    parent.children.push(child.id);
    shards.push(child);
  }
}

function update(now: number): void {
  const dt = Math.min(0.033, (now - lastNow) / 1000);
  lastNow = now;

  let maxEnergy = 0;
  let pendingSplits = 0;

  for (const shard of shards) {
    if (shard.hidden) continue;

    if (isHolding && holdPoint) {
      const falloff = smoothstep(1 - distance(holdPoint, shard.center) / params.pressRadius);
      if (falloff > 0) {
        shard.energy += dt * params.energyRate * falloff;
      }
    }

    maxEnergy = Math.max(maxEnergy, shard.energy);
    updateState(shard);

    if (shard.energy >= shard.splitAt && !shard.hidden && shard.children.length === 0) {
      const canSplit = shard.depth < params.maxDepth && shard.area > 520 && shards.length + pendingSplits * 5 < params.maxShards;
      if (canSplit && !splitQueue.includes(shard.id)) {
        splitQueue.push(shard.id);
        pendingSplits += 1;
      }
    }
  }

  processSplitQueue();

  for (const shard of visibleShards()) {
    updateTargets(shard);
  }
  applySeparation();
  for (const shard of visibleShards()) {
    easeMotion(shard);
  }

  meterFill.style.transform = `scaleX(${clamp(maxEnergy / 1.55, 0, 1)})`;
}

function updateState(shard: Shard): void {
  const previous = shard.state;

  if (shard.energy >= shard.detachAt && shard.depth > 0 && shard.area < 1700) {
    shard.state = 'detached';
  } else if (shard.energy >= shard.splitAt) {
    shard.state = 'split';
  } else if (shard.energy >= shard.separateAt) {
    shard.state = 'separated';
  } else if (shard.energy >= shard.crackAt) {
    shard.state = 'cracked';
  } else {
    shard.state = 'solid';
  }

  if (previous === shard.state) return;
  if (previous === 'solid' && shard.state !== 'solid') {
    freezeBreakPose(shard, holdPoint ?? diskCenter);
  }
  if (shard.state === 'cracked') audio.play('crackSmall');
  if (shard.state === 'separated') audio.play('snapClean');
  if (shard.state === 'detached') audio.play('flake');
}

function updateTargets(shard: Shard): void {
  if (shard.state === 'solid') {
    shard.targetGap = 0;
    shard.targetOffset = { x: 0, y: 0 };
    shard.targetLift = 0;
    shard.targetAngle = 0;
    return;
  }

  if (!shard.breakOrigin) {
    freezeBreakPose(shard, holdPoint ?? diskCenter);
  }

  const breakDir = vectorLength(shard.breakDir) > EPSILON
    ? shard.breakDir
    : normalize(sub(shard.center, shard.breakOrigin ?? diskCenter));
  const radialNoise = 0.82 + (Math.sin(shard.id * 12.9898) + 1) * 0.14;
  const stage = clamp((shard.energy - shard.crackAt) / Math.max(0.1, shard.detachAt - shard.crackAt), 0, 1);

  let targetGap = 0;
  let targetLift = 0;
  let targetAngle = 0;

  if (shard.state === 'cracked') {
    const t = smoothstep(clamp((shard.energy - shard.crackAt) / 0.22, 0, 1));
    targetGap = lerp(0.45, 1.35, t);
    targetAngle = shard.baseAngle * 0.12;
  } else if (shard.state === 'separated') {
    const t = smoothstep(clamp((shard.energy - shard.separateAt) / 0.36, 0, 1));
    targetGap = lerp(2.1, 4.9, t);
    targetLift = lerp(0.35, 1.6, t);
    targetAngle = shard.baseAngle * 0.45;
  } else if (shard.state === 'split') {
    const t = smoothstep(clamp((shard.energy - shard.splitAt) / 0.48, 0, 1));
    targetGap = lerp(4.1, 8.4, t);
    targetLift = lerp(1.0, 4.4, t);
    targetAngle = shard.baseAngle;
  } else if (shard.state === 'detached') {
    const t = smoothstep(clamp((shard.energy - shard.detachAt) / 0.55, 0, 1));
    targetGap = lerp(8.0, 15.0, t);
    targetLift = lerp(2.0, 7.0, t);
    targetAngle = shard.baseAngle * 1.8 + shard.detachDrift.x * 0.14;
  }

  const outwardBias = 0.82 + stage * 0.4 + shard.depth * 0.08;
  shard.targetGap = targetGap * params.gapScale * radialNoise * outwardBias;
  shard.targetOffset = {
    x: breakDir.x * shard.targetGap,
    y: breakDir.y * shard.targetGap,
  };
  if (shard.state === 'detached') {
    shard.targetOffset.x += shard.detachDrift.x * shard.targetGap * 0.7;
    shard.targetOffset.y += shard.detachDrift.y * shard.targetGap * 0.7;
  }
  shard.targetLift = targetLift * params.liftScale;
  shard.targetAngle = targetAngle + (breakDir.x * 0.018 + breakDir.y * 0.012) * stage;
}

function easeMotion(shard: Shard): void {
  shard.gap += (shard.targetGap - shard.gap) * 0.18;
  shard.offset.x += (shard.targetOffset.x - shard.offset.x) * 0.18;
  shard.offset.y += (shard.targetOffset.y - shard.offset.y) * 0.18;
  shard.lift += (shard.targetLift - shard.lift) * 0.16;
  shard.angle += (shard.targetAngle - shard.angle) * 0.12;
}

function freezeBreakPose(shard: Shard, origin: Point): void {
  if (shard.breakOrigin) return;

  const fallback = vectorLength(sub(shard.center, diskCenter)) > EPSILON
    ? diskCenter
    : { x: diskCenter.x - 1, y: diskCenter.y - 1 };
  const dir = normalize(sub(shard.center, origin));
  shard.breakOrigin = { ...origin };
  shard.breakDir = vectorLength(dir) > EPSILON
    ? dir
    : normalize(sub(shard.center, fallback));
}

function applySeparation(): void {
  if (params.separationStrength <= 0) return;

  const active = visibleShards().filter((shard) => shard.state !== 'solid');
  const passes = 3;

  for (let pass = 0; pass < passes; pass += 1) {
    for (let i = 0; i < active.length; i += 1) {
      const a = active[i];
      const ar = separationRadius(a);
      const ac = projectedCenter(a);

      for (let j = i + 1; j < active.length; j += 1) {
        const b = active[j];
        const br = separationRadius(b);
        const bc = projectedCenter(b);
        const delta = sub(bc, ac);
        const dist = Math.max(vectorLength(delta), 0.001);
        const minDist = Math.min(34, (ar + br) * 0.95);
        if (dist >= minDist) continue;

        const dir = dist > 0.01
          ? { x: delta.x / dist, y: delta.y / dist }
          : normalize({
            x: Math.sin((a.id + b.id) * 12.9898),
            y: Math.cos((a.id - b.id) * 78.233),
          });
        const push = (minDist - dist) * 0.5 * params.separationStrength;
        a.targetOffset.x -= dir.x * push;
        a.targetOffset.y -= dir.y * push;
        b.targetOffset.x += dir.x * push;
        b.targetOffset.y += dir.y * push;

        clampTargetOffset(a);
        clampTargetOffset(b);
      }
    }
  }
}

function projectedCenter(shard: Shard): Point {
  return {
    x: shard.center.x + shard.targetOffset.x,
    y: shard.center.y + shard.targetOffset.y,
  };
}

function separationRadius(shard: Shard): number {
  const base = Math.sqrt(shard.area) * (shard.depth > 0 ? 0.28 : 0.18);
  return clamp(base, 7, shard.depth > 0 ? 24 : 30);
}

function clampTargetOffset(shard: Shard): void {
  const maxOffset = Math.max(16, shard.targetGap * 2.8 + 8 + shard.depth * 4);
  const length = vectorLength(shard.targetOffset);
  if (length <= maxOffset || length < EPSILON) return;
  const scale = maxOffset / length;
  shard.targetOffset.x *= scale;
  shard.targetOffset.y *= scale;
}

function processSplitQueue(): void {
  let processed = 0;

  while (splitQueue.length > 0 && processed < params.maxSplitsPerFrame) {
    const shardId = splitQueue.shift() as number;
    const shard = shards.find((candidate) => candidate.id === shardId);
    if (shard && !shard.hidden && shard.children.length === 0) {
      splitShard(shard);
      processed += 1;
    }
  }
}

function render(): void {
  drawBackdrop();
  drawBaseShadow();
  drawAmbientGap();
  drawContactShadows();
  drawSideWalls();
  drawTopFaces();
  drawPressureBloom();
  if (params.debugSeeds) drawDebugCenters();
}

function drawBackdrop(): void {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#f4f7f1');
  gradient.addColorStop(0.52, '#e9ece8');
  gradient.addColorStop(1, '#d8dfdc');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#b8b2a5';
  ctx.beginPath();
  ctx.ellipse(width * 0.48, height * 0.78, diskRadius * 1.0, diskRadius * 0.13, -0.08, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

function drawBaseShadow(): void {
  ctx.save();
  ctx.translate(0, diskRadius * 0.026);
  ctx.shadowColor = `rgba(26, 31, 29, ${params.shadowStrength})`;
  ctx.shadowBlur = Math.max(18, diskRadius * 0.105);
  ctx.shadowOffsetY = Math.max(10, diskRadius * 0.06);
  ctx.fillStyle = 'rgba(50, 66, 60, 0.18)';
  drawPolygon(diskPolygon);
  ctx.fill();
  ctx.restore();
}

function drawAmbientGap(): void {
  const gradient = ctx.createRadialGradient(
    diskCenter.x - diskRadius * 0.24,
    diskCenter.y - diskRadius * 0.28,
    diskRadius * 0.08,
    diskCenter.x,
    diskCenter.y,
    diskRadius * 1.06,
  );
  gradient.addColorStop(0, '#347568');
  gradient.addColorStop(0.68, '#20544d');
  gradient.addColorStop(1, '#173a37');
  ctx.fillStyle = gradient;
  drawPolygon(diskPolygon);
  ctx.fill();
}

function drawContactShadows(): void {
  for (const shard of visibleShards()) {
    if (shard.gap < 0.1 && shard.lift < 0.1) continue;
    const alpha = clamp(0.025 + shard.gap * 0.006 + shard.lift * 0.01, 0.035, 0.15);
    ctx.save();
    ctx.shadowColor = `rgba(14, 25, 22, ${alpha})`;
    ctx.shadowBlur = 7 + shard.lift * 1.8 + shard.gap * 0.55;
    ctx.shadowOffsetY = 3 + shard.lift * 0.55;
    ctx.fillStyle = `rgba(14, 25, 22, ${alpha * 0.55})`;
    drawTransformedPolygon(shard, {
      x: shard.thickness * 0.3,
      y: shard.thickness * 0.5 + shard.lift * 0.24,
    });
    ctx.fill();
    ctx.restore();
  }
}

function drawSideWalls(): void {
  const walls: Array<{
    a: Point;
    b: Point;
    c: Point;
    d: Point;
    brightness: number;
    shade: number;
  }> = [];

  for (const shard of visibleShards()) {
    if (shard.state === 'solid' || (shard.gap < 0.08 && shard.lift < 0.08)) continue;

    const top = transformedPoints(shard, { includeLift: true });
    const bottom = transformedPoints(shard, sideWallOffset(shard));
    const areaSign = Math.sign(polygonArea(top)) || 1;

    for (let i = 0; i < top.length; i += 1) {
      const a = top[i];
      const b = top[(i + 1) % top.length];
      const d = bottom[i];
      const c = bottom[(i + 1) % bottom.length];
      const edge = sub(b, a);
      const normal = areaSign >= 0
        ? normalize({ x: edge.y, y: -edge.x })
        : normalize({ x: -edge.y, y: edge.x });
      const brightness = dot(normal, LIGHT);
      walls.push({
        a,
        b,
        c,
        d,
        brightness,
        shade: (a.y + b.y + c.y + d.y) * 0.25,
      });
    }
  }

  walls.sort((left, right) => left.shade - right.shade);

  for (const wall of walls) {
    drawSideWall(wall.a, wall.b, wall.c, wall.d, wall.brightness);
  }
}

function sideWallOffset(shard: Shard): { x: number; y: number; includeLift: boolean } {
  return {
    x: shard.thickness * 0.52,
    y: shard.thickness * 0.9 + shard.lift * 0.46,
    includeLift: false,
  };
}

function drawSideWall(a: Point, b: Point, c: Point, d: Point, brightness: number): void {
  const midTop = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
  const midBottom = { x: (c.x + d.x) * 0.5, y: (c.y + d.y) * 0.5 };
  const lightAmount = clamp(brightness * 0.18, -0.16, 0.12);
  const topColor = adjustColor(palette.edge, 0.04 + lightAmount);
  const bottomColor = adjustColor(palette.edge, -0.16 + lightAmount * 0.65);
  const gradient = ctx.createLinearGradient(midTop.x, midTop.y, midBottom.x, midBottom.y);
  gradient.addColorStop(0, topColor);
  gradient.addColorStop(1, bottomColor);

  ctx.save();
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(d.x, d.y);
  ctx.closePath();
  ctx.fill();

  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.65;
  ctx.strokeStyle = brightness > 0.18
    ? `rgba(235, 255, 246, ${0.16 + brightness * 0.18})`
    : `rgba(18, 66, 59, ${0.2 + Math.abs(brightness) * 0.16})`;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = 'rgba(16, 55, 50, 0.18)';
  ctx.beginPath();
  ctx.moveTo(d.x, d.y);
  ctx.lineTo(c.x, c.y);
  ctx.stroke();
  ctx.restore();
}

function drawTopFaces(): void {
  if (visibleShards().every((shard) => shard.state === 'solid')) {
    drawSmoothDiskTop();
    return;
  }

  for (const shard of visibleShards()) {
    const topPoints = transformedPoints(shard, { includeLift: true });
    const faceColor = adjustColor(palette.top, shard.hueShift * params.waxWarmth * 0.08);
    const topGradient = ctx.createLinearGradient(
      diskCenter.x - diskRadius * 0.45,
      diskCenter.y - diskRadius * 0.48,
      diskCenter.x + diskRadius * 0.56,
      diskCenter.y + diskRadius * 0.62,
    );
    topGradient.addColorStop(0, adjustColor(faceColor, 0.08));
    topGradient.addColorStop(0.52, faceColor);
    topGradient.addColorStop(1, adjustColor(faceColor, -0.1));

    ctx.fillStyle = topGradient;
    drawPolygon(topPoints);
    ctx.fill();

    if (shard.state !== 'solid') {
      const crackAlpha = clamp(0.18 + shard.energy * 0.1, 0.2, 0.42);
      ctx.lineJoin = 'round';
      ctx.lineWidth = 0.75;
      ctx.strokeStyle = `rgba(20, 78, 68, ${crackAlpha})`;
      drawPolygon(topPoints);
      ctx.stroke();

      drawBevel(topPoints);
      drawSpecular(topPoints, shard);
    }
  }
}

function drawSmoothDiskTop(): void {
  const topGradient = ctx.createLinearGradient(
    diskCenter.x - diskRadius * 0.45,
    diskCenter.y - diskRadius * 0.48,
    diskCenter.x + diskRadius * 0.56,
    diskCenter.y + diskRadius * 0.62,
  );
  topGradient.addColorStop(0, adjustColor(palette.top, 0.08));
  topGradient.addColorStop(0.52, palette.top);
  topGradient.addColorStop(1, adjustColor(palette.top, -0.1));

  ctx.fillStyle = topGradient;
  drawPolygon(diskPolygon);
  ctx.fill();

  ctx.save();
  ctx.clip();
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(
    diskCenter.x - diskRadius * 0.36,
    diskCenter.y - diskRadius * 0.24,
    diskRadius * 0.17,
    diskRadius * 0.036,
    -0.45,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.restore();
}

function drawBevel(points: Point[]): void {
  const areaSign = Math.sign(polygonArea(points)) || 1;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = params.bevelWidth;

  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const edge = sub(b, a);
    const normal = areaSign >= 0
      ? normalize({ x: edge.y, y: -edge.x })
      : normalize({ x: -edge.y, y: edge.x });
    const brightness = dot(normal, LIGHT);

    if (brightness > 0.18) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.18 + brightness * 0.28})`;
    } else if (brightness < -0.2) {
      ctx.strokeStyle = `rgba(30, 80, 72, ${0.16 + Math.abs(brightness) * 0.22})`;
    } else {
      continue;
    }

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  ctx.restore();
}

function drawSpecular(points: Point[], shard: Shard): void {
  if (shard.state === 'detached' || shard.area < 700) return;
  const c = polygonCentroid(points);
  const radius = Math.sqrt(shard.area) * 0.14;

  ctx.save();
  ctx.globalAlpha = 0.13;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(
    c.x - radius * 0.55,
    c.y - radius * 0.62,
    Math.max(3, radius * 0.65),
    Math.max(1.2, radius * 0.16),
    -0.48,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.restore();
}

function drawPressureBloom(): void {
  if (!holdPoint || !isHolding) return;

  const energy = clamp(
    shards.reduce((max, shard) => (!shard.hidden ? Math.max(max, shard.energy) : max), 0),
    0,
    1.8,
  );
  const radius = lerp(18, 54, smoothstep(energy / 1.8));

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  const gradient = ctx.createRadialGradient(holdPoint.x, holdPoint.y, 2, holdPoint.x, holdPoint.y, radius);
  gradient.addColorStop(0, 'rgba(48, 108, 96, 0.17)');
  gradient.addColorStop(0.52, 'rgba(48, 108, 96, 0.06)');
  gradient.addColorStop(1, 'rgba(48, 108, 96, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(holdPoint.x, holdPoint.y, radius, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

function drawDebugCenters(): void {
  ctx.save();
  ctx.fillStyle = '#ca3b2a';
  for (const shard of visibleShards()) {
    ctx.beginPath();
    ctx.arc(shard.center.x, shard.center.y, 2, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

function visibleShards(): Shard[] {
  return shards.filter((shard) => !shard.hidden);
}

function drawTransformedPolygon(
  shard: Shard,
  options: { x?: number; y?: number; includeLift?: boolean } = {},
): void {
  drawPolygon(transformedPoints(shard, options));
}

function transformedPoints(
  shard: Shard,
  options: { x?: number; y?: number; includeLift?: boolean } = {},
): Point[] {
  const offset = {
    x: shard.offset.x + (options.x ?? 0),
    y: shard.offset.y + (options.y ?? 0),
  };
  const liftY = options.includeLift === false ? 0 : -shard.lift;
  const cos = Math.cos(shard.angle);
  const sin = Math.sin(shard.angle);

  return shard.polygon.map((point) => {
    const px = point.x - shard.center.x;
    const py = point.y - shard.center.y;
    return {
      x: shard.center.x + px * cos - py * sin + offset.x,
      y: shard.center.y + px * sin + py * cos + offset.y + liftY,
    };
  });
}

function drawPolygon(points: Point[]): void {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
}

function pathFromPolygon(points: Point[]): Path2D {
  const path = new Path2D();
  if (points.length === 0) return path;
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    path.lineTo(points[i].x, points[i].y);
  }
  path.closePath();
  return path;
}

function createCirclePolygon(center: Point, radius: number, sides: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = -Math.PI / 2 + (i / sides) * TWO_PI;
    points.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    });
  }
  return points;
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

function randomPointsInPolygon(polygon: Point[], count: number): Point[] {
  const [minX, minY, maxX, maxY] = boundsFromPolygon(polygon, 0);
  const points: Point[] = [];
  const center = polygonCentroid(polygon);
  points.push(center);

  let attempts = 0;
  while (points.length < count && attempts < count * 80) {
    attempts += 1;
    const point = {
      x: rand(minX, maxX),
      y: rand(minY, maxY),
    };
    if (pointInPolygon(point, polygon)) {
      points.push(point);
    }
  }

  return points;
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
  let area = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const f = a.x * b.y - b.x * a.y;
    area += f;
    cx += (a.x + b.x) * f;
    cy += (a.y + b.y) * f;
  }

  area *= 0.5;
  if (Math.abs(area) < EPSILON) {
    return points.reduce(
      (sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }),
      { x: 0, y: 0 },
    );
  }

  return {
    x: cx / (6 * area),
    y: cy / (6 * area),
  };
}

function makePalette(hex: string): { top: string; edge: string } {
  return {
    top: hex,
    edge: adjustColor(hex, -0.27),
  };
}

function adjustColor(hex: string, amount: number): string {
  const { r, g, b } = parseHex(hex);
  const mix = amount >= 0 ? 255 : 0;
  const t = Math.abs(amount);
  return rgbToHex(
    Math.round(lerp(r, mix, t)),
    Math.round(lerp(g, mix, t)),
    Math.round(lerp(b, mix, t)),
  );
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '').trim();
  const value = normalized.length === 3
    ? normalized.split('').map((part) => part + part).join('')
    : normalized.padEnd(6, '0').slice(0, 6);
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => clamp(value, 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

function createAudioSampler(): { unlock: () => Promise<void>; play: (kind: AudioKind) => void } {
  const files: Record<AudioKind, string[]> = {
    crackSmall: [],
    snapClean: [],
    crackle: [],
    flake: [],
  };
  const buffers = new Map<string, AudioBuffer>();
  let audioContext: AudioContext | null = null;
  let unlocked = false;

  async function unlock(): Promise<void> {
    if (unlocked) return;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    audioContext = new AudioContextCtor();
    await audioContext.resume();
    unlocked = true;

    for (const paths of Object.values(files)) {
      for (const path of paths) {
        if (buffers.has(path)) continue;
        try {
          const response = await fetch(path);
          const arrayBuffer = await response.arrayBuffer();
          buffers.set(path, await audioContext.decodeAudioData(arrayBuffer));
        } catch {
          // Recorded samples are optional project assets and should fail silently when absent.
        }
      }
    }
  }

  function play(kind: AudioKind): void {
    if (!audioContext || !unlocked || files[kind].length === 0) return;
    const path = files[kind][Math.floor(Math.random() * files[kind].length)];
    const buffer = buffers.get(path);
    if (!buffer) return;

    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    source.buffer = buffer;
    gain.gain.value = rand(0.65, 0.92);
    source.connect(gain);
    gain.connect(audioContext.destination);
    source.start();
  }

  return { unlock, play };
}

function onPointerDown(event: PointerEvent): void {
  if (activePointerId !== null) return;
  activePointerId = event.pointerId;
  isHolding = true;
  holdPoint = { x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
  void audio.unlock();
}

function onPointerMove(event: PointerEvent): void {
  if (event.pointerId !== activePointerId || !holdPoint) return;
  holdPoint = {
    x: lerp(holdPoint.x, event.clientX, 0.35),
    y: lerp(holdPoint.y, event.clientY, 0.35),
  };
}

function onPointerUp(event: PointerEvent): void {
  if (event.pointerId !== activePointerId) return;
  isHolding = false;
  activePointerId = null;
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

function frame(now: number): void {
  update(now);
  render();
  requestAnimationFrame(frame);
}

function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function vectorLength(point: Point): number {
  return Math.hypot(point.x, point.y);
}

function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function normalize(point: Point): Point {
  const length = Math.hypot(point.x, point.y);
  if (length < EPSILON) return { x: 0, y: 0 };
  return { x: point.x / length, y: point.y / length };
}

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}

function rand(min: number, max: number): number {
  return min + (max - min) * rng();
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointercancel', onPointerUp);
resetButton.addEventListener('click', resetArtwork);
window.addEventListener('resize', () => {
  setupCanvas();
  resetArtwork();
});

setupCanvas();
resetArtwork();
requestAnimationFrame(frame);
