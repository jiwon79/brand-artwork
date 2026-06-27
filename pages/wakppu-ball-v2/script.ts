import { Delaunay } from 'd3-delaunay';
import * as THREE from 'three';

type Point = {
  x: number;
  y: number;
};

type Shard = {
  polygon: Point[];
  center: Point;
  tint: number;
  lift: number;
  twist: number;
  split: number;
  consumed: number;
  phase: number;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
};

type CrackEdge = {
  a: Point;
  b: Point;
  weight: number;
  seam?: THREE.Mesh<THREE.TubeGeometry, THREE.MeshPhysicalMaterial>;
};

type BreakZone = {
  id: number;
  seed: number;
  normal: THREE.Vector3;
  tangent: THREE.Vector3;
  bitangent: THREE.Vector3;
  radius: number;
  damage: number;
  mix: number;
  progress: number;
  fractureCount: number;
  group: THREE.Group;
  shardGroup: THREE.Group;
  seamGroup: THREE.Group;
  gelMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  shards: Shard[];
  edges: CrackEdge[];
};

type SurfaceHit = {
  normal: THREE.Vector3;
  point: THREE.Vector3;
};

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const resetButton = document.querySelector('.reset-button') as HTMLButtonElement;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const EPSILON = 0.0001;
const SPHERE_RADIUS = 2.24;

const colors = {
  wax: new THREE.Color('#c7f06b'),
  waxLight: new THREE.Color('#eefca4'),
  waxDark: new THREE.Color('#7d9a26'),
  core: new THREE.Color('#fcfcf8'),
  coreDeep: new THREE.Color('#dce1db'),
  gel: new THREE.Color('#ffffff'),
  rubber: new THREE.Color('#dff8f5'),
  background: new THREE.Color('#171214'),
};

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.04;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = colors.background;

const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
camera.position.set(0, 0.16, 7.2);

const sphereGroup = new THREE.Group();
scene.add(sphereGroup);

const coreMaterial = new THREE.MeshPhysicalMaterial({
  color: colors.core,
  roughness: 0.58,
  metalness: 0,
  clearcoat: 0.28,
  clearcoatRoughness: 0.6,
});

const waxMaterial = new THREE.MeshPhysicalMaterial({
  color: colors.wax,
  roughness: 0.34,
  metalness: 0,
  clearcoat: 0.78,
  clearcoatRoughness: 0.2,
});

const rubberMaterial = new THREE.MeshPhysicalMaterial({
  color: colors.rubber,
  roughness: 0.2,
  metalness: 0,
  transparent: true,
  opacity: 0.24,
  clearcoat: 0.5,
  clearcoatRoughness: 0.16,
  depthWrite: false,
});

const gelMaterial = new THREE.MeshPhysicalMaterial({
  color: colors.gel,
  roughness: 0.36,
  metalness: 0,
  clearcoat: 0.34,
  clearcoatRoughness: 0.32,
  transparent: true,
  opacity: 0.82,
  depthWrite: false,
});

const seamMaterialTemplate = new THREE.MeshPhysicalMaterial({
  color: colors.gel,
  roughness: 0.5,
  metalness: 0,
  transparent: true,
  opacity: 0.92,
  depthWrite: false,
});

const coreMesh = new THREE.Mesh(
  new THREE.SphereGeometry(SPHERE_RADIUS * 0.93, 96, 48),
  coreMaterial,
);
coreMesh.castShadow = true;
coreMesh.receiveShadow = true;
sphereGroup.add(coreMesh);

const shellMesh = new THREE.Mesh(
  new THREE.SphereGeometry(SPHERE_RADIUS, 128, 64),
  waxMaterial,
);
shellMesh.castShadow = true;
shellMesh.receiveShadow = true;
sphereGroup.add(shellMesh);

const rubberMesh = new THREE.Mesh(
  new THREE.SphereGeometry(SPHERE_RADIUS * 1.018, 128, 64),
  rubberMaterial,
);
sphereGroup.add(rubberMesh);

const hitMesh = new THREE.Mesh(
  new THREE.SphereGeometry(SPHERE_RADIUS * 1.02, 64, 32),
  new THREE.MeshBasicMaterial({ visible: false }),
);
sphereGroup.add(hitMesh);

const speckGroup = new THREE.Group();
sphereGroup.add(speckGroup);

