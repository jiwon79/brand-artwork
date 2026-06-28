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
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial | THREE.MeshPhysicalMaterial[]>;
};

type CrackEdge = {
  a: Point;
  b: Point;
  weight: number;
};

type ImpactFootprint = {
  kind: 'press' | 'stroke';
  direction: Point;
  stretch: number;
  width: number;
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
  pressure: number;
  progress: number;
  fractureCount: number;
  group: THREE.Group;
  shardGroup: THREE.Group;
  gelMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  shards: Shard[];
  edges: CrackEdge[];
};

type SurfaceHit = {
  normal: THREE.Vector3;
  point: THREE.Vector3;
};

type SurfaceDeformOptions = {
  pressStrength: number;
  carveStrength: number;
  carveDepth: number;
};

type BreakZoneCreation = {
  zone: BreakZone | null;
  fracturedOverlap: boolean;
};

type OverlapHit = {
  zone: BreakZone;
  normal: THREE.Vector3;
  score: number;
};

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const resetButton = document.querySelector('.reset-button') as HTMLButtonElement;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const EPSILON = 0.0001;
const SPHERE_RADIUS = 2.24;
const WAX_THICKNESS = 0.026;

const colors = {
  wax: new THREE.Color('#c7f06b'),
  waxLight: new THREE.Color('#eefca4'),
  waxDark: new THREE.Color('#7d9a26'),
  waxCut: new THREE.Color('#9fbd45'),
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
  roughness: 0.28,
  metalness: 0,
  clearcoat: 0.92,
  clearcoatRoughness: 0.14,
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
  roughness: 0.48,
  metalness: 0,
  clearcoat: 0.18,
  clearcoatRoughness: 0.52,
  transparent: false,
  opacity: 0.82,
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

const shellBasePositions = clonePositions(shellMesh.geometry);
const rubberBasePositions = clonePositions(rubberMesh.geometry);
const coreBasePositions = clonePositions(coreMesh.geometry);

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
const activePointers = new Map<number, THREE.Vector2>();
let isDown = false;
let isRotating = false;
let pointerTravel = 0;
let lastPointer = new THREE.Vector2();
let lastGestureAt = performance.now();
let currentHit: SurfaceHit | null = null;
let holdDuration = 0;
let lastBreakAt = 0;
let lastHoldBreakAt = 0;
let lastStrokeBreakAt = 0;
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
  activePointers.clear();
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
    disposeMaterial(mesh.material);
  });
}

function disposeMaterial(material: THREE.Material | THREE.Material[] | undefined): void {
  if (Array.isArray(material)) {
    material.forEach((item) => item.dispose());
  } else if (material) {
    material.dispose();
  }
}

function clonePositions(geometry: THREE.BufferGeometry): Float32Array {
  return new Float32Array((geometry.getAttribute('position').array as Float32Array));
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

function createBreakZone(normal: THREE.Vector3, force = 1, impact?: ImpactFootprint): BreakZoneCreation {
  const seed = Math.floor(Math.random() * 1_000_000_000) + zoneId * 1009;
  const rng = mulberry32(seed);
  const basis = createBasis(normal);
  const forceScale = Math.min(2.2, Math.max(0.45, force));
  const footprint = impact ?? {
    kind: 'press',
    direction: { x: 1, y: 0 },
    stretch: 1,
    width: 0.92,
  };
  const radiusBase = footprint.kind === 'stroke' ? 0.2 + rng() * 0.05 : 0.46 + rng() * 0.12;
  const radius = radiusBase * (0.9 + forceScale * 0.08);
  const impactPolygon = createImpactPolygon(radius, 13 + Math.floor(rng() * 5), rng, footprint);
  const points = createImpactPoints(
    radius,
    impactPolygon,
    Math.round((footprint.kind === 'stroke' ? 6 : 11) + forceScale * 3 + rng() * 3),
    rng,
    footprint,
  );
  const cells = createVoronoiCells(points, impactPolygon, boundsFromPolygon(impactPolygon, radius * 0.55));
  const availableCells: Point[][] = [];
  const overlapHits: OverlapHit[] = [];

  cells.forEach((cell) => {
    const overlap = findOverlappingBreakCell(normal, basis.tangent, basis.bitangent, cell);
    if (overlap) {
      overlapHits.push(overlap);
    } else {
      availableCells.push(cell);
    }
  });

  const fracturedOverlap = fractureOverlappingBreakCells(overlapHits, forceScale, footprint, seed);
  if (availableCells.length === 0) {
    return { zone: null, fracturedOverlap };
  }

  const edgeMap = new Map<string, CrackEdge & { count: number }>();
  const shardGroup = new THREE.Group();
  const group = new THREE.Group();
  const gelMesh = new THREE.Mesh(new THREE.BufferGeometry(), gelMaterial.clone());
  gelMesh.renderOrder = 3;
  gelMesh.visible = false;
  group.add(shardGroup, gelMesh);
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
    pressure: 0,
    progress: 0,
    fractureCount: 0,
    group,
    shardGroup,
    gelMesh,
    shards: [],
    edges: [],
  };

  availableCells.forEach((cell, index) => {
    addShard(zone, cell, edgeMap, seed + index * 41);
  });

  if (zone.shards.length === 0) {
    sphereGroup.remove(group);
    disposeObject3D(group);
    return { zone: null, fracturedOverlap };
  }

  rebuildZoneEdges(zone, edgeMap);
  return { zone, fracturedOverlap };
}

