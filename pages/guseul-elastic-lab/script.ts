import { Delaunay } from 'd3-delaunay';
import GUI from 'lil-gui';

type Vertex = {
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  restX: number;
  restY: number;
};

type EdgeConstraint = {
  a: number;
  b: number;
  restLength: number;
};

type AreaConstraint = {
  a: number;
  b: number;
  c: number;
  restArea: number;
};

type PinVertex = {
  index: number;
  weight: number;
  offsetX: number;
  offsetY: number;
};

type Pin = {
  id: number;
  x: number;
  y: number;
  originX: number;
  originY: number;
  vertices: PinVertex[];
  persistent: boolean;
  demoPhase: number;
};

type Mesh = {
  vertices: Vertex[];
  edges: EdgeConstraint[];
  areas: AreaConstraint[];
  triangles: Uint32Array;
  boundary: number[];
};

type View = {
  width: number;
  height: number;
  dpr: number;
  centerX: number;
  centerY: number;
  radius: number;
};

const canvas = document.getElementById('elastic-canvas') as HTMLCanvasElement;
const context = canvas.getContext('2d');

if (!context) {
  throw new Error('Canvas 2D is not supported.');
}

const controls = {
  meshRings: 12,
  distanceStiffness: 0.82,
  areaStiffness: 0.42,
  returnStrength: 34,
  velocityDamping: 0.986,
  solverIterations: 8,
  grabRadius: 0.29,
  pinStiffness: 0.72,
  maxStretch: 2.65,
  baseColor: '#d8eff0',
  coolTint: '#55aeb2',
  warmTint: '#f2a49a',
  edgeColor: '#ffffff',
  shadowStrength: 0.16,
  meshDebug: false,
  pinDebug: false,
  demo: new URLSearchParams(window.location.search).get('demo') === '1',
};

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const fixedStep = 1 / 120;
const maxFrameDelta = 1 / 20;
const activePins = new Map<number, Pin>();
const pointerPositions = new Map<number, { x: number; y: number }>();
let mesh: Mesh;
let view: View;
let accumulator = 0;
let previousTime = performance.now();
let demoTime = 0;
let demoNeedsSetup = controls.demo && !prefersReducedMotion;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

function signedArea(a: Vertex, b: Vertex, c: Vertex): number {
  return ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * 0.5;
}