const keyLight = new THREE.DirectionalLight(0xffffff, 3.4);
keyLight.position.set(-3.2, 4.4, 5.8);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
scene.add(keyLight);

const fillLight = new THREE.HemisphereLight(0xfff7db, 0x1a1015, 1.42);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xdffcff, 1.5);
rimLight.position.set(3.6, 1.8, 3.4);
scene.add(rimLight);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(3.3, 96),
  new THREE.MeshBasicMaterial({
    color: 0x0b0709,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.set(0, -SPHERE_RADIUS * 1.08, -0.55);
floor.scale.set(1.25, 0.22, 1);
scene.add(floor);

const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const clock = new THREE.Clock();

let width = 1;
let height = 1;
let activePointerId: number | null = null;
let isDown = false;
let isRotating = false;
let pointerTravel = 0;
let lastPointer = new THREE.Vector2();
let currentHit: SurfaceHit | null = null;
let holdDuration = 0;
let lastBreakAt = 0;
let lastHoldBreakAt = 0;
let suppressClickUntil = 0;
let inputForce = 1;
let zoneId = 1;
let zones: BreakZone[] = [];
let audioContext: AudioContext | null = null;
let spinVelocity = new THREE.Vector2(0, 0);
let debugFrame = 0;

function resize(): void {
  width = window.innerWidth;
  height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.position.z = width < 720 ? 9.6 : 8.15;
  camera.updateProjectionMatrix();
}

function resetArtwork(): void {
  zones.forEach((zone) => {
    disposeObject3D(zone.group);
    sphereGroup.remove(zone.group);
  });
  zones = [];
  zoneId = 1;
  holdDuration = 0;
  pointerTravel = 0;
  isRotating = false;
  suppressClickUntil = 0;
  spinVelocity.set(0, 0);
  sphereGroup.quaternion.identity();
}

function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.geometry) return;
    mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((item) => item.dispose());
    } else if (material) {
      material.dispose();
    }
  });
}

function buildSpecks(): void {
  const speckGeometry = new THREE.SphereGeometry(0.008, 6, 4);
  const materials = [
    new THREE.MeshBasicMaterial({ color: 0xf6ffc4, transparent: true, opacity: 0.28 }),
    new THREE.MeshBasicMaterial({ color: 0x6f8820, transparent: true, opacity: 0.16 }),
  ];

  for (let i = 0; i < 150; i += 1) {
    const normal = randomSphereNormal(i * 97 + 31);
    const speck = new THREE.Mesh(speckGeometry, materials[i % 2]);
    speck.position.copy(normal.multiplyScalar(SPHERE_RADIUS * 1.004));
    speck.scale.setScalar(0.7 + noise(i * 17) * 1.6);
    speckGroup.add(speck);
  }
}

function createBreakZone(normal: THREE.Vector3, force = 1): BreakZone {
  const seed = Math.floor(Math.random() * 1_000_000_000) + zoneId * 1009;
  const rng = mulberry32(seed);
  const basis = createBasis(normal);
  const forceScale = Math.min(2.2, Math.max(0.45, force));
  const radius = (0.52 + rng() * 0.2) * (0.86 + forceScale * 0.1);
  const impactPolygon = createImpactPolygon(radius, 15 + Math.floor(rng() * 7), rng);
  const points = createImpactPoints(radius, impactPolygon, Math.round(13 + forceScale * 5 + rng() * 5), rng);
  const cells = createVoronoiCells(points, impactPolygon, boundsFromPolygon(impactPolygon, radius * 0.55));
  const edgeMap = new Map<string, CrackEdge & { count: number }>();
  const shardGroup = new THREE.Group();
  const seamGroup = new THREE.Group();
  const group = new THREE.Group();
  const gelMesh = new THREE.Mesh(new THREE.BufferGeometry(), gelMaterial.clone());
  gelMesh.renderOrder = 8;
  gelMesh.visible = false;
  group.add(shardGroup, seamGroup, gelMesh);
  sphereGroup.add(group);

  const zone: BreakZone = {
    id: zoneId++,
    seed,
    normal: normal.clone().normalize(),
    tangent: basis.tangent,
    bitangent: basis.bitangent,
    radius,
    damage: forceScale,
    mix: 0,
    progress: 0,
    fractureCount: 0,
    group,
    shardGroup,
    seamGroup,
    gelMesh,
    shards: [],
    edges: [],
  };

  cells.forEach((cell, index) => {
    addShard(zone, cell, edgeMap, seed + index * 41);
  });
  rebuildZoneEdges(zone, edgeMap);
  return zone;
}