function findOverlappingBreakCell(
  normal: THREE.Vector3,
  tangent: THREE.Vector3,
  bitangent: THREE.Vector3,
  cell: Point[],
): OverlapHit | null {
  if (zones.length === 0) return null;

  const samples = [polygonCentroid(cell), ...cell];
  let bestHit: OverlapHit | null = null;

  samples.forEach((sample, index) => {
    const sampleNormal = tangentBasisPointToNormal(normal, tangent, bitangent, sample);
    zones.forEach((zone) => {
      const facing = sampleNormal.dot(zone.normal);
      if (facing < 0.68) return;

      const localPoint = surfaceToZonePoint(zone, sampleNormal);
      const localDistance = Math.hypot(localPoint.x, localPoint.y);
      if (localDistance > zone.radius * (1.12 + Math.min(0.22, zone.fractureCount * 0.018))) return;

      const overlap = shardFootprintMask(zone, localPoint, zone.radius * 0.05);
      if (overlap <= 0) return;

      const score = overlap * (index === 0 ? 1.2 : 1) * facing;
      if (!bestHit || score > bestHit.score) {
        bestHit = {
          zone,
          normal: sampleNormal,
          score,
        };
      }
    });
  });

  return bestHit;
}

function fractureOverlappingBreakCells(
  overlapHits: OverlapHit[],
  forceScale: number,
  impact: ImpactFootprint,
  seed: number,
): boolean {
  if (overlapHits.length === 0) return false;

  const groupedHits = new Map<number, OverlapHit[]>();
  overlapHits.forEach((hit) => {
    groupedHits.set(hit.zone.id, [...(groupedHits.get(hit.zone.id) ?? []), hit]);
  });

  const selectedHits: OverlapHit[] = [];
  groupedHits.forEach((hits) => {
    selectedHits.push(...hits.sort((a, b) => b.score - a.score).slice(0, 2));
  });

  selectedHits
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .forEach((hit, index) => {
      fractureExistingZone(
        hit.zone,
        hit.normal,
        forceScale * (0.82 + Math.min(0.22, hit.score * 0.14)),
        true,
        impact,
      );
      hit.zone.damage = Math.min(4.4, hit.zone.damage + 0.025 + index * 0.004 + noise(seed + index * 31) * 0.01);
    });

  return true;
}