function createMesh(rings: number): Mesh {
  const vertices: Vertex[] = [];
  const boundary: number[] = [];
  const points: Array<[number, number]> = [];

  const addVertex = (normalizedX: number, normalizedY: number): number => {
    const x = view.centerX + normalizedX * view.radius;
    const y = view.centerY + normalizedY * view.radius;
    vertices.push({ x, y, previousX: x, previousY: y, restX: x, restY: y });
    points.push([x, y]);
    return vertices.length - 1;
  };

  addVertex(0, 0);

  for (let ring = 1; ring <= rings; ring += 1) {
    const count = ring * 6;
    const radius = ring / rings;
    const angleOffset = (ring % 2) * Math.PI / count;

    for (let segment = 0; segment < count; segment += 1) {
      const angle = (segment / count) * Math.PI * 2 + angleOffset;
      const index = addVertex(Math.cos(angle) * radius, Math.sin(angle) * radius);
      if (ring === rings) boundary.push(index);
    }
  }

  const delaunay = Delaunay.from(points);
  const triangles = new Uint32Array(delaunay.triangles);
  const edgeKeys = new Set<string>();
  const edges: EdgeConstraint[] = [];
  const areas: AreaConstraint[] = [];

  const addEdge = (a: number, b: number): void => {
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    const key = `${low}:${high}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({
      a: low,
      b: high,
      restLength: distance(vertices[low].x, vertices[low].y, vertices[high].x, vertices[high].y),
    });
  };

  for (let i = 0; i < triangles.length; i += 3) {
    const a = triangles[i];
    const b = triangles[i + 1];
    const c = triangles[i + 2];
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
    areas.push({ a, b, c, restArea: signedArea(vertices[a], vertices[b], vertices[c]) });
  }

  return { vertices, edges, areas, triangles, boundary };
}

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const radius = clamp(Math.min(width, height) * 0.3, 118, 330);

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);

  view = {
    width,
    height,
    dpr,
    centerX: width * 0.5,
    centerY: height * 0.5,
    radius,
  };

  activePins.clear();
  pointerPositions.clear();
  mesh = createMesh(controls.meshRings);
  demoNeedsSetup = controls.demo && !prefersReducedMotion;
}

function createBoundaryPath(): Path2D {
  const path = new Path2D();
  const vertices = mesh.boundary.map((index) => mesh.vertices[index]);
  const last = vertices[vertices.length - 1];
  const first = vertices[0];
  path.moveTo((last.x + first.x) * 0.5, (last.y + first.y) * 0.5);

  for (let i = 0; i < vertices.length; i += 1) {
    const current = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    path.quadraticCurveTo(current.x, current.y, (current.x + next.x) * 0.5, (current.y + next.y) * 0.5);
  }

  path.closePath();
  return path;
}

function isInsideMesh(x: number, y: number): boolean {
  const boundary = mesh.boundary;
  let inside = false;

  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i, i += 1) {
    const a = mesh.vertices[boundary[i]];
    const b = mesh.vertices[boundary[j]];
    const crosses = (a.y > y) !== (b.y > y)
      && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }

  return inside;
}

function createPin(id: number, x: number, y: number, persistent = false): Pin | null {
  if (!isInsideMesh(x, y)) return null;

  const radius = view.radius * controls.grabRadius;
  const affected: PinVertex[] = [];
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < mesh.vertices.length; index += 1) {
    const vertex = mesh.vertices[index];
    const localDistance = distance(x, y, vertex.x, vertex.y);
    if (localDistance < nearestDistance) {
      nearestDistance = localDistance;
      nearestIndex = index;
    }
    if (localDistance > radius) continue;
    const normalized = localDistance / radius;
    const weight = Math.pow(1 - normalized * normalized, 2);
    affected.push({
      index,
      weight,
      offsetX: vertex.x - x,
      offsetY: vertex.y - y,
    });
  }

  if (!affected.some((item) => item.index === nearestIndex)) {
    const nearest = mesh.vertices[nearestIndex];
    affected.push({
      index: nearestIndex,
      weight: 1,
      offsetX: nearest.x - x,
      offsetY: nearest.y - y,
    });
  }

  const pin: Pin = {
    id,
    x,
    y,
    originX: x,
    originY: y,
    vertices: affected,
    persistent,
    demoPhase: 0,
  };
  activePins.set(id, pin);
  return pin;
}

function integrate(delta: number): void {
  const damping = Math.pow(controls.velocityDamping, delta * 120);
  const returnAcceleration = controls.returnStrength * delta * delta;
  const maxStep = view.radius * controls.maxStretch * 0.08;

  for (const vertex of mesh.vertices) {
    const velocityX = clamp((vertex.x - vertex.previousX) * damping, -maxStep, maxStep);
    const velocityY = clamp((vertex.y - vertex.previousY) * damping, -maxStep, maxStep);
    vertex.previousX = vertex.x;
    vertex.previousY = vertex.y;
    vertex.x += velocityX + (vertex.restX - vertex.x) * returnAcceleration;
    vertex.y += velocityY + (vertex.restY - vertex.y) * returnAcceleration;
  }
}

function solveDistanceConstraints(): void {
  for (const edge of mesh.edges) {
    const a = mesh.vertices[edge.a];
    const b = mesh.vertices[edge.b];
    const deltaX = b.x - a.x;
    const deltaY = b.y - a.y;
    const currentLength = Math.hypot(deltaX, deltaY);
    if (currentLength < 0.0001) continue;

    const maxLength = edge.restLength * controls.maxStretch;
    const targetLength = Math.min(currentLength, maxLength);
    const correction = ((targetLength - edge.restLength) / currentLength)
      * controls.distanceStiffness * 0.5;
    const correctionX = deltaX * correction;
    const correctionY = deltaY * correction;
    a.x += correctionX;
    a.y += correctionY;
    b.x -= correctionX;
    b.y -= correctionY;
  }
}

function solveAreaConstraints(): void {
  for (const constraint of mesh.areas) {
    const a = mesh.vertices[constraint.a];
    const b = mesh.vertices[constraint.b];
    const c = mesh.vertices[constraint.c];
    const currentArea = signedArea(a, b, c);
    const error = currentArea - constraint.restArea;

    const gradientAX = (b.y - c.y) * 0.5;
    const gradientAY = (c.x - b.x) * 0.5;
    const gradientBX = (c.y - a.y) * 0.5;
    const gradientBY = (a.x - c.x) * 0.5;
    const gradientCX = (a.y - b.y) * 0.5;
    const gradientCY = (b.x - a.x) * 0.5;
    const denominator = gradientAX * gradientAX + gradientAY * gradientAY
      + gradientBX * gradientBX + gradientBY * gradientBY
      + gradientCX * gradientCX + gradientCY * gradientCY;
    if (denominator < 0.0001) continue;

    const lambda = (-error / denominator) * controls.areaStiffness;
    a.x += gradientAX * lambda;
    a.y += gradientAY * lambda;
    b.x += gradientBX * lambda;
    b.y += gradientBY * lambda;
    c.x += gradientCX * lambda;
    c.y += gradientCY * lambda;
  }
}

function solvePinConstraints(): void {
  for (const pin of activePins.values()) {
    for (const pinned of pin.vertices) {
      const vertex = mesh.vertices[pinned.index];
      const targetX = pin.x + pinned.offsetX;
      const targetY = pin.y + pinned.offsetY;
      const strength = controls.pinStiffness * pinned.weight;
      vertex.x += (targetX - vertex.x) * strength;
      vertex.y += (targetY - vertex.y) * strength;
    }
  }
}

function simulate(delta: number): void {
  integrate(delta);

  for (let iteration = 0; iteration < controls.solverIterations; iteration += 1) {
    solvePinConstraints();
    solveDistanceConstraints();
    solveAreaConstraints();
  }
}

function resetMesh(): void {
  activePins.clear();
  pointerPositions.clear();
  for (const vertex of mesh.vertices) {
    vertex.x = vertex.restX;
    vertex.y = vertex.restY;
    vertex.previousX = vertex.restX;
    vertex.previousY = vertex.restY;
  }
  demoNeedsSetup = controls.demo && !prefersReducedMotion;
}

function setupDemoPins(): void {
  const configs = [
    { id: -1, x: -0.58, y: -0.28, phase: 0 },
    { id: -2, x: 0.56, y: -0.18, phase: Math.PI * 0.67 },
    { id: -3, x: 0.06, y: 0.58, phase: Math.PI * 1.34 },
  ];

  activePins.clear();
  for (const config of configs) {
    const x = view.centerX + config.x * view.radius;
    const y = view.centerY + config.y * view.radius;
    const pin = createPin(config.id, x, y, true);
    if (pin) pin.demoPhase = config.phase;
  }
  demoTime = 0;
  demoNeedsSetup = false;
}

function updateDemo(delta: number): void {
  if (!controls.demo || prefersReducedMotion) return;
  if (demoNeedsSetup) setupDemoPins();
  demoTime += delta;

  for (const pin of activePins.values()) {
    if (pin.id >= 0) continue;
    const directionX = pin.originX - view.centerX;
    const directionY = pin.originY - view.centerY;
    const length = Math.hypot(directionX, directionY) || 1;
    const pulse = 0.36 + Math.sin(demoTime * 1.35 + pin.demoPhase) * 0.16;
    const sway = Math.sin(demoTime * 0.72 + pin.demoPhase * 1.7) * view.radius * 0.08;
    pin.x = pin.originX + (directionX / length) * view.radius * pulse - (directionY / length) * sway;
    pin.y = pin.originY + (directionY / length) * view.radius * pulse + (directionX / length) * sway;
  }
}

function drawMeshDebug(): void {
  context.save();
  context.strokeStyle = 'rgba(9, 56, 62, 0.2)';
  context.lineWidth = 0.75;
  context.beginPath();

  for (const edge of mesh.edges) {
    const a = mesh.vertices[edge.a];
    const b = mesh.vertices[edge.b];
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
  }

  context.stroke();
  context.restore();
}

function drawPinDebug(): void {
  context.save();
  for (const pin of activePins.values()) {
    const radius = view.radius * controls.grabRadius;
    const halo = context.createRadialGradient(pin.x, pin.y, 0, pin.x, pin.y, radius);
    halo.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
    halo.addColorStop(0.35, 'rgba(255, 255, 255, 0.12)');
    halo.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = halo;
    context.beginPath();
    context.arc(pin.x, pin.y, radius, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = 'rgba(20, 75, 78, 0.62)';
    context.beginPath();
    context.arc(pin.x, pin.y, 3.5, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function render(): void {
  context.clearRect(0, 0, view.width, view.height);
  context.fillStyle = '#f8f9f7';
  context.fillRect(0, 0, view.width, view.height);

  const path = createBoundaryPath();
  const bounds = mesh.boundary.reduce((result, index) => {
    const vertex = mesh.vertices[index];
    result.minX = Math.min(result.minX, vertex.x);
    result.maxX = Math.max(result.maxX, vertex.x);
    result.minY = Math.min(result.minY, vertex.y);
    result.maxY = Math.max(result.maxY, vertex.y);
    return result;
  }, {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  });
  const centerX = (bounds.minX + bounds.maxX) * 0.5;
  const centerY = (bounds.minY + bounds.maxY) * 0.5;
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);

  context.save();
  context.shadowColor = `rgba(20, 47, 48, ${controls.shadowStrength})`;
  context.shadowBlur = Math.max(22, span * 0.08);
  context.shadowOffsetY = Math.max(10, span * 0.035);
  context.fillStyle = 'rgba(44, 75, 75, 0.14)';
  context.fill(path);
  context.restore();

  context.save();
  context.clip(path);
  const body = context.createRadialGradient(
    centerX - span * 0.22,
    centerY - span * 0.28,
    span * 0.04,
    centerX,
    centerY,
    span * 0.66,
  );
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.32, controls.baseColor);
  body.addColorStop(0.72, controls.coolTint);
  body.addColorStop(1, '#2f7d82');
  context.fillStyle = body;
  context.fillRect(bounds.minX - span, bounds.minY - span, span * 3, span * 3);

  const warm = context.createRadialGradient(
    centerX + span * 0.25,
    centerY + span * 0.2,
    0,
    centerX + span * 0.25,
    centerY + span * 0.2,
    span * 0.58,
  );
  warm.addColorStop(0, `${controls.warmTint}b3`);
  warm.addColorStop(0.52, `${controls.warmTint}38`);
  warm.addColorStop(1, `${controls.warmTint}00`);
  context.globalCompositeOperation = 'screen';
  context.fillStyle = warm;
  context.fillRect(bounds.minX - span, bounds.minY - span, span * 3, span * 3);

  const wash = context.createLinearGradient(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
  wash.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
  wash.addColorStop(0.42, 'rgba(255, 255, 255, 0.04)');
  wash.addColorStop(1, 'rgba(11, 79, 82, 0.17)');
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = wash;
  context.fillRect(bounds.minX - 2, bounds.minY - 2, bounds.maxX - bounds.minX + 4, bounds.maxY - bounds.minY + 4);

  if (controls.pinDebug) drawPinDebug();
  if (controls.meshDebug) drawMeshDebug();
  context.restore();

  context.save();
  context.strokeStyle = controls.edgeColor;
  context.globalAlpha = 0.72;
  context.lineWidth = clamp(span * 0.009, 2, 6);
  context.stroke(path);
  context.globalAlpha = 0.18;
  context.strokeStyle = '#174f53';
  context.lineWidth = 1;
  context.stroke(path);
  context.restore();
}

function animate(time: number): void {
  const frameDelta = Math.min((time - previousTime) / 1000, maxFrameDelta);
  previousTime = time;
  accumulator += frameDelta;
  updateDemo(frameDelta);

  while (accumulator >= fixedStep) {
    simulate(fixedStep);
    accumulator -= fixedStep;
  }

  render();
  requestAnimationFrame(animate);
}

function pointerPosition(event: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

canvas.addEventListener('pointerdown', (event) => {
  if (controls.demo) {
    controls.demo = false;
    for (const id of [...activePins.keys()]) {
      if (id < 0) activePins.delete(id);
    }
  }

  const point = pointerPosition(event);
  const persistent = event.pointerType === 'mouse' && event.shiftKey;
  const pin = createPin(event.pointerId, point.x, point.y, persistent);
  if (!pin) return;

  pointerPositions.set(event.pointerId, point);
  canvas.setPointerCapture(event.pointerId);
  event.preventDefault();
});

canvas.addEventListener('pointermove', (event) => {
  const pin = activePins.get(event.pointerId);
  if (!pin) return;
  const point = pointerPosition(event);
  pin.x = point.x;
  pin.y = point.y;
  pointerPositions.set(event.pointerId, point);
  event.preventDefault();
});

function releasePointer(event: PointerEvent): void {
  const pin = activePins.get(event.pointerId);
  if (pin && !pin.persistent) activePins.delete(event.pointerId);
  pointerPositions.delete(event.pointerId);
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  event.preventDefault();
}

canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

function setupGui(): void {
  const gui = new GUI({ title: 'Elastic lab' });
  const actions = {
    reset: resetMesh,
    demo3Point: () => {
      controls.demo = true;
      resetMesh();
    },
    clearPins: () => {
      controls.demo = false;
      activePins.clear();
    },
  };

  gui.add(actions, 'demo3Point').name('3-point demo');
  gui.add(actions, 'reset').name('reset');

  const physics = gui.addFolder('1 physics');
  physics.add(controls, 'distanceStiffness', 0.2, 1, 0.01).name('stretch stiffness');
  physics.add(controls, 'areaStiffness', 0, 0.9, 0.01).name('area preserve');
  physics.add(controls, 'returnStrength', 0, 100, 1).name('return spring');
  physics.add(controls, 'velocityDamping', 0.94, 0.999, 0.001).name('damping');
  physics.add(controls, 'solverIterations', 2, 14, 1).name('solver passes');
  physics.add(controls, 'maxStretch', 1.2, 4, 0.05).name('edge stretch max');
  physics.close();

  const touch = gui.addFolder('2 touch pins');
  touch.add(controls, 'grabRadius', 0.08, 0.5, 0.01).name('grab radius');
  touch.add(controls, 'pinStiffness', 0.15, 1, 0.01).name('pin stiffness');
  touch.add(controls, 'pinDebug').name('show contacts');
  touch.add(actions, 'clearPins').name('clear pins');
  touch.close();

  const material = gui.addFolder('3 material');
  material.addColor(controls, 'baseColor').name('base');
  material.addColor(controls, 'coolTint').name('cool tint');
  material.addColor(controls, 'warmTint').name('warm tint');
  material.addColor(controls, 'edgeColor').name('edge');
  material.add(controls, 'shadowStrength', 0, 0.4, 0.01).name('shadow');
  material.close();

  const debug = gui.addFolder('4 debug');
  debug.add(controls, 'meshDebug').name('mesh');
  debug.add(controls, 'demo').name('demo').onChange((enabled: boolean) => {
    if (enabled) {
      demoNeedsSetup = true;
    } else {
      for (const id of [...activePins.keys()]) {
        if (id < 0) activePins.delete(id);
      }
    }
  });
  debug.close();
  gui.close();
}

window.addEventListener('resize', resize);
resize();
setupGui();
requestAnimationFrame(animate);