function addShard(
  zone: BreakZone,
  polygon: Point[],
  edgeMap: Map<string, CrackEdge & { count: number }>,
  seed: number,
  split = 0,
  minArea = 0.0035,
): void {
  if (Math.abs(polygonArea(polygon)) < minArea) return;

  const material = new THREE.MeshPhysicalMaterial({
    color: colors.wax,
    roughness: 0.36,
    metalness: 0,
    clearcoat: 0.62,
    clearcoatRoughness: 0.22,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.renderOrder = 4;
  zone.shardGroup.add(mesh);

  const center = polygonCentroid(polygon);
  const shard: Shard = {
    polygon,
    center,
    tint: noise(seed + 9) - 0.5,
    lift: 0.016 + noise(seed + 17) * 0.045 + split * 0.006,
    twist: (noise(seed + 27) - 0.5) * (0.055 + split * 0.01),
    split,
    consumed: 0,
    phase: noise(seed + 38) * Math.PI * 2,
    mesh,
  };
  zone.shards.push(shard);
  registerShardEdges(shard, edgeMap, seed);
}

function registerShardEdges(
  shard: Shard,
  edgeMap: Map<string, CrackEdge & { count: number }>,
  seed: number,
): void {
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
        weight: 0.65 + noise(seed + i * 7) * 1.35,
      });
    }
  }
}

function rebuildZoneEdges(zone: BreakZone, edgeMap: Map<string, CrackEdge & { count: number }>): void {
  zone.seamGroup.children.forEach((child) => {
    const seam = child as THREE.Mesh<THREE.TubeGeometry, THREE.MeshPhysicalMaterial>;
    seam.geometry.dispose();
    seam.material.dispose();
  });
  zone.seamGroup.clear();
  zone.edges = Array.from(edgeMap.values())
    .filter((edge) => edge.count > 1)
    .map((edge, index) => {
      const material = seamMaterialTemplate.clone();
      material.opacity = 0.84;
      const seam = new THREE.Mesh(new THREE.TubeGeometry(createSurfaceCurve(zone, edge.a, edge.b, 0.018), 3, 0.009 + edge.weight * 0.002, 6, false), material);
      seam.renderOrder = 7;
      zone.seamGroup.add(seam);
      return {
        a: edge.a,
        b: edge.b,
        weight: edge.weight + noise(zone.seed + index * 19) * 0.4,
        seam,
      };
    });
}

function rebuildAllZoneEdges(zone: BreakZone, seed: number): void {
  const edgeMap = new Map<string, CrackEdge & { count: number }>();
  zone.shards.forEach((shard, index) => {
    registerShardEdges(shard, edgeMap, seed + index * 37 + shard.split * 131);
  });
  rebuildZoneEdges(zone, edgeMap);
}

function updateZone(zone: BreakZone, dt: number, elapsed: number): void {
  zone.progress += (1 - zone.progress) * (reducedMotion ? 0.5 : Math.min(0.16, dt * 7.2));
  const progress = smoothstep(zone.progress);
  const mix = smoothstep(zone.mix);

  zone.shards.forEach((shard) => {
    updateShardMesh(zone, shard, progress, mix, elapsed);
  });

  zone.edges.forEach((edge) => {
    if (!edge.seam) return;
    const material = edge.seam.material;
    material.opacity = (0.42 + mix * 0.44) * progress;
  });

  updateGelMesh(zone, progress, mix, elapsed);
}