function tangentBasisPointToNormal(
  normal: THREE.Vector3,
  tangent: THREE.Vector3,
  bitangent: THREE.Vector3,
  point: Point,
): THREE.Vector3 {
  return normal.clone()
    .multiplyScalar(SPHERE_RADIUS)
    .addScaledVector(tangent, point.x)
    .addScaledVector(bitangent, point.y)
    .normalize();
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

  const topMaterial = new THREE.MeshPhysicalMaterial({
    color: colors.wax,
    roughness: 0.25,
    metalness: 0,
    clearcoat: 0.88,
    clearcoatRoughness: 0.16,
    side: THREE.DoubleSide,
    emissive: colors.wax.clone().multiplyScalar(0.08),
  });
  const undersideMaterial = new THREE.MeshPhysicalMaterial({
    color: colors.waxLight,
    roughness: 0.42,
    metalness: 0,
    clearcoat: 0.38,
    clearcoatRoughness: 0.32,
    side: THREE.DoubleSide,
    emissive: colors.waxLight.clone().multiplyScalar(0.08),
  });
  const edgeMaterial = new THREE.MeshPhysicalMaterial({
    color: colors.waxCut,
    roughness: 0.34,
    metalness: 0,
    clearcoat: 0.46,
    clearcoatRoughness: 0.24,
    side: THREE.DoubleSide,
    emissive: colors.waxCut.clone().multiplyScalar(0.12),
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), [topMaterial, undersideMaterial, edgeMaterial]);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 4;
  zone.shardGroup.add(mesh);

  const center = polygonCentroid(polygon);
  const shard: Shard = {
    polygon,
    center,
    tint: noise(seed + 9) - 0.5,
    lift: 0.002 + noise(seed + 17) * 0.012 + split * 0.0015,
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
  zone.edges = Array.from(edgeMap.values())
    .filter((edge) => edge.count > 1)
    .map((edge, index) => {
      return {
        a: edge.a,
        b: edge.b,
        weight: edge.weight + noise(zone.seed + index * 19) * 0.4,
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
  const ooze = 0;

  zone.shards.forEach((shard) => {
    updateShardMesh(zone, shard, progress, ooze, elapsed);
  });

  updateGelMesh(zone, progress);
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
  const pressure = smoothstep(zone.pressure);
  const wobble = reducedMotion ? 0 : Math.sin(elapsed * 4.3 + shard.phase) * 0.0015 * shard.split * (1 - pressure);
  const topOffsets: number[] = [];
  const rotatedPoints: Point[] = [];
  const shardDistance = Math.hypot(shard.center.x, shard.center.y);
  const shardDirection = shardDistance > EPSILON
    ? { x: shard.center.x / shardDistance, y: shard.center.y / shardDistance }
    : { x: Math.cos(shard.phase), y: Math.sin(shard.phase) };
  const splitProgress = progress * (0.68 + pressure * 0.32);
  const gap = splitProgress * (0.028 + pressure * 0.044 + zone.fractureCount * 0.006) * (1 - consumed * 0.15);
  const inset = Math.min(0.16, splitProgress * (0.048 + pressure * 0.048 + zone.fractureCount * 0.006));
  const shiftedCenter = {
    x: shard.center.x + shardDirection.x * gap,
    y: shard.center.y + shardDirection.y * gap,
  };
  const tiltAxis = {
    x: Math.cos(shard.phase),
    y: Math.sin(shard.phase),
  };

  points.forEach((point) => {
    const outward = Math.min(1, Math.hypot(point.x, point.y) / zone.radius);
    const anchor = 1 - smoothstep(Math.max(0, outward - 0.72) / 0.28);
    const surfaceLift = shard.lift * (0.05 + anchor * 0.16) * progress * (1 - consumed * 0.72);
    const pressedIn = (
      pressure * (0.06 + zone.damage * 0.008)
      + consumed * 0.028
      + mix * 0.028
    ) * (0.2 + anchor * 0.8);
    const twist = shard.twist * progress * anchor * (1 - consumed * 0.5);
    const local = {
      x: (point.x - shard.center.x) * (1 - inset),
      y: (point.y - shard.center.y) * (1 - inset),
    };
    const rotatedLocal = rotatePoint(local, twist);
    const separated = {
      x: shiftedCenter.x + rotatedLocal.x,
      y: shiftedCenter.y + rotatedLocal.y,
    };
    const tilt = (
      (rotatedLocal.x * tiltAxis.x + rotatedLocal.y * tiltAxis.y)
      / Math.max(zone.radius, EPSILON)
    ) * splitProgress * (0.026 + pressure * 0.032);
    const centerSink = splitProgress * pressure * (
      0.004 + (1 - Math.min(1, shardDistance / Math.max(zone.radius, EPSILON))) * 0.004
    );
    const lift = Math.max(-0.002, surfaceLift - pressedIn - centerSink + tilt + wobble);
    rotatedPoints.push(separated);
    topOffsets.push(lift);
    const surfacePoint = tangentToSurface(zone, separated, lift);
    positions.push(surfacePoint.x, surfacePoint.y, surfacePoint.z);
  });

  points.forEach((_, index) => {
    const bottomOffset = topOffsets[index] - WAX_THICKNESS * (0.95 + progress * 0.38 + pressure * 0.18);
    const surfacePoint = tangentToSurface(zone, rotatedPoints[index], bottomOffset);
    positions.push(surfacePoint.x, surfacePoint.y, surfacePoint.z);
  });

  for (let i = 1; i < points.length; i += 1) {
    indices.push(0, i, i === points.length - 1 ? 1 : i + 1);
  }

  const bottomCenter = points.length;
  for (let i = 1; i < points.length; i += 1) {
    const currentBottom = bottomCenter + i;
    const nextBottom = bottomCenter + (i === points.length - 1 ? 1 : i + 1);
    indices.push(bottomCenter, nextBottom, currentBottom);
  }

  for (let i = 1; i < points.length; i += 1) {
    const next = i === points.length - 1 ? 1 : i + 1;
    const currentBottom = bottomCenter + i;
    const nextBottom = bottomCenter + next;
    indices.push(i, currentBottom, nextBottom);
    indices.push(i, nextBottom, next);
  }

  const geometry = shard.mesh.geometry;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const capIndexCount = (points.length - 1) * 3;
  geometry.clearGroups();
  geometry.addGroup(0, capIndexCount, 0);
  geometry.addGroup(capIndexCount, capIndexCount, 1);
  geometry.addGroup(capIndexCount * 2, indices.length - capIndexCount * 2, 2);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const color = waxColor(shard.tint, consumed, mix);
  const materials = Array.isArray(shard.mesh.material) ? shard.mesh.material : [shard.mesh.material];
  const [topMaterial, undersideMaterial, edgeMaterial] = materials;
  topMaterial.color.copy(color);
  topMaterial.emissive.copy(color).multiplyScalar(0.08 + consumed * 0.05);
  topMaterial.opacity = 1;
  if (undersideMaterial) {
    const undersideColor = colors.waxLight.clone().lerp(colors.waxCut, Math.min(0.32, 0.14 + consumed * 0.14));
    undersideMaterial.color.copy(undersideColor);
    undersideMaterial.emissive.copy(undersideColor).multiplyScalar(0.08);
    undersideMaterial.opacity = 1;
  }
  if (edgeMaterial) {
    const exposedCut = Math.min(0.7, 0.44 + consumed * 0.2);
    const edgeColor = colors.waxDark.clone().lerp(colors.waxCut, exposedCut);
    edgeMaterial.color.copy(edgeColor);
    edgeMaterial.emissive.copy(edgeColor).multiplyScalar(0.05);
    edgeMaterial.opacity = 1;
  }
}

function updateGelMesh(zone: BreakZone, progress: number): void {
  if (zone.shards.length === 0) {
    zone.gelMesh.visible = false;
    return;
  }

  zone.gelMesh.visible = true;
  const pressure = smoothstep(zone.pressure);
  const positions: number[] = [];
  const indices: number[] = [];
  const bedOffset = -WAX_THICKNESS * (
    1.18
    + pressure * 0.34
    + Math.min(0.42, zone.fractureCount * 0.035)
  );

  zone.shards.forEach((shard, shardIndex) => {
    const baseIndex = positions.length / 3;
    const settle = Math.min(0.012, smoothstep(shard.consumed) * 0.008 + shard.split * 0.0008);
    const center = tangentToSurface(zone, shard.center, bedOffset - settle);
    positions.push(center.x, center.y, center.z);

    shard.polygon.forEach((point, pointIndex) => {
      const uneven = noise(zone.seed + shardIndex * 191 + pointIndex * 37) * 0.004;
      const surfacePoint = tangentToSurface(zone, point, bedOffset - settle - uneven);
      positions.push(surfacePoint.x, surfacePoint.y, surfacePoint.z);
    });

    for (let i = 1; i <= shard.polygon.length; i += 1) {
      indices.push(baseIndex, baseIndex + i, baseIndex + (i === shard.polygon.length ? 1 : i + 1));
    }
  });

  const geometry = zone.gelMesh.geometry;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  zone.gelMesh.material.transparent = true;
  zone.gelMesh.material.depthTest = false;
  zone.gelMesh.material.depthWrite = false;
  zone.gelMesh.material.color.copy(colors.waxCut).lerp(colors.waxDark, 0.18 + pressure * 0.08);
  zone.gelMesh.material.opacity = Math.min(0.46, (0.24 + pressure * 0.14) * progress);
}

function triggerBreak(hit: SurfaceHit, force = 1, fromHold = false, impact?: ImpactFootprint): void {
  lastBreakAt = performance.now();
  const existing = findBreakableZone(hit.normal);
  const shouldCreateStrokeTrail = impact?.kind === 'stroke'
    && (!existing || shouldCreateTrailZone(existing, hit.normal, impact));

  if (existing && !shouldCreateStrokeTrail) {
    fractureExistingZone(existing, hit.normal, force, fromHold, impact);
    consumeTouchedZone(existing, hit.normal, force, fromHold ? 0.032 : 0.012);
    playCrack(force * (fromHold ? 0.76 : 1), impact?.kind === 'stroke' ? 1.25 : 1);
    return;
  }

  const creation = createBreakZone(hit.normal, force, impact);
  if (creation.zone) {
    zones.push(creation.zone);
    consumeTouchedZone(creation.zone, hit.normal, force, fromHold ? 0.026 : 0.014);
  }
  if (creation.zone || creation.fracturedOverlap) {
    playCrack(force, impact?.kind === 'stroke' ? 1.35 : 1);
  }
}

function findBreakableZone(normal: THREE.Vector3): BreakZone | null {
  let nearest: BreakZone | null = null;
  let nearestDistance = Infinity;

  zones.forEach((zone) => {
    const point = surfaceToZonePoint(zone, normal);
    const localDistance = Math.hypot(point.x, point.y);
    if (localDistance < zone.radius * 1.04 && localDistance < nearestDistance) {
      nearest = zone;
      nearestDistance = localDistance;
    }
  });

  return nearest;
}

function shouldCreateTrailZone(zone: BreakZone, normal: THREE.Vector3, impact: ImpactFootprint): boolean {
  const localPoint = surfaceToZonePoint(zone, normal);
  const localDistance = Math.hypot(localPoint.x, localPoint.y);
  const direction = normalizePoint(impact.direction);
  const along = Math.abs(localPoint.x * direction.x + localPoint.y * direction.y);
  return localDistance > zone.radius * 0.62 || along > zone.radius * 0.56;
}

function fractureExistingZone(
  zone: BreakZone,
  normal: THREE.Vector3,
  force: number,
  fromHold: boolean,
  impact?: ImpactFootprint,
): void {
  const localPoint = surfaceToZonePoint(zone, normal);
  const forceScale = Math.min(2.6, Math.max(0.5, force));
  const seed = zone.seed + zone.fractureCount * 4099 + Math.floor(performance.now());
  const breakRadius = zone.radius * (
    impact?.kind === 'stroke'
      ? 0.16 + forceScale * 0.04
      : 0.2 + forceScale * 0.06
  );
  const candidates = zone.shards
    .map((shard, index) => ({
      shard,
      index,
      contains: pointInPolygon(localPoint, shard.polygon),
      distance: impact?.kind === 'stroke'
        ? strokeDistance(localPoint, shard.center, impact, breakRadius * impact.stretch)
        : distance(localPoint, shard.center),
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
    Math.max(1, Math.round((fromHold ? 1 : 1.35) + forceScale * 0.75)),
  );
  const selectedIndexes = new Set(candidates.slice(0, selectedCount).map((candidate) => candidate.index));
  const nextShards: Shard[] = [];

  zone.shards.forEach((shard, index) => {
    if (!selectedIndexes.has(index)) {
      nextShards.push(shard);
      return;
    }

    const pieces = splitShard(zone, shard, localPoint, forceScale, seed + index * 83, impact);
    if (pieces.length > 1) {
      zone.shardGroup.remove(shard.mesh);
      shard.mesh.geometry.dispose();
      disposeMaterial(shard.mesh.material);
      nextShards.push(...pieces);
    } else {
      shard.lift = Math.max(0, shard.lift - forceScale * 0.002);
      shard.twist += (noise(seed + index) - 0.5) * 0.04;
      nextShards.push(shard);
    }
  });

  zone.shards = nextShards;
  zone.fractureCount += 1;
  zone.damage = Math.min(4.4, zone.damage + forceScale * 0.16);
  zone.pressure = Math.min(1, zone.pressure + (fromHold ? 0.04 : 0.065) * forceScale);
  zone.mix = 0;
  rebuildAllZoneEdges(zone, seed);
}

function splitShard(
  zone: BreakZone,
  shard: Shard,
  point: Point,
  forceScale: number,
  seed: number,
  impact?: ImpactFootprint,
): Shard[] {
  const area = Math.abs(polygonArea(shard.polygon));
  if (area < 0.0022 || shard.split > 7) return [shard];

  const rng = mulberry32(seed);
  const focus = pointInPolygon(point, shard.polygon) ? point : shard.center;
  const splitCount = Math.min(7, Math.round(2 + forceScale * 1.3 + rng() * 1.8 + shard.split * 0.25));
  const splitPoints = createShardSplitPoints(shard.polygon, focus, splitCount, rng, impact);
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
    created.lift = Math.max(0, created.lift * 0.4 + shard.lift * 0.28 - forceScale * 0.0015);
    created.twist += shard.twist * 0.56;
    created.consumed = Math.min(1, shard.consumed + 0.02);
    pieces.push(created);
  });
  return pieces.length > 1 ? pieces : [shard];
}

function consumeTouchedZone(zone: BreakZone, normal: THREE.Vector3, force: number, amount: number): void {
  const localPoint = surfaceToZonePoint(zone, normal);
  const forceScale = Math.min(2.4, Math.max(0.5, force));
  zone.pressure = Math.min(1, zone.pressure + amount * (3.6 + forceScale * 0.9));
  zone.mix = 0;
  const ooze = 0;

  zone.shards.forEach((shard) => {
    const falloff = Math.max(0, 1 - distance(localPoint, shard.center) / (zone.radius * 0.34));
    if (falloff <= 0) return;
    shard.consumed = Math.min(1, shard.consumed + amount * falloff * (0.18 + forceScale * 0.07 + ooze * 0.8));
    shard.lift = Math.max(0.001, shard.lift - amount * falloff * 0.018);
  });
}

function continueSingleFingerBreak(hit: SurfaceHit, force: number, travel: number, previousHit: SurfaceHit | null): void {
  const touchedZone = findBreakableZone(hit.normal);
  if (touchedZone) {
    consumeTouchedZone(touchedZone, hit.normal, force, 0.006 + Math.min(0.032, travel * 0.0012));
  }

  const now = performance.now();
  if (travel > 2.5 && now - lastStrokeBreakAt > Math.max(36, 104 - force * 20)) {
    if (previousHit) {
      createStrokeSamples(previousHit, hit, travel).forEach((sample, index) => {
        triggerBreak(
          sample,
          Math.max(0.64, force * (0.64 + index * 0.04)),
          true,
          createStrokeFootprint(previousHit, hit, travel, index),
        );
      });
    } else {
      triggerBreak(hit, Math.max(0.68, force * 0.72), true);
    }
    lastStrokeBreakAt = now;
  }
}

function getSurfaceHitAt(clientX: number, clientY: number): SurfaceHit | null {
  const rect = canvas.getBoundingClientRect();
  pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, camera);
  const hit = raycaster.intersectObject(hitMesh, false)[0];
  if (!hit) return null;

  const localPoint = sphereGroup.worldToLocal(hit.point.clone());
  return {
    normal: localPoint.clone().normalize(),
    point: hit.point.clone(),
  };
}

function getSurfaceHit(event: PointerEvent | MouseEvent): SurfaceHit | null {
  return getSurfaceHitAt(event.clientX, event.clientY);
}

function pointerPosition(event: PointerEvent): THREE.Vector2 {
  return new THREE.Vector2(event.clientX, event.clientY);
}

function activePointerCenter(): THREE.Vector2 {
  const center = new THREE.Vector2();
  activePointers.forEach((point) => center.add(point));
  return center.multiplyScalar(1 / Math.max(1, activePointers.size));
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

  if (isDown && activePointers.size === 1 && currentHit) {
    holdDuration += dt;
    const holdForce = Math.min(2.55, inputForce + holdDuration * 0.72);
    const touchedZone = findBreakableZone(currentHit.normal);
    if (touchedZone) {
      consumeTouchedZone(touchedZone, currentHit.normal, holdForce, dt * 0.72);
    }

    const interval = Math.max(86, 260 - holdForce * 58);
    const now = performance.now();
    if (now - lastHoldBreakAt > interval) {
      triggerBreak(currentHit, holdForce, true);
      lastHoldBreakAt = now;
    }
  }

  zones.forEach((zone) => updateZone(zone, dt, elapsed));
  deformSphereSurfaces();
  renderer.render(scene, camera);
  updateCanvasStats();
}

function onPointerDown(event: PointerEvent): void {
  if (event.target === resetButton) return;
  canvas.setPointerCapture(event.pointerId);
  activePointers.set(event.pointerId, pointerPosition(event));
  isDown = true;
  inputForce = pointerForce(event);

  if (activePointers.size === 1) {
    isRotating = false;
    pointerTravel = 0;
    holdDuration = 0;
    spinVelocity.set(0, 0);
    lastPointer.set(event.clientX, event.clientY);
    lastGestureAt = performance.now();
    currentHit = getSurfaceHit(event);
  } else {
    isRotating = true;
    currentHit = null;
    holdDuration = 0;
    pointerTravel = 0;
    lastPointer.copy(activePointerCenter());
    lastGestureAt = performance.now();
    suppressClickUntil = performance.now() + 260;
  }

  if (activePointers.size === 1 && currentHit) {
    triggerBreak(currentHit, inputForce);
    lastHoldBreakAt = performance.now();
    lastStrokeBreakAt = lastHoldBreakAt;
  }
}

function onPointerMove(event: PointerEvent): void {
  if (!activePointers.has(event.pointerId)) return;

  const now = performance.now();
  const previous = activePointers.get(event.pointerId)?.clone() ?? pointerPosition(event);
  const next = pointerPosition(event);
  activePointers.set(event.pointerId, next);
  inputForce = pointerForce(event);

  if (activePointers.size >= 2) {
    const center = activePointerCenter();
    pointerTravel += center.distanceTo(lastPointer);
    isRotating = true;
    currentHit = null;
    rotateFromDrag(lastPointer, center, now - lastGestureAt);
    lastPointer.copy(center);
    lastGestureAt = now;
    suppressClickUntil = now + 260;
    return;
  }

  const travel = next.distanceTo(previous);
  pointerTravel += travel;
  isRotating = false;
  const previousHit = currentHit;
  currentHit = getSurfaceHit(event);
  lastPointer.copy(next);
  lastGestureAt = now;

  if (isDown && currentHit) {
    continueSingleFingerBreak(currentHit, inputForce, travel, previousHit);
  }
}

function onPointerUp(event: PointerEvent): void {
  activePointers.delete(event.pointerId);
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }

  if (activePointers.size >= 2) {
    isDown = true;
    isRotating = true;
    currentHit = null;
    lastPointer.copy(activePointerCenter());
    lastGestureAt = performance.now();
    return;
  }

  if (activePointers.size === 1) {
    const [, remainingPoint] = Array.from(activePointers.entries())[0];
    isDown = true;
    isRotating = false;
    pointerTravel = 0;
    holdDuration = 0;
    lastPointer.copy(remainingPoint);
    currentHit = getSurfaceHitAt(remainingPoint.x, remainingPoint.y);
    lastGestureAt = performance.now();
    return;
  }

  isDown = false;
  if (pointerTravel > 7 || isRotating) suppressClickUntil = performance.now() + 260;
  isRotating = false;
  holdDuration = 0;
  currentHit = null;
}

function onClick(event: MouseEvent): void {
  if (activePointers.size > 0 || performance.now() < suppressClickUntil || performance.now() - lastBreakAt < 120) return;
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

function createStrokeSamples(previousHit: SurfaceHit, hit: SurfaceHit, pixelTravel: number): SurfaceHit[] {
  const count = Math.min(4, Math.max(1, Math.floor(pixelTravel / 14) + 1));
  const samples: SurfaceHit[] = [];

  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 1 : (i + 1) / count;
    const normal = previousHit.normal.clone().lerp(hit.normal, t).normalize();
    samples.push({
      normal,
      point: normal.clone().multiplyScalar(SPHERE_RADIUS),
    });
  }

  return samples;
}

function createStrokeFootprint(
  previousHit: SurfaceHit,
  hit: SurfaceHit,
  pixelTravel: number,
  sampleIndex = 0,
): ImpactFootprint {
  const basis = createBasis(hit.normal);
  const delta = hit.normal.clone().sub(previousHit.normal).multiplyScalar(SPHERE_RADIUS);
  const direction = normalizePoint({
    x: delta.dot(basis.tangent),
    y: delta.dot(basis.bitangent),
  });
  const surfaceTravel = Math.max(0.04, Math.hypot(delta.dot(basis.tangent), delta.dot(basis.bitangent)));
  const jitter = sampleIndex % 2 === 0 ? 0.18 : -0.16;
  return {
    kind: 'stroke',
    direction: rotatePoint(direction, jitter),
    stretch: Math.min(1.55, 0.96 + surfaceTravel * 0.88 + pixelTravel * 0.0028),
    width: Math.max(0.38, 0.56 - Math.min(0.14, surfaceTravel * 0.18)),
  };
}

function deformSphereSurfaces(): void {
  deformSphereGeometry(shellMesh, shellBasePositions, {
    pressStrength: 0.16,
    carveStrength: 1,
    carveDepth: WAX_THICKNESS * 2.55,
  });
  deformSphereGeometry(rubberMesh, rubberBasePositions, {
    pressStrength: 0.32,
    carveStrength: 0.9,
    carveDepth: WAX_THICKNESS * 2.25,
  });
  deformSphereGeometry(coreMesh, coreBasePositions, {
    pressStrength: 0.72,
    carveStrength: 0,
    carveDepth: 0,
  });
}

function deformSphereGeometry(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>,
  basePositions: Float32Array,
  options: SurfaceDeformOptions,
): void {
  const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const array = position.array as Float32Array;
  const normal = new THREE.Vector3();

  for (let i = 0; i < array.length; i += 3) {
    normal.set(basePositions[i], basePositions[i + 1], basePositions[i + 2]);
    const radius = normal.length();
    normal.normalize();

    let pressDepression = 0;
    let carveDepression = 0;
    zones.forEach((zone) => {
      const localPoint = surfaceToZonePoint(zone, normal);
      const localDistance = Math.hypot(localPoint.x, localPoint.y);
      const pressRadius = zone.radius * (1.02 + zone.damage * 0.05);
      if (localDistance <= pressRadius) {
        const falloff = smoothstep(1 - localDistance / pressRadius);
        pressDepression += (
          0.008
          + zone.pressure * 0.09
          + zone.damage * 0.006
        ) * zone.progress * falloff;
      }

      if (options.carveStrength <= 0 || zone.shards.length === 0) return;
      const carveRadius = zone.radius * (1.72 + Math.min(0.18, zone.fractureCount * 0.018));
      if (localDistance > carveRadius) return;

      const footprintMask = shardFootprintMask(zone, localPoint, zone.radius * 0.08);
      if (footprintMask <= 0) return;

      const pressure = smoothstep(zone.pressure);
      const fractureDepth = Math.min(0.032, zone.fractureCount * 0.0038);
      carveDepression += (
        options.carveDepth
        + zone.damage * 0.006
        + pressure * 0.018
        + fractureDepth
      ) * zone.progress * footprintMask;
    });

    const nextRadius = radius
      - pressDepression * options.pressStrength
      - carveDepression * options.carveStrength;
    array[i] = normal.x * nextRadius;
    array[i + 1] = normal.y * nextRadius;
    array[i + 2] = normal.z * nextRadius;
  }

  position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingSphere();
}

function shardFootprintMask(zone: BreakZone, localPoint: Point, softness: number): number {
  let nearestEdge = Infinity;

  for (const shard of zone.shards) {
    if (pointInPolygon(localPoint, shard.polygon)) return 1;
    nearestEdge = Math.min(nearestEdge, polygonEdgeDistance(localPoint, shard.polygon));
  }

  if (!Number.isFinite(nearestEdge)) return 0;
  return smoothstep(1 - nearestEdge / Math.max(softness, EPSILON)) * 0.48;
}

function waxColor(tint: number, consumed: number, mix: number): THREE.Color {
  const target = tint > 0 ? colors.waxLight : colors.waxDark;
  const color = colors.wax.clone().lerp(target, Math.abs(tint) * 0.34);
  return color
    .lerp(colors.waxCut, Math.min(0.2, consumed * 0.1))
    .lerp(colors.waxDark, Math.min(0.12, mix * 0.04));
}

function createImpactPolygon(
  radius: number,
  sides: number,
  rng: () => number,
  footprint: ImpactFootprint,
): Point[] {
  const points: Point[] = [];
  const lean = (rng() - 0.5) * 0.22;
  const direction = normalizePoint(footprint.direction);
  const angleOffset = Math.atan2(direction.y, direction.x);
  const lengthScale = footprint.kind === 'stroke' ? footprint.stretch : 1;
  const widthScale = footprint.kind === 'stroke' ? footprint.width : 0.86 + rng() * 0.12;

  for (let i = 0; i < sides; i += 1) {
    const angle = (i / sides) * Math.PI * 2 + lean * Math.sin(i * 0.7);
    const variance = 0.86 + rng() * 0.18;
    const point = {
      x: Math.cos(angle) * radius * variance,
      y: Math.sin(angle) * radius * variance * (0.82 + rng() * 0.14),
    };
    points.push(rotatePoint({
      x: point.x * lengthScale,
      y: point.y * widthScale,
    }, angleOffset));
  }

  return points;
}

function createImpactPoints(
  radius: number,
  polygon: Point[],
  count: number,
  rng: () => number,
  footprint: ImpactFootprint,
): Point[] {
  const points: Point[] = [{ x: 0, y: 0 }];
  const [minX, minY, maxX, maxY] = boundsFromPolygon(polygon, 0);

  if (footprint.kind === 'stroke') {
    const direction = normalizePoint(footprint.direction);
    const normal = perpendicular(direction);
    const spineCount = 3;
    for (let i = 0; i < spineCount; i += 1) {
      const t = (i / (spineCount - 1) - 0.5) * radius * footprint.stretch * 0.82;
      const jitter = (rng() - 0.5) * radius * footprint.width * 0.52;
      const candidate = {
        x: direction.x * t + normal.x * jitter,
        y: direction.y * t + normal.y * jitter,
      };
      if (pointInPolygon(candidate, polygon)) points.push(candidate);
    }

    for (let i = 0; i < 3; i += 1) {
      const side = i % 2 === 0 ? 1 : -1;
      const branchDirection = rotatePoint(direction, side * (0.75 + rng() * 0.42));
      const candidate = {
        x: branchDirection.x * radius * (0.28 + rng() * 0.36),
        y: branchDirection.y * radius * (0.28 + rng() * 0.36),
      };
      if (pointInPolygon(candidate, polygon)) points.push(candidate);
    }
  }

  let attempts = 0;
  while (points.length < count && attempts < count * 80) {
    attempts += 1;
    const point = {
      x: lerp(minX, maxX, rng()),
      y: lerp(minY, maxY, rng()),
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
  impact?: ImpactFootprint,
): Point[] {
  const center = polygonCentroid(polygon);
  const points: Point[] = [pointInPolygon(focus, polygon) ? focus : center, center];
  const maxRadius = polygon.reduce((max, point) => Math.max(max, distance(focus, point)), 0);
  const [minX, minY, maxX, maxY] = boundsFromPolygon(polygon, 0);

  if (impact?.kind === 'stroke') {
    const direction = normalizePoint(impact.direction);
    const normal = perpendicular(direction);
    const linePoints = Math.min(count - points.length, 3);
    for (let i = 0; i < linePoints; i += 1) {
      const t = (i / Math.max(1, linePoints - 1) - 0.5) * maxRadius * 0.72;
      const jitter = (rng() - 0.5) * maxRadius * 0.36;
      const candidate = {
        x: focus.x + direction.x * t + normal.x * jitter,
        y: focus.y + direction.y * t + normal.y * jitter,
      };
      if (pointInPolygon(candidate, polygon)) points.push(candidate);
    }

    const branchCount = Math.min(count - points.length, 2);
    for (let i = 0; i < branchCount; i += 1) {
      const branchDirection = rotatePoint(direction, (i === 0 ? 1 : -1) * (0.68 + rng() * 0.5));
      const candidate = {
        x: focus.x + branchDirection.x * maxRadius * (0.22 + rng() * 0.34),
        y: focus.y + branchDirection.y * maxRadius * (0.22 + rng() * 0.34),
      };
      if (pointInPolygon(candidate, polygon)) points.push(candidate);
    }
  }

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

function polygonEdgeDistance(point: Point, polygon: Point[]): number {
  let nearest = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    nearest = Math.min(nearest, pointToSegmentDistance(point, polygon[i], polygon[(i + 1) % polygon.length]));
  }
  return nearest;
}

function pointToSegmentDistance(point: Point, a: Point, b: Point): number {
  const segment = sub(b, a);
  const lengthSquared = segment.x * segment.x + segment.y * segment.y;
  if (lengthSquared < EPSILON) return distance(point, a);

  const t = Math.max(0, Math.min(1, (
    (point.x - a.x) * segment.x
    + (point.y - a.y) * segment.y
  ) / lengthSquared));

  return distance(point, {
    x: a.x + segment.x * t,
    y: a.y + segment.y * t,
  });
}

function ensureAudioContext(): AudioContext | null {
  audioContext ??= new AudioContext();
  if (audioContext.state === 'suspended') {
    void audioContext.resume();
  }
  return audioContext;
}

function playCrack(force: number, density = 1): void {
  const context = ensureAudioContext();
  if (!context) return;

  const now = context.currentTime + 0.004;
  const master = context.createGain();
  master.gain.setValueAtTime(Math.min(0.34, 0.12 + force * 0.075), now);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  master.connect(context.destination);

  const burstCount = Math.max(4, Math.round(4 + force * 2.2 + density * 2));
  for (let i = 0; i < burstCount; i += 1) {
    const start = now + i * (0.009 + noise(zoneId * 97 + i) * 0.012);
    const duration = 0.026 + noise(zoneId * 131 + i) * 0.035;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();

    source.buffer = createCrackleBuffer(context, duration, zoneId * 199 + i * 37);
    filter.type = i % 3 === 0 ? 'bandpass' : 'highpass';
    filter.frequency.setValueAtTime(1900 + noise(zoneId * 17 + i) * 5200, start);
    filter.Q.value = 0.7 + noise(zoneId * 23 + i) * 4.2;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime((0.05 + noise(zoneId * 29 + i) * 0.07) * force, start + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(start);
    source.stop(start + duration + 0.01);
  }

  const click = context.createOscillator();
  const clickGain = context.createGain();
  const clickFilter = context.createBiquadFilter();
  click.type = 'square';
  click.frequency.setValueAtTime(2600 + noise(zoneId * 43) * 2300, now);
  click.frequency.exponentialRampToValueAtTime(620 + noise(zoneId * 47) * 260, now + 0.045);
  clickFilter.type = 'highpass';
  clickFilter.frequency.value = 1300;
  clickGain.gain.setValueAtTime(0.0001, now);
  clickGain.gain.exponentialRampToValueAtTime(0.08 * force, now + 0.004);
  clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.062);
  click.connect(clickFilter);
  clickFilter.connect(clickGain);
  clickGain.connect(master);
  click.start(now);
  click.stop(now + 0.07);

  const thump = context.createOscillator();
  const thumpGain = context.createGain();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(116 + force * 18, now);
  thump.frequency.exponentialRampToValueAtTime(52, now + 0.09);
  thumpGain.gain.setValueAtTime(0.0001, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.035 * force, now + 0.012);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
  thump.connect(thumpGain);
  thumpGain.connect(master);
  thump.start(now);
  thump.stop(now + 0.14);
}

function createCrackleBuffer(context: AudioContext, duration: number, seed: number): AudioBuffer {
  const length = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  const rng = mulberry32(seed);
  let snap = 0;

  for (let i = 0; i < length; i += 1) {
    const t = i / Math.max(1, length - 1);
    const envelope = Math.pow(1 - t, 2.7);
    const grain = rng() < 0.18 ? (rng() * 2 - 1) * 1.8 : rng() * 2 - 1;
    snap = snap * 0.34 + grain * 0.66;
    data[i] = snap * envelope;
  }

  return buffer;
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

function normalizePoint(point: Point): Point {
  const length = Math.hypot(point.x, point.y);
  if (length < EPSILON) return { x: 1, y: 0 };
  return { x: point.x / length, y: point.y / length };
}

function perpendicular(point: Point): Point {
  return { x: -point.y, y: point.x };
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

function strokeDistance(focus: Point, point: Point, impact: ImpactFootprint, length: number): number {
  const direction = normalizePoint(impact.direction);
  const normal = perpendicular(direction);
  const delta = sub(point, focus);
  const along = Math.abs(delta.x * direction.x + delta.y * direction.y);
  const across = Math.abs(delta.x * normal.x + delta.y * normal.y);
  return across + Math.max(0, along - length) * 0.35;
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
