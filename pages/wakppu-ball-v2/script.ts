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
};

type CrackEdge = {
  a: Point;
  b: Point;
  weight: number;
};

type BreakZone = {
  id: number;
  center: Point;
  radius: number;
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

const palette = {
  wax: '#c7f06b',
  waxLight: '#eefca4',
  waxDark: '#7d9a26',
  core: '#ff8fb6',
  coreHot: '#ffd5de',
  rubber: '#eafcff',
  crack: '#28320f',
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
  const center = clampToBall(point, 0.76);
  const seed = zoneId * 109 + Math.round(center.x * 0.37 + center.y * 0.21);
  const rayCount = 12 + Math.floor(noise(seed) * 5);
  const ringCount = 4;
  const rings = [0.08, 0.2, 0.36, 0.52].map((value) => ball.radius * value * (0.9 + force * 0.12));
  const rayPoints: Point[][] = [];

  for (let ray = 0; ray < rayCount; ray += 1) {
    const baseAngle = (ray / rayCount) * Math.PI * 2;
    const rayBend = (noise(seed + ray * 17) - 0.5) * 0.28;
    rayPoints[ray] = [];

    for (let ring = 0; ring < ringCount; ring += 1) {
      const radius = rings[ring] * (0.88 + noise(seed + ray * 31 + ring * 13) * 0.24);
      const angle = baseAngle + rayBend + (noise(seed + ring * 71 + ray * 5) - 0.5) * (0.12 + ring * 0.055);
      const p = clampToBall({
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius * 0.92,
      }, 0.985);
      rayPoints[ray][ring] = p;
    }
  }

  const shards: Shard[] = [];
  const edgeMap = new Map<string, CrackEdge & { count: number }>();

  for (let ray = 0; ray < rayCount; ray += 1) {
    const next = (ray + 1) % rayCount;
    addShard([center, rayPoints[ray][0], rayPoints[next][0]], shards, edgeMap, seed + ray);

    for (let ring = 1; ring < ringCount; ring += 1) {
      const innerA = rayPoints[ray][ring - 1];
      const outerA = rayPoints[ray][ring];
      const innerB = rayPoints[next][ring - 1];
      const outerB = rayPoints[next][ring];

      if ((ray + ring) % 2 === 0) {
        addShard([innerA, outerA, outerB], shards, edgeMap, seed + ray * 23 + ring);
        addShard([innerA, outerB, innerB], shards, edgeMap, seed + ray * 29 + ring);
      } else {
        addShard([innerA, outerA, innerB], shards, edgeMap, seed + ray * 37 + ring);
        addShard([outerA, outerB, innerB], shards, edgeMap, seed + ray * 41 + ring);
      }
    }
  }

  const edges = Array.from(edgeMap.values())
    .filter((edge) => edge.count > 1)
    .map((edge) => ({ a: edge.a, b: edge.b, weight: edge.weight }));
  const crumbs = edges
    .filter((_, index) => index % 3 === 0)
    .slice(0, 34)
    .map((edge, index) => {
      const t = 0.25 + noise(seed + index * 11) * 0.5;
      return {
        x: lerp(edge.a.x, edge.b.x, t),
        y: lerp(edge.a.y, edge.b.y, t),
        size: 1.7 + noise(seed + index * 19) * 3.4,
        phase: noise(seed + index * 43) * Math.PI * 2,
      };
    });

  return {
    id: zoneId++,
    center,
    radius: rings[ringCount - 1],
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
): void {
  if (Math.abs(polygonArea(polygon)) < 24) return;

  const center = polygonCentroid(polygon);
  const fromBall = normalize(sub(center, ball));
  shards.push({
    polygon,
    center,
    lift: 2.5 + noise(seed) * 8,
    tint: noise(seed + 9) - 0.5,
    angle: (noise(seed + 18) - 0.5) * 0.045,
  });

  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
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

function draw(timestamp: number): void {
  const dt = Math.min(0.04, (timestamp - lastTimestamp) / 1000);
  lastTimestamp = timestamp;
  pressure += (targetPressure - pressure) * (reducedMotion ? 0.4 : 0.16);

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
  gradient.addColorStop(1, '#ba4f74');

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(ball.x, ball.y + ball.radius * dent, radius * (1 + pressure * 0.025), radius * (0.96 - pressure * 0.02), 0, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.globalAlpha = 0.16 + pressure * 0.08;
  ctx.strokeStyle = '#fff5ee';
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
  const crackCoverage = Math.min(0.72, zones.reduce((sum, zone) => sum + zone.progress * 0.18, 0));
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
  ctx.globalAlpha = 0.96 - crackCoverage;
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
  ctx.save();
  clipBall(0.992);

  for (const shard of zone.shards) {
    const outward = normalize(sub(shard.center, zone.center));
    const offset = mul(outward, shard.lift * t);
    const angle = shard.angle * t;
    const color = adjustWaxColor(shard.tint, t);

    ctx.save();
    ctx.globalAlpha = 0.38 + t * 0.24;
    ctx.translate(shard.center.x + offset.x, shard.center.y + offset.y);
    ctx.rotate(angle);
    ctx.translate(-shard.center.x, -shard.center.y);
    drawPolygon(shard.polygon);
    ctx.fillStyle = color;
    ctx.shadowColor = `rgba(31, 39, 8, ${0.2 * t})`;
    ctx.shadowBlur = 8 * t;
    ctx.shadowOffsetY = 2 * t;
    ctx.fill();
    ctx.restore();
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  zone.edges.forEach((edge, index) => {
    const pulse = 0.88 + Math.sin(timestamp * 0.003 + zone.id + index) * 0.12;
    ctx.strokeStyle = `rgba(255, 137, 181, ${0.28 * t})`;
    ctx.lineWidth = (2.2 + edge.weight * 1.05) * t * pulse;
    drawJaggedLine(edge.a, edge.b, zone.id * 1000 + index * 13);
  });

  ctx.globalCompositeOperation = 'multiply';
  zone.edges.forEach((edge, index) => {
    const pulse = 0.9 + Math.sin(timestamp * 0.003 + zone.id + index) * 0.1;
    ctx.strokeStyle = `rgba(17, 23, 4, ${0.42 * t})`;
    ctx.lineWidth = (0.72 + edge.weight * 0.44) * t * pulse;
    drawJaggedLine(edge.a, edge.b, zone.id * 1000 + index * 13);
  });
  ctx.globalCompositeOperation = 'source-over';

  zone.crumbs.forEach((crumb) => {
    const drift = reducedMotion ? 0 : Math.sin(timestamp * 0.004 + crumb.phase) * 1.8;
    ctx.globalAlpha = 0.2 + t * 0.52;
    ctx.fillStyle = '#e7f99a';
    ctx.beginPath();
    ctx.arc(crumb.x + drift, crumb.y - drift * 0.35, crumb.size * t, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

function drawRubberMembrane(timestamp: number): void {
  const wobble = reducedMotion ? 0 : Math.sin(timestamp * 0.0017) * 0.006;
  ctx.save();
  ctx.globalAlpha = 0.42;
  ctx.lineWidth = Math.max(5, ball.radius * 0.026);
  ctx.strokeStyle = 'rgba(221, 255, 255, 0.36)';
  ctx.beginPath();
  ctx.ellipse(ball.x, ball.y, ball.radius * (1.02 + wobble), ball.radius * (1.0 - wobble), 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 0.38;
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

function triggerBreak(point: Point, force = 1): void {
  if (!isInsideBall(point)) return;
  lastBreakAt = performance.now();
  targetPressure = Math.max(targetPressure, 1);
  zones.push(createBreakZone(point, force));
  zones = zones.slice(-4);
  playCrack(force);
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
  updatePointer(event);
  canvas.setPointerCapture(event.pointerId);
  triggerBreak(pointer, event.pressure || 1);
});

canvas.addEventListener('click', (event) => {
  if (performance.now() - lastBreakAt < 120) return;
  pointer = {
    x: event.clientX,
    y: event.clientY,
  };
  triggerBreak(pointer, 1);
});

canvas.addEventListener('pointermove', (event) => {
  updatePointer(event);
  targetPressure = isDown ? 1 : 0.08;
  if (isDown && zones.length < 4 && noise(performance.now() * 0.02) > 0.68) {
    triggerBreak(pointer, 0.7);
  }
});

canvas.addEventListener('pointerup', (event) => {
  isDown = false;
  targetPressure = 0.12;
  if (activePointerId === event.pointerId && canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  activePointerId = null;
});

canvas.addEventListener('pointerleave', () => {
  isDown = false;
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

function adjustWaxColor(tint: number, crack: number): string {
  const base = [199, 240, 107];
  const light = [238, 252, 164];
  const dark = [125, 154, 38];
  const mixTarget = tint > 0 ? light : dark;
  const amount = Math.abs(tint) * 0.42 + crack * 0.08;
  const r = Math.round(lerp(base[0], mixTarget[0], amount));
  const g = Math.round(lerp(base[1], mixTarget[1], amount));
  const b = Math.round(lerp(base[2], mixTarget[2], amount));
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

resize();
resetArtwork();
requestAnimationFrame(draw);