function updateShardMesh(
  zone: BreakZone,
  shard: Shard,
  progress: number,
  mix: number,
  elapsed: number,
): void {
  const points = [shard.center, ...shard.polygon];
  const positions: number[] = [];
  const indices: number[] = [];
  const consumed = smoothstep(shard.consumed);
  const wobble = reducedMotion ? 0 : Math.sin(elapsed * 4.3 + shard.phase) * 0.004 * shard.split;

  points.forEach((point) => {
    const outward = Math.min(1, Math.hypot(point.x, point.y) / zone.radius);
    const anchor = 1 - smoothstep(Math.max(0, outward - 0.72) / 0.28);
    const lift = (0.004 + shard.lift * (0.22 + anchor * 0.78)) * progress * (1 - consumed * 0.48) + wobble;
    const twist = shard.twist * progress * anchor * (1 - consumed * 0.5);
    const rotated = rotatePoint(point, twist);
    const surfacePoint = tangentToSurface(zone, rotated, lift);
    positions.push(surfacePoint.x, surfacePoint.y, surfacePoint.z);
  });

  for (let i = 1; i < points.length; i += 1) {
    indices.push(0, i, i === points.length - 1 ? 1 : i + 1);
  }

  const geometry = shard.mesh.geometry;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const color = waxColor(shard.tint, consumed, mix);
  shard.mesh.material.color.copy(color);
  shard.mesh.material.opacity = 1;
}

function updateGelMesh(zone: BreakZone, progress: number, mix: number, elapsed: number): void {
  if (mix <= 0.02) {
    zone.gelMesh.visible = false;
    return;
  }

  zone.gelMesh.visible = true;
  const radius = zone.radius * (0.22 + mix * 0.68);
  const sides = 28;
  const positions: number[] = [];
  const indices: number[] = [];
  positions.push(...vectorToArray(tangentToSurface(zone, { x: 0, y: 0 }, 0.078 + mix * 0.05)));

  for (let i = 0; i < sides; i += 1) {
    const angle = (i / sides) * Math.PI * 2;
    const pulse = 0.78 + noise(zone.seed + i * 53) * 0.32 + (reducedMotion ? 0 : Math.sin(elapsed * 3 + i + zone.id) * 0.04);
    const point = {
      x: Math.cos(angle) * radius * pulse,
      y: Math.sin(angle) * radius * (0.82 + noise(zone.seed + i * 71) * 0.2),
    };
    positions.push(...vectorToArray(tangentToSurface(zone, point, 0.088 + mix * 0.06)));
  }

  for (let i = 1; i <= sides; i += 1) {
    indices.push(0, i, i === sides ? 1 : i + 1);
  }

  const geometry = zone.gelMesh.geometry;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  zone.gelMesh.material.opacity = (0.24 + mix * 0.62) * progress;
}

function triggerBreak(hit: SurfaceHit, force = 1, fromHold = false): void {
  lastBreakAt = performance.now();
  const existing = findBreakableZone(hit.normal);
  if (existing) {
    fractureExistingZone(existing, hit.normal, force, fromHold);
    consumeTouchedZone(existing, hit.normal, force, fromHold ? 0.09 : 0.04);
    playCrack(force * (fromHold ? 0.72 : 1));
    return;
  }

  const zone = createBreakZone(hit.normal, force);
  zones.push(zone);
  consumeTouchedZone(zone, hit.normal, force, fromHold ? 0.07 : 0.025);
  playCrack(force);
}

function findBreakableZone(normal: THREE.Vector3): BreakZone | null {
  let nearest: BreakZone | null = null;
  let nearestDistance = Infinity;

  zones.forEach((zone) => {
    const point = surfaceToZonePoint(zone, normal);
    const localDistance = Math.hypot(point.x, point.y);
    if (localDistance < zone.radius * (1.06 + zone.mix * 0.22) && localDistance < nearestDistance) {
      nearest = zone;
      nearestDistance = localDistance;
    }
  });

  return nearest;
}

function fractureExistingZone(zone: BreakZone, normal: THREE.Vector3, force: number, fromHold: boolean): void {
  const localPoint = surfaceToZonePoint(zone, normal);
  const forceScale = Math.min(2.6, Math.max(0.5, force));
  const seed = zone.seed + zone.fractureCount * 4099 + Math.floor(performance.now());
  const breakRadius = zone.radius * (0.26 + forceScale * 0.09 + zone.mix * 0.12);
  const candidates = zone.shards
    .map((shard, index) => ({
      shard,
      index,
      contains: pointInPolygon(localPoint, shard.polygon),
      distance: distance(localPoint, shard.center),
    }))
    .filter((candidate) => (
      candidate.contains
      || candidate.distance < breakRadius * (1 + candidate.shard.consumed * 0.35)
    ))
    .sort((a, b) => {
      if (a.contains !== b.contains) return a.contains ? -1 : 1;
      return a.distance - b.distance;
    });

  if (candidates.length === 0) return;

  const selectedCount = Math.min(
    candidates.length,
    Math.max(1, Math.round((fromHold ? 1 : 2) + forceScale * 1.15 + zone.mix * 1.3)),
  );
  const selectedIndexes = new Set(candidates.slice(0, selectedCount).map((candidate) => candidate.index));
  const nextShards: Shard[] = [];

  zone.shards.forEach((shard, index) => {
    if (!selectedIndexes.has(index)) {
      nextShards.push(shard);
      return;
    }

    const pieces = splitShard(zone, shard, localPoint, forceScale, seed + index * 83);
    if (pieces.length > 1) {
      zone.shardGroup.remove(shard.mesh);
      shard.mesh.geometry.dispose();
      shard.mesh.material.dispose();
      nextShards.push(...pieces);
    } else {
      shard.lift = Math.min(0.09, shard.lift + forceScale * 0.008);
      shard.twist += (noise(seed + index) - 0.5) * 0.04;
      nextShards.push(shard);
    }
  });

  zone.shards = nextShards;
  zone.fractureCount += 1;
  zone.damage = Math.min(4.4, zone.damage + forceScale * 0.16);
  zone.mix = Math.min(1, zone.mix + (fromHold ? 0.08 : 0.045) * forceScale);
  rebuildAllZoneEdges(zone, seed);
}

function splitShard(zone: BreakZone, shard: Shard, point: Point, forceScale: number, seed: number): Shard[] {
  const area = Math.abs(polygonArea(shard.polygon));
  if (area < 0.0022 || shard.split > 7) return [shard];

  const rng = mulberry32(seed);
  const focus = pointInPolygon(point, shard.polygon) ? point : shard.center;
  const splitCount = Math.min(12, Math.round(3 + forceScale * 2 + rng() * 3 + shard.split * 0.5));
  const splitPoints = createShardSplitPoints(shard.polygon, focus, splitCount, rng);
  const cells = createVoronoiCells(
    splitPoints,
    shard.polygon,
    boundsFromPolygon(shard.polygon, 0.08),
    Math.max(0.0009, area / (splitCount * 12)),
  );
  if (cells.length < 2) return [shard];

  const edgeMap = new Map<string, CrackEdge & { count: number }>();
  const pieces: Shard[] = [];
  cells.forEach((cell, index) => {
    const before = zone.shards.length;
    addShard(zone, cell, edgeMap, seed + index * 53, shard.split + 1, Math.max(0.0008, area / (splitCount * 16)));
    const created = zone.shards.pop();
    if (!created || zone.shards.length !== before) return;
    created.tint = created.tint * 0.62 + shard.tint * 0.38;
    created.lift = Math.min(0.095, created.lift + shard.lift * 0.48 + forceScale * 0.006);
    created.twist += shard.twist * 0.56;
    created.consumed = Math.min(1, shard.consumed + 0.02);
    pieces.push(created);
  });
  return pieces.length > 1 ? pieces : [shard];
}

function consumeTouchedZone(zone: BreakZone, normal: THREE.Vector3, force: number, amount: number): void {
  const localPoint = surfaceToZonePoint(zone, normal);
  const forceScale = Math.min(2.4, Math.max(0.5, force));
  zone.mix = Math.min(1, zone.mix + amount * (0.82 + forceScale * 0.32));

  zone.shards.forEach((shard) => {
    const falloff = Math.max(0, 1 - distance(localPoint, shard.center) / (zone.radius * (0.34 + zone.mix * 0.5)));
    if (falloff <= 0) return;
    shard.consumed = Math.min(1, shard.consumed + amount * falloff * (1.8 + forceScale * 0.6));
    shard.lift = Math.max(0.004, shard.lift - amount * falloff * 0.018);
  });
}

function getSurfaceHit(event: PointerEvent | MouseEvent): SurfaceHit | null {
  const rect = canvas.getBoundingClientRect();
  pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, camera);
  const hit = raycaster.intersectObject(hitMesh, false)[0];
  if (!hit) return null;

  const localPoint = sphereGroup.worldToLocal(hit.point.clone());
  return {
    normal: localPoint.clone().normalize(),
    point: hit.point.clone(),
  };
}

function rotateFromDrag(previous: THREE.Vector2, next: THREE.Vector2, dt: number): void {
  const dx = next.x - previous.x;
  const dy = next.y - previous.y;
  const yaw = dx * 0.0082;
  const pitch = dy * 0.007;
  const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const pitchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
  sphereGroup.quaternion.premultiply(yawQ).premultiply(pitchQ);
  if (!reducedMotion) {
    spinVelocity.set(dx / Math.max(16, dt), dy / Math.max(16, dt));
  }
}

function animate(): void {
  const dt = Math.min(0.04, clock.getDelta());
  const elapsed = clock.elapsedTime;

  if (!isDown && spinVelocity.lengthSq() > 0.0001) {
    rotateFromDrag(
      new THREE.Vector2(0, 0),
      new THREE.Vector2(spinVelocity.x * 14, spinVelocity.y * 14),
      16,
    );
    spinVelocity.multiplyScalar(reducedMotion ? 0.78 : Math.pow(0.02, dt));
  }

  if (isDown && currentHit) {
    holdDuration += dt;
    const holdForce = Math.min(2.55, inputForce + holdDuration * 0.72);
    const touchedZone = findBreakableZone(currentHit.normal);
    if (touchedZone) {
      consumeTouchedZone(touchedZone, currentHit.normal, holdForce, dt * (isRotating ? 0.7 : 1.8));
    }

    const interval = Math.max(86, 260 - holdForce * 58);
    const now = performance.now();
    if (!isRotating && now - lastHoldBreakAt > interval) {
      triggerBreak(currentHit, holdForce, true);
      lastHoldBreakAt = now;
    }
  }

  zones.forEach((zone) => updateZone(zone, dt, elapsed));
  renderer.render(scene, camera);
  updateCanvasStats();
}

function onPointerDown(event: PointerEvent): void {
  if (event.target === resetButton) return;
  activePointerId = event.pointerId;
  canvas.setPointerCapture(event.pointerId);
  isDown = true;
  isRotating = false;
  pointerTravel = 0;
  holdDuration = 0;
  lastPointer.set(event.clientX, event.clientY);
  inputForce = pointerForce(event);
  currentHit = getSurfaceHit(event);
  if (currentHit) {
    triggerBreak(currentHit, inputForce);
    lastHoldBreakAt = performance.now();
  }
}

function onPointerMove(event: PointerEvent): void {
  const next = new THREE.Vector2(event.clientX, event.clientY);
  if (isDown) {
    const travel = next.distanceTo(lastPointer);
    pointerTravel += travel;
    if (pointerTravel > 6) {
      isRotating = true;
      rotateFromDrag(lastPointer, next, event.timeStamp);
    }
  }

  currentHit = getSurfaceHit(event);
  lastPointer.copy(next);
  inputForce = pointerForce(event);
}

function onPointerUp(event: PointerEvent): void {
  isDown = false;
  if (pointerTravel > 7 || isRotating) suppressClickUntil = performance.now() + 260;
  isRotating = false;
  holdDuration = 0;
  if (activePointerId === event.pointerId && canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  activePointerId = null;
}

function onClick(event: MouseEvent): void {
  if (performance.now() < suppressClickUntil || performance.now() - lastBreakAt < 120) return;
  const hit = getSurfaceHit(event);
  if (hit) triggerBreak(hit, 1);
}

function pointerForce(event: PointerEvent): number {
  const raw = event.pressure && event.pressure > 0 ? event.pressure : 0.62;
  return Math.min(2.6, 0.72 + raw * 1.4 + holdDuration * 0.32);
}

function createBasis(normal: THREE.Vector3): { tangent: THREE.Vector3; bitangent: THREE.Vector3 } {
  const up = Math.abs(normal.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const tangent = new THREE.Vector3().crossVectors(up, normal).normalize();
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
  return { tangent, bitangent };
}

function tangentToSurface(zone: BreakZone, point: Point, offset = 0): THREE.Vector3 {
  return zone.normal.clone()
    .multiplyScalar(SPHERE_RADIUS)
    .addScaledVector(zone.tangent, point.x)
    .addScaledVector(zone.bitangent, point.y)
    .normalize()
    .multiplyScalar(SPHERE_RADIUS + offset);
}

function surfaceToZonePoint(zone: BreakZone, normal: THREE.Vector3): Point {
  const delta = normal.clone().normalize().multiplyScalar(SPHERE_RADIUS)
    .sub(zone.normal.clone().multiplyScalar(SPHERE_RADIUS));
  return {
    x: delta.dot(zone.tangent),
    y: delta.dot(zone.bitangent),
  };
}

function createSurfaceCurve(zone: BreakZone, a: Point, b: Point, offset: number): THREE.CatmullRomCurve3 {
  const mid = midpoint(a, b);
  return new THREE.CatmullRomCurve3([
    tangentToSurface(zone, a, offset * 0.72),
    tangentToSurface(zone, mid, offset),
    tangentToSurface(zone, b, offset * 0.72),
  ]);
}

function vectorToArray(vector: THREE.Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z];
}

function waxColor(tint: number, consumed: number, mix: number): THREE.Color {
  const target = tint > 0 ? colors.waxLight : colors.waxDark;
  const color = colors.wax.clone().lerp(target, Math.abs(tint) * 0.34);
  return color.lerp(colors.gel, Math.min(0.9, consumed * 0.82 + mix * 0.08));
}

function createImpactPolygon(radius: number, sides: number, rng: () => number): Point[] {
  const points: Point[] = [];
  const lean = (rng() - 0.5) * 0.22;

  for (let i = 0; i < sides; i += 1) {
    const angle = (i / sides) * Math.PI * 2 + lean * Math.sin(i * 0.7);
    const variance = 0.86 + rng() * 0.18;
    points.push({
      x: Math.cos(angle) * radius * variance,
      y: Math.sin(angle) * radius * variance * (0.82 + rng() * 0.14),
    });
  }

  return points;
}

function createImpactPoints(radius: number, polygon: Point[], count: number, rng: () => number): Point[] {
  const points: Point[] = [{ x: 0, y: 0 }];
  const boundaryCount = 8;

  for (let i = 0; i < boundaryCount; i += 1) {
    const angle = (i / boundaryCount) * Math.PI * 2 + (rng() - 0.5) * 0.18;
    points.push({
      x: Math.cos(angle) * radius * (0.68 + rng() * 0.16),
      y: Math.sin(angle) * radius * (0.6 + rng() * 0.18),
    });
  }

  let attempts = 0;
  while (points.length < count && attempts < count * 80) {
    attempts += 1;
    const angle = rng() * Math.PI * 2;
    const band = Math.sqrt(rng());
    const point = {
      x: Math.cos(angle) * radius * band * (0.96 + rng() * 0.1),
      y: Math.sin(angle) * radius * band * (0.82 + rng() * 0.12),
    };
    if (pointInPolygon(point, polygon)) points.push(point);
  }

  return points;
}

function createShardSplitPoints(
  polygon: Point[],
  focus: Point,
  count: number,
  rng: () => number,
): Point[] {
  const center = polygonCentroid(polygon);
  const points: Point[] = [pointInPolygon(focus, polygon) ? focus : center, center];
  const maxRadius = polygon.reduce((max, point) => Math.max(max, distance(focus, point)), 0);
  const [minX, minY, maxX, maxY] = boundsFromPolygon(polygon, 0);

  let attempts = 0;
  while (points.length < count && attempts < count * 90) {
    attempts += 1;
    const useFocus = rng() < 0.76;
    const candidate = useFocus
      ? {
        x: focus.x + Math.cos(rng() * Math.PI * 2) * maxRadius * Math.sqrt(rng()) * (0.18 + rng() * 0.78),
        y: focus.y + Math.sin(rng() * Math.PI * 2) * maxRadius * Math.sqrt(rng()) * (0.18 + rng() * 0.78),
      }
      : {
        x: lerp(minX, maxX, rng()),
        y: lerp(minY, maxY, rng()),
      };
    if (pointInPolygon(candidate, polygon)) points.push(candidate);
  }

  return points;
}

function createVoronoiCells(
  points: Point[],
  clipPolygon: Point[],
  bounds: [number, number, number, number],
  minArea = 0.005,
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
    if (!previous || distance(previous, point) > 0.0005) deduped.push(point);
  }
  if (deduped.length > 1 && distance(deduped[0], deduped[deduped.length - 1]) < 0.0005) {
    deduped.pop();
  }
  return deduped;
}

function boundsFromPolygon(polygon: Point[], padding: number): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  polygon.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });

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
  if (Math.abs(area) < 0.00001) {
    const sum = points.reduce((acc, point) => add(acc, point), { x: 0, y: 0 });
    return { x: sum.x / points.length, y: sum.y / points.length };
  }

  let x = 0;
  let y = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const value = a.x * b.y - b.x * a.y;
    x += (a.x + b.x) * value;
    y += (a.y + b.y) * value;
  }
  return { x: x / (6 * area), y: y / (6 * area) };
}

function edgeKey(a: Point, b: Point): string {
  const aKey = `${Math.round(a.x * 1000)},${Math.round(a.y * 1000)}`;
  const bKey = `${Math.round(b.x * 1000)},${Math.round(b.y * 1000)}`;
  return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
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
    gain.gain.exponentialRampToValueAtTime(0.05 * force, now + i * 0.018 + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.018 + 0.052);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(now + i * 0.018);
    osc.stop(now + i * 0.075);
  }
}

function randomSphereNormal(seed: number): THREE.Vector3 {
  const z = noise(seed) * 2 - 1;
  const angle = noise(seed + 31) * Math.PI * 2;
  const radius = Math.sqrt(1 - z * z);
  return new THREE.Vector3(Math.cos(angle) * radius, z, Math.sin(angle) * radius).normalize();
}

function rotatePoint(point: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
}

function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function noise(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453123;
  return value - Math.floor(value);
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

function updateCanvasStats(): void {
  debugFrame += 1;
  if (debugFrame % 24 !== 0) return;

  const gl = renderer.getContext();
  const sampleWidth = Math.min(120, gl.drawingBufferWidth);
  const sampleHeight = Math.min(90, gl.drawingBufferHeight);
  const x = Math.max(0, Math.floor((gl.drawingBufferWidth - sampleWidth) / 2));
  const y = Math.max(0, Math.floor((gl.drawingBufferHeight - sampleHeight) / 2));
  const pixels = new Uint8Array(sampleWidth * sampleHeight * 4);
  gl.readPixels(x, y, sampleWidth, sampleHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  let nonDark = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    red += pixels[i];
    green += pixels[i + 1];
    blue += pixels[i + 2];
    if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 72) nonDark += 1;
  }

  const total = sampleWidth * sampleHeight;
  canvas.dataset.renderStats = JSON.stringify({
    width: gl.drawingBufferWidth,
    height: gl.drawingBufferHeight,
    nonDarkRatio: nonDark / total,
    average: [
      Math.round(red / total),
      Math.round(green / total),
      Math.round(blue / total),
    ],
    zones: zones.length,
    shards: zones.reduce((sum, zone) => sum + zone.shards.length, 0),
  });
}

function exposeDebugApi(): void {
  const target = window as Window & {
    __wakppuDebug?: {
      stats: () => {
        width: number;
        height: number;
        nonDarkRatio: number;
        average: [number, number, number];
        zones: number;
        shards: number;
      };
    };
  };

  target.__wakppuDebug = {
    stats: () => {
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      const sampleWidth = Math.min(240, gl.drawingBufferWidth);
      const sampleHeight = Math.min(180, gl.drawingBufferHeight);
      const x = Math.max(0, Math.floor((gl.drawingBufferWidth - sampleWidth) / 2));
      const y = Math.max(0, Math.floor((gl.drawingBufferHeight - sampleHeight) / 2));
      const pixels = new Uint8Array(sampleWidth * sampleHeight * 4);
      gl.readPixels(x, y, sampleWidth, sampleHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      let nonDark = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        r += pixels[i];
        g += pixels[i + 1];
        b += pixels[i + 2];
        if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 72) nonDark += 1;
      }

      const total = sampleWidth * sampleHeight;
      return {
        width: gl.drawingBufferWidth,
        height: gl.drawingBufferHeight,
        nonDarkRatio: nonDark / total,
        average: [r / total, g / total, b / total],
        zones: zones.length,
        shards: zones.reduce((sum, zone) => sum + zone.shards.length, 0),
      };
    },
  };
}

canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointerleave', onPointerUp);
canvas.addEventListener('click', onClick);
resetButton.addEventListener('click', resetArtwork);
window.addEventListener('resize', resize);

resize();
buildSpecks();
exposeDebugApi();
renderer.setAnimationLoop(animate);
