import { Delaunay } from 'd3-delaunay';
import GUI from 'lil-gui';
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
  settle: number;
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
  progress: number;
  fractureCount: number;
  group: THREE.Group;
  shardGroup: THREE.Group;
  gelMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  shards: Shard[];
  edges: CrackEdge[];
  outline: Point[][];
};

type SurfaceHit = {
  normal: THREE.Vector3;
  point: THREE.Vector3;
};

type SurfaceDeformOptions = {
  carveStrength: number;
  carveDepth: number;
};

type PendingTouchBreak = {
  pointerId: number;
  hit: SurfaceHit;
  force: number;
  timeoutId: number;
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

type CrackSamplePreset = {
  label: string;
  paths: string[];
};

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const resetButton = document.querySelector('.reset-button') as HTMLButtonElement;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const EPSILON = 0.0001;
const SPHERE_RADIUS = 2.24;
const CORE_RADIUS = SPHERE_RADIUS * 0.93;
const WAX_THICKNESS = 0.026;
const CORE_EXPOSURE_DEPTH = SPHERE_RADIUS - CORE_RADIUS + WAX_THICKNESS * 0.8;
const ZONE_BACKFACE_DOT = 0.12;
const SHARD_SETTLE_SPEED = 2.4;
const TOUCH_BREAK_DELAY_MS = 180;
const DEFAULT_MIN_VISIBLE_SHARD_AREA = 0.01;
const BASE_MAX_SHARDS_PER_ZONE = 52;
const LOCAL_CRACK_SAMPLE_LABEL = '업로드한 소리';
const CRACK_SAMPLE_PRESETS: CrackSamplePreset[] = [
  {
    label: LOCAL_CRACK_SAMPLE_LABEL,
    paths: [],
  },
  {
    label: 'Wax Ball Crunchy',
    paths: [
      'assets/wakppu-crack-crunchy.mp3',
      'assets/wakppu-crack-crunchy.m4a',
      'assets/wakppu-crack-crunchy.wav',
    ],
  },
  {
    label: 'Wax Ball Relaxation',
    paths: [
      'assets/wakppu-crack-relaxation.mp3',
      'assets/wakppu-crack-relaxation.m4a',
      'assets/wakppu-crack-relaxation.wav',
    ],
  },
  {
    label: 'Wax Cracking Compilation',
    paths: [
      'assets/wakppu-crack-compilation.mp3',
      'assets/wakppu-crack-compilation.m4a',
      'assets/wakppu-crack-compilation.wav',
    ],
  },
];

const colors = {
  wax: new THREE.Color('#000000'),
  waxLight: new THREE.Color('#333333'),
  waxDark: new THREE.Color('#000000'),
  waxCut: new THREE.Color('#111111'),
  core: new THREE.Color('#fcfcf8'),
  coreDeep: new THREE.Color('#dce1db'),
  gel: new THREE.Color('#ffffff'),
  rubber: new THREE.Color('#dff8f5'),
  background: new THREE.Color('#1b0000'),
};

const fractureTuning = {
  shardCount: 0.7,
  crackRange: 1,
  shardCullArea: DEFAULT_MIN_VISIBLE_SHARD_AREA,
  waxColor: '#000000',
  contentColor: '#fcfcf8',
  backgroundColor: '#1b0000',
  audioSample: 'Wax Ball Crunchy',
  audioVolume: 1,
  loadAudio: () => openCrackSamplePicker(),
  reset: () => resetArtwork(),
};

let audioSampleController: { updateDisplay: () => void } | null = null;

const gui = new GUI({ title: 'Wakppu tuning' });
const fractureFolder = gui.addFolder('Fracture');
fractureFolder.add(fractureTuning, 'shardCount', 0.35, 2.2, 0.01).name('조각 수');
fractureFolder.add(fractureTuning, 'crackRange', 0.55, 2.25, 0.01).name('크랙 범위');
fractureFolder.add(fractureTuning, 'shardCullArea', 0.0015, 0.018, 0.0001).name('사라짐 기준');
fractureFolder.add(fractureTuning, 'reset').name('크랙 리셋');
const colorFolder = gui.addFolder('Color');
colorFolder.addColor(fractureTuning, 'waxColor').name('왁스 색').onChange(applyTuningColors);
colorFolder.addColor(fractureTuning, 'contentColor').name('내용물 색').onChange(applyTuningColors);
colorFolder.addColor(fractureTuning, 'backgroundColor').name('배경 색').onChange(applyTuningColors);
const audioFolder = gui.addFolder('Audio');
audioSampleController = audioFolder
  .add(fractureTuning, 'audioSample', CRACK_SAMPLE_PRESETS.map((preset) => preset.label))
  .name('소리 샘플')
  .onChange(resetCrackSamples);
audioFolder.add(fractureTuning, 'audioVolume', 0, 1.5, 0.01).name('소리 볼륨');
audioFolder.add(fractureTuning, 'loadAudio').name('로컬 소리 선택');

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
  depthTest: true,
  depthWrite: false,
});

let floorMaterial: THREE.MeshBasicMaterial | null = null;

function applyTuningColors(): void {
  colors.wax.set(fractureTuning.waxColor);
  colors.waxLight.copy(colors.wax).offsetHSL(0, -0.06, 0.2);
  colors.waxDark.copy(colors.wax).offsetHSL(0, 0.08, -0.28);
  colors.waxCut.copy(colors.wax).offsetHSL(0, -0.03, -0.12);
  colors.core.set(fractureTuning.contentColor);
  colors.coreDeep.copy(colors.core).offsetHSL(0, -0.04, -0.16);
  colors.gel.copy(colors.core);
  colors.background.set(fractureTuning.backgroundColor);

  waxMaterial.color.copy(colors.wax);
  coreMaterial.color.copy(colors.core);
  gelMaterial.color.copy(colors.core);
  scene.background = colors.background;

  if (floorMaterial) {
    floorMaterial.color.copy(colors.background).lerp(new THREE.Color(0x000000), 0.42);
  }
}

applyTuningColors();

const coreMesh = new THREE.Mesh(
  new THREE.SphereGeometry(CORE_RADIUS, 96, 48),
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

floorMaterial = new THREE.MeshBasicMaterial({
  color: 0x0b0709,
  transparent: true,
  opacity: 0.42,
  depthWrite: false,
});
const floor = new THREE.Mesh(new THREE.CircleGeometry(3.3, 96), floorMaterial);
floor.rotation.x = -Math.PI / 2;
floor.position.set(0, -SPHERE_RADIUS * 1.08, -0.55);
floor.scale.set(1.25, 0.22, 1);
scene.add(floor);
applyTuningColors();

const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const clock = new THREE.Clock();

let width = 1;
let height = 1;
const activePointers = new Map<number, THREE.Vector2>();
let isDown = false;
let isRotating = false;
let multiTouchGestureActive = false;
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
let pendingTouchBreak: PendingTouchBreak | null = null;
let zoneId = 1;
let zones: BreakZone[] = [];
let audioContext: AudioContext | null = null;
let crackSamplePromise: Promise<void> | null = null;
const crackSampleBuffers: AudioBuffer[] = [];
const uploadedCrackSampleBuffers: AudioBuffer[] = [];
let crackSampleKey = '';
let crackFileInput: HTMLInputElement | null = null;
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
  cancelPendingTouchBreak();
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
  multiTouchGestureActive = false;
  suppressClickUntil = 0;
  spinVelocity.set(0, 0);
  sphereGroup.quaternion.identity();
}

function removeZone(zone: BreakZone): void {
  const index = zones.indexOf(zone);
  if (index >= 0) zones.splice(index, 1);
  sphereGroup.remove(zone.group);
  disposeObject3D(zone.group);
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

function shardArea(shard: Shard): number {
  return Math.abs(polygonArea(shard.polygon));
}

function minVisibleShardArea(): number {
  return Math.max(0.0004, fractureTuning.shardCullArea);
}

function shouldCullPolygon(polygon: Point[], minArea = minVisibleShardArea()): boolean {
  const { area, apparentWidth, compactness } = polygonShapeMetrics(polygon);
  if (area < minArea) return true;

  const fineSliver = area < minArea * 18 && (apparentWidth < 0.022 || compactness < 0.038);
  const awkwardFragment = area < minArea * 6.6 && (apparentWidth < 0.038 || compactness < 0.085);
  return fineSliver || awkwardFragment;
}

function shouldCullShard(shard: Shard): boolean {
  return shouldCullPolygon(shard.polygon);
}

function shouldCullDirectHitShard(shard: Shard): boolean {
  const { area, apparentWidth, compactness } = polygonShapeMetrics(shard.polygon);
  const minArea = minVisibleShardArea();
  if (area < minArea * 1.8) return true;

  return area < minArea * 12 && (shard.split > 3 || apparentWidth < 0.06 || compactness < 0.14);
}

function disposeShard(zone: BreakZone, shard: Shard): void {
  zone.shardGroup.remove(shard.mesh);
  shard.mesh.geometry.dispose();
  disposeMaterial(shard.mesh.material);
}

function refreshZoneOutline(zone: BreakZone): void {
  zone.outline = zone.shards.map((shard) => clonePolygon(shard.polygon));
}

function cleanupZoneArtifacts(zone: BreakZone): boolean {
  const before = zone.shards.length;
  const survivors: Shard[] = [];

  zone.shards.forEach((shard) => {
    if (shouldCullOverworkedShard(zone, shard)) {
      disposeShard(zone, shard);
    } else {
      survivors.push(shard);
    }
  });

  const maxShards = maxShardsPerZone();
  if (survivors.length > maxShards) {
    const ranked = survivors
      .map((shard) => ({ shard, score: shardArtifactScore(shard) }))
      .sort((a, b) => b.score - a.score);
    const dropSet = new Set(ranked.slice(0, survivors.length - maxShards).map((item) => item.shard));
    zone.shards = survivors.filter((shard) => {
      if (!dropSet.has(shard)) return true;
      disposeShard(zone, shard);
      return false;
    });
  } else {
    zone.shards = survivors;
  }

  return zone.shards.length !== before;
}

function shouldCullOverworkedShard(zone: BreakZone, shard: Shard): boolean {
  const { area, apparentWidth, compactness } = polygonShapeMetrics(shard.polygon);
  const minArea = minVisibleShardArea();
  const pressure = Math.max(0, zone.fractureCount - 3);
  const crowded = zone.shards.length > maxShardsPerZone() * 0.78;

  if (shard.split > 6 && (area < minArea * 22 || compactness < 0.18 || apparentWidth < 0.08)) return true;
  if (pressure > 0 && area < minArea * (7 + pressure * 2.6) && (compactness < 0.13 || apparentWidth < 0.062)) return true;
  if (crowded && area < minArea * 12 && (compactness < 0.16 || apparentWidth < 0.072 || shard.split > 4)) return true;
  return false;
}

function shouldCullTouchedShard(zone: BreakZone, shard: Shard, localPoint: Point, forceScale: number): boolean {
  const hitDistance = shardHitDistance(zone, shard, localPoint);
  if (hitDistance > zone.radius * (0.13 + forceScale * 0.025)) return false;
  if (shouldCullOverworkedShard(zone, shard)) return true;

  const { area, apparentWidth, compactness } = polygonShapeMetrics(shard.polygon);
  const minArea = minVisibleShardArea();
  return area < minArea * (10 + forceScale * 3)
    && (shard.split > 3 || apparentWidth < 0.07 || compactness < 0.16);
}

function cleanupTouchedArtifacts(zone: BreakZone, localPoint: Point, forceScale: number): boolean {
  const before = zone.shards.length;
  const survivors: Shard[] = [];

  zone.shards.forEach((shard) => {
    if (shouldCullTouchedShard(zone, shard, localPoint, forceScale)) {
      disposeShard(zone, shard);
    } else {
      survivors.push(shard);
    }
  });

  zone.shards = survivors;
  return zone.shards.length !== before;
}

function shardArtifactScore(shard: Shard): number {
  const { area, apparentWidth, compactness } = polygonShapeMetrics(shard.polygon);
  const minArea = minVisibleShardArea();
  return (
    (minArea * 10) / Math.max(area, EPSILON)
    + 0.08 / Math.max(apparentWidth, EPSILON)
    + 0.2 / Math.max(compactness, EPSILON)
    + shard.split * 0.42
  );
}

function maxShardsPerZone(): number {
  return Math.round(BASE_MAX_SHARDS_PER_ZONE * Math.max(0.75, fractureTuning.shardCount));
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
  const isStroke = footprint.kind === 'stroke';
  const shardScale = Math.max(0.35, fractureTuning.shardCount);
  const rangeScale = Math.max(0.55, fractureTuning.crackRange);
  const radiusBase = isStroke ? 0.34 + rng() * 0.08 : 0.58 + rng() * 0.15;
  const radius = radiusBase * (isStroke ? 0.98 + forceScale * 0.12 : 0.96 + forceScale * 0.1) * rangeScale;
  const impactPolygon = createImpactPolygon(radius, 13 + Math.floor(rng() * 5), rng, footprint);
  const minShardArea = minVisibleShardArea();
  const baseCellMinArea = isStroke
    ? Math.max(0.012, radius * radius * 0.047)
    : Math.max(minShardArea, radius * radius * 0.022);
  const cellMinArea = baseCellMinArea / shardScale;
  const basePointCount = (isStroke ? 6 : 8.5) + forceScale * (isStroke ? 1.25 : 1.8) + rng() * (isStroke ? 1.2 : 2);
  const points = createImpactPoints(
    radius,
    impactPolygon,
    Math.max(isStroke ? 4 : 7, Math.round(basePointCount * shardScale)),
    rng,
    footprint,
  );
  const cells = createVoronoiCells(points, impactPolygon, boundsFromPolygon(impactPolygon, radius * 0.55), cellMinArea);
  const availableCells: Point[][] = [];
  const overlapHits: OverlapHit[] = [];

  cells.forEach((cell) => {
    const overlap = findOverlappingBreakCell(normal, basis.tangent, basis.bitangent, cell);
    if (overlap) overlapHits.push(overlap);
    availableCells.push(...subtractExistingOutlinesFromCell(normal, basis.tangent, basis.bitangent, cell));
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
    progress: 0,
    fractureCount: 0,
    group,
    shardGroup,
    gelMesh,
    shards: [],
    edges: [],
    outline: availableCells.map((cell) => clonePolygon(cell)),
  };

  const baseShardMinArea = isStroke
    ? Math.max(0.011, radius * radius * 0.04)
    : Math.max(minShardArea * 1.08, radius * radius * 0.018);
  const shardMinArea = baseShardMinArea / shardScale;
  availableCells.forEach((cell, index) => {
    addShard(zone, cell, edgeMap, seed + index * 41, 0, shardMinArea);
  });
  refreshZoneOutline(zone);

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

      const overlap = zoneOutlineMask(zone, localPoint, zone.radius * 0.05);
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

function subtractExistingOutlinesFromCell(
  normal: THREE.Vector3,
  tangent: THREE.Vector3,
  bitangent: THREE.Vector3,
  cell: Point[],
): Point[][] {
  const minArea = Math.max(0.0009, Math.abs(polygonArea(cell)) * 0.08);
  let pieces = [cell];

  zones.forEach((zone) => {
    if (normal.dot(zone.normal) < 0.68 || zone.outline.length === 0 || pieces.length === 0) return;

    const nextPieces: Point[][] = [];
    pieces.forEach((piece) => {
      const zonePieces = subtractZoneOutlinesFromCell(normal, tangent, bitangent, piece, zone)
        .filter((candidate) => candidate.length >= 3 && Math.abs(polygonArea(candidate)) > minArea);
      nextPieces.push(...zonePieces);
    });
    pieces = nextPieces;
  });

  return pieces.filter((piece) => piece.length >= 3 && Math.abs(polygonArea(piece)) > minArea);
}

function subtractZoneOutlinesFromCell(
  normal: THREE.Vector3,
  tangent: THREE.Vector3,
  bitangent: THREE.Vector3,
  cell: Point[],
  zone: BreakZone,
): Point[][] {
  let zonePieces = [cell.map((point) => basisPointToZonePoint(normal, tangent, bitangent, point, zone))];
  let clipped = false;

  zone.outline.forEach((outline) => {
    const nextPieces: Point[][] = [];
    zonePieces.forEach((piece) => {
      if (polygonsIntersect(piece, outline)) {
        clipped = true;
        nextPieces.push(...subtractConvexPolygon(piece, outline));
      } else {
        nextPieces.push(piece);
      }
    });
    zonePieces = nextPieces;
  });

  if (!clipped) return [cell];

  return zonePieces.map((piece) => (
    piece.map((point) => zonePointToBasisPoint(point, zone, normal, tangent, bitangent))
  ));
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

function basisPointToZonePoint(
  normal: THREE.Vector3,
  tangent: THREE.Vector3,
  bitangent: THREE.Vector3,
  point: Point,
  zone: BreakZone,
): Point {
  return surfaceToZonePoint(zone, tangentBasisPointToNormal(normal, tangent, bitangent, point));
}

function zonePointToBasisPoint(
  point: Point,
  zone: BreakZone,
  normal: THREE.Vector3,
  tangent: THREE.Vector3,
  bitangent: THREE.Vector3,
): Point {
  const sampleNormal = tangentBasisPointToNormal(zone.normal, zone.tangent, zone.bitangent, point);
  const delta = sampleNormal.multiplyScalar(SPHERE_RADIUS)
    .sub(normal.clone().normalize().multiplyScalar(SPHERE_RADIUS));
  return {
    x: delta.dot(tangent),
    y: delta.dot(bitangent),
  };
}

function addShard(
  zone: BreakZone,
  polygon: Point[],
  edgeMap: Map<string, CrackEdge & { count: number }>,
  seed: number,
  split = 0,
  minArea = 0.0035,
): void {
  if (shouldCullPolygon(polygon, Math.max(minArea, minVisibleShardArea()))) return;

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
    settle: 0,
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

  zone.shards.forEach((shard) => {
    shard.settle = Math.min(1, shard.settle + dt * SHARD_SETTLE_SPEED);
    updateShardMesh(zone, shard, progress, elapsed);
  });

  updateGelMesh(zone, progress);
}

function updateShardMesh(
  zone: BreakZone,
  shard: Shard,
  progress: number,
  elapsed: number,
): void {
  const points = [shard.center, ...shard.polygon];
  const positions: number[] = [];
  const indices: number[] = [];
  const consumed = smoothstep(shard.consumed);
  const wobbleFade = 1 - smoothstep(shard.settle);
  const wobble = reducedMotion ? 0 : Math.sin(elapsed * 4.3 + shard.phase) * 0.0009 * shard.split * wobbleFade;
  const topOffsets: number[] = [];
  const rotatedPoints: Point[] = [];
  const shardDistance = Math.hypot(shard.center.x, shard.center.y);
  const shardDirection = shardDistance > EPSILON
    ? { x: shard.center.x / shardDistance, y: shard.center.y / shardDistance }
    : { x: Math.cos(shard.phase), y: Math.sin(shard.phase) };
  const splitProgress = progress * 0.68;
  const gap = splitProgress * (0.028 + zone.fractureCount * 0.006) * (1 - consumed * 0.15);
  const inset = Math.min(0.16, splitProgress * (0.048 + zone.fractureCount * 0.006));
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
    ) * splitProgress * 0.026;
    const lift = Math.max(-0.002, surfaceLift + tilt + wobble);
    rotatedPoints.push(separated);
    topOffsets.push(lift);
    const surfacePoint = tangentToSurface(zone, separated, lift);
    positions.push(surfacePoint.x, surfacePoint.y, surfacePoint.z);
  });

  points.forEach((_, index) => {
    const bottomOffset = topOffsets[index] - WAX_THICKNESS * (0.95 + progress * 0.38);
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

  const color = waxColor(shard.tint, consumed);
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
  const positions: number[] = [];
  const indices: number[] = [];
  const bedOffset = CORE_RADIUS - SPHERE_RADIUS - WAX_THICKNESS * 0.12;

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
  zone.gelMesh.material.depthTest = true;
  zone.gelMesh.material.depthWrite = false;
  zone.gelMesh.material.color.copy(colors.core).lerp(colors.coreDeep, 0.12);
  zone.gelMesh.material.opacity = Math.min(0.94, 0.82 * progress);
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
  let nearestScore = Infinity;

  zones.forEach((zone) => {
    const surfaceDistance = zoneSurfaceDistance(zone, normal);
    if (surfaceDistance > zone.radius * 1.28) return;

    const localPoint = surfaceToZonePoint(zone, normal);
    const shardDistance = zoneShardHitDistance(zone, localPoint);
    const score = shardDistance < zone.radius * 0.13
      ? shardDistance - zone.radius * 0.24
      : surfaceDistance;

    if (score < nearestScore && (surfaceDistance < zone.radius * 1.04 || shardDistance < zone.radius * 0.13)) {
      nearest = zone;
      nearestScore = score;
    }
  });

  return nearest;
}

function shouldCreateTrailZone(zone: BreakZone, normal: THREE.Vector3, impact: ImpactFootprint): boolean {
  const localPoint = surfaceToZonePoint(zone, normal);
  const localDistance = zoneSurfaceDistance(zone, normal);
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
  if (!zones.includes(zone)) return;
  if (!Number.isFinite(zoneSurfaceDistance(zone, normal))) return;

  const localPoint = surfaceToZonePoint(zone, normal);
  const forceScale = Math.min(2.6, Math.max(0.5, force));
  const seed = zone.seed + zone.fractureCount * 4099 + Math.floor(performance.now());
  const isStroke = impact?.kind === 'stroke';
  const shardScale = Math.max(0.35, fractureTuning.shardCount);
  const rangeScale = Math.max(0.55, fractureTuning.crackRange);
  const breakRadius = zone.radius * (
    isStroke
      ? 0.28 + forceScale * 0.08
      : 0.2 + forceScale * 0.06
  ) * rangeScale;
  const directHitRadius = zone.radius * (isStroke ? 0.08 : 0.12);
  const candidates = zone.shards
    .map((shard, index) => {
      const hitDistance = shardHitDistance(zone, shard, localPoint);
      const centerDistance = impact?.kind === 'stroke'
        ? strokeDistance(localPoint, shard.center, impact, breakRadius * impact.stretch)
        : distance(localPoint, shard.center);
      return {
        shard,
        index,
        contains: hitDistance <= EPSILON,
        distance: Math.min(hitDistance, centerDistance),
        hitDistance,
      };
    })
    .filter((candidate) => (
      candidate.contains
      || candidate.hitDistance < directHitRadius
      || candidate.distance < breakRadius * (1 + candidate.shard.consumed * 0.35)
    ))
    .sort((a, b) => {
      if (a.contains !== b.contains) return a.contains ? -1 : 1;
      if (Math.abs(a.hitDistance - b.hitDistance) > EPSILON) return a.hitDistance - b.hitDistance;
      return a.distance - b.distance;
    });

  if (candidates.length === 0) return;

  const selectionBase = isStroke ? 1.8 : fromHold ? 1 : 1.35;
  const selectionForce = isStroke ? 0.95 : 0.75;
  const selectedCount = Math.min(
    candidates.length,
    Math.max(1, Math.round((selectionBase + forceScale * selectionForce) * shardScale)),
  );
  const selectedCandidates = new Map(candidates.slice(0, selectedCount).map((candidate) => [candidate.index, candidate]));
  const nextShards: Shard[] = [];

  zone.shards.forEach((shard, index) => {
    if (shouldCullShard(shard)) {
      disposeShard(zone, shard);
      return;
    }

    const selectedCandidate = selectedCandidates.get(index);
    if (!selectedCandidate) {
      nextShards.push(shard);
      return;
    }

    if (selectedCandidate.hitDistance < directHitRadius * 0.72 && shouldCullDirectHitShard(shard)) {
      disposeShard(zone, shard);
      return;
    }

    const pieces = splitShard(zone, shard, localPoint, forceScale, seed + index * 83, impact);
    if (pieces.length > 1) {
      disposeShard(zone, shard);
      nextShards.push(...pieces);
    } else if (pieces.length === 0) {
      disposeShard(zone, shard);
    } else {
      shard.lift = Math.max(0, shard.lift - forceScale * 0.002);
      shard.twist += (noise(seed + index) - 0.5) * 0.04;
      nextShards.push(shard);
    }
  });

  zone.shards = nextShards;
  if (zone.shards.length === 0) {
    removeZone(zone);
    return;
  }

  zone.fractureCount += 1;
  zone.damage = Math.min(4.4, zone.damage + forceScale * 0.16);
  cleanupZoneArtifacts(zone);
  if (zone.shards.length === 0) {
    removeZone(zone);
    return;
  }

  refreshZoneOutline(zone);
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
  if (area < minVisibleShardArea()) return [];
  if (shouldCullOverworkedShard(zone, shard)) return [];
  if (shard.split > 7) return area < minVisibleShardArea() * 28 ? [] : [shard];

  const rng = mulberry32(seed);
  const focus = pointInPolygon(point, shard.polygon) ? point : shard.center;
  const isStroke = impact?.kind === 'stroke';
  const shardScale = Math.max(0.35, fractureTuning.shardCount);
  const splitLimit = Math.max(isStroke ? 2 : 3, Math.round((isStroke ? 4 : 7) * shardScale));
  const baseSplitCount = isStroke
    ? Math.min(4, Math.round(2 + forceScale * 0.72 + rng() * 0.95 + shard.split * 0.08))
    : Math.min(7, Math.round(2 + forceScale * 1.3 + rng() * 1.8 + shard.split * 0.25));
  const splitCount = Math.max(2, Math.min(splitLimit, Math.round(baseSplitCount * shardScale)));
  const splitPoints = createShardSplitPoints(shard.polygon, focus, splitCount, rng, impact);
  const baseCellMinArea = isStroke ? Math.max(0.0024, area / (splitCount * 5.8)) : Math.max(0.0009, area / (splitCount * 12));
  const cellMinArea = baseCellMinArea / shardScale;
  const cells = createVoronoiCells(
    splitPoints,
    shard.polygon,
    boundsFromPolygon(shard.polygon, 0.08),
    cellMinArea,
  );
  if (cells.length < 2) return [shard];

  const edgeMap = new Map<string, CrackEdge & { count: number }>();
  const pieces: Shard[] = [];
  cells.forEach((cell, index) => {
    const before = zone.shards.length;
    addShard(
      zone,
      cell,
      edgeMap,
      seed + index * 53,
      shard.split + 1,
      (isStroke ? Math.max(0.0022, area / (splitCount * 7)) : Math.max(0.0008, area / (splitCount * 16))) / shardScale,
    );
    if (zone.shards.length === before) return;
    const created = zone.shards.pop();
    if (!created || zone.shards.length !== before) return;
    created.tint = created.tint * 0.62 + shard.tint * 0.38;
    created.lift = Math.max(0, created.lift * 0.4 + shard.lift * 0.28 - forceScale * 0.0015);
    created.twist += shard.twist * 0.56;
    created.consumed = Math.min(1, shard.consumed + 0.02);
    pieces.push(created);
  });
  if (pieces.length > 1) return pieces;
  pieces.forEach((piece) => disposeShard(zone, piece));
  return [shard];
}

function consumeTouchedZone(zone: BreakZone, normal: THREE.Vector3, force: number, amount: number): void {
  if (!zones.includes(zone)) return;
  if (!Number.isFinite(zoneSurfaceDistance(zone, normal))) return;

  const localPoint = surfaceToZonePoint(zone, normal);
  const forceScale = Math.min(2.4, Math.max(0.5, force));

  zone.shards.forEach((shard) => {
    const falloff = Math.max(0, 1 - distance(localPoint, shard.center) / (zone.radius * 0.34));
    if (falloff <= 0) return;
    shard.consumed = Math.min(1, shard.consumed + amount * falloff * (0.18 + forceScale * 0.07));
    shard.lift = Math.max(0.001, shard.lift - amount * falloff * 0.018);
  });

  if (!cleanupTouchedArtifacts(zone, localPoint, forceScale)) return;
  if (zone.shards.length === 0) {
    removeZone(zone);
    return;
  }

  refreshZoneOutline(zone);
  rebuildAllZoneEdges(zone, zone.seed + zone.fractureCount * 701 + Math.floor(performance.now()));
}

function continueSingleFingerBreak(hit: SurfaceHit, force: number, travel: number, previousHit: SurfaceHit | null): void {
  const touchedZone = findBreakableZone(hit.normal);
  if (touchedZone) {
    consumeTouchedZone(touchedZone, hit.normal, force, 0.006 + Math.min(0.032, travel * 0.0012));
  }

  const now = performance.now();
  if (travel > 4.5 && now - lastStrokeBreakAt > Math.max(54, 138 - force * 24)) {
    if (previousHit) {
      createStrokeSamples(previousHit, hit, travel).forEach((sample, index) => {
        triggerBreak(
          sample,
          Math.max(0.76, force * (0.76 + index * 0.05)),
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

function cancelPendingTouchBreak(): void {
  if (!pendingTouchBreak) return;
  window.clearTimeout(pendingTouchBreak.timeoutId);
  pendingTouchBreak = null;
}

function completePendingTouchBreak(pointerId?: number): boolean {
  if (!pendingTouchBreak) return false;
  if (pointerId !== undefined && pendingTouchBreak.pointerId !== pointerId) return false;

  const pending = pendingTouchBreak;
  cancelPendingTouchBreak();
  triggerBreak(pending.hit, pending.force);
  lastHoldBreakAt = performance.now();
  lastStrokeBreakAt = lastHoldBreakAt;
  return true;
}

function queuePendingTouchBreak(pointerId: number, hit: SurfaceHit, force: number): void {
  cancelPendingTouchBreak();
  const timeoutId = window.setTimeout(() => {
    if (!pendingTouchBreak || pendingTouchBreak.pointerId !== pointerId) return;
    if (!isDown || isRotating || activePointers.size !== 1 || !activePointers.has(pointerId)) {
      cancelPendingTouchBreak();
      return;
    }
    completePendingTouchBreak(pointerId);
  }, TOUCH_BREAK_DELAY_MS);

  pendingTouchBreak = {
    pointerId,
    hit,
    force,
    timeoutId,
  };
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

  if (
    isDown
    && activePointers.size === 1
    && currentHit
    && !pendingTouchBreak
    && !multiTouchGestureActive
  ) {
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
    multiTouchGestureActive = false;
    pointerTravel = 0;
    holdDuration = 0;
    spinVelocity.set(0, 0);
    lastPointer.set(event.clientX, event.clientY);
    lastGestureAt = performance.now();
    currentHit = getSurfaceHit(event);
  } else {
    cancelPendingTouchBreak();
    isRotating = true;
    multiTouchGestureActive = true;
    currentHit = null;
    holdDuration = 0;
    pointerTravel = 0;
    lastPointer.copy(activePointerCenter());
    lastGestureAt = performance.now();
    suppressClickUntil = performance.now() + 260;
  }

  if (activePointers.size === 1 && currentHit) {
    if (event.pointerType === 'touch') {
      queuePendingTouchBreak(event.pointerId, currentHit, inputForce);
    } else {
      triggerBreak(currentHit, inputForce);
      lastHoldBreakAt = performance.now();
      lastStrokeBreakAt = lastHoldBreakAt;
    }
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
    cancelPendingTouchBreak();
    multiTouchGestureActive = true;
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

  if (multiTouchGestureActive) {
    isRotating = true;
    currentHit = null;
    lastPointer.copy(next);
    lastGestureAt = now;
    suppressClickUntil = now + 260;
    return;
  }

  isRotating = false;
  const previousHit = currentHit;
  currentHit = getSurfaceHit(event);
  lastPointer.copy(next);
  lastGestureAt = now;

  if (pendingTouchBreak?.pointerId === event.pointerId) {
    if (currentHit) {
      pendingTouchBreak.hit = currentHit;
      pendingTouchBreak.force = inputForce;
    }
    return;
  }

  if (isDown && currentHit) {
    continueSingleFingerBreak(currentHit, inputForce, travel, previousHit);
  }
}

function onPointerUp(event: PointerEvent): void {
  if (pendingTouchBreak?.pointerId === event.pointerId) {
    if (!isRotating && pointerTravel <= 7) {
      completePendingTouchBreak(event.pointerId);
    } else {
      cancelPendingTouchBreak();
    }
  }

  activePointers.delete(event.pointerId);
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }

  if (activePointers.size >= 2) {
    cancelPendingTouchBreak();
    isDown = true;
    isRotating = true;
    multiTouchGestureActive = true;
    currentHit = null;
    lastPointer.copy(activePointerCenter());
    lastGestureAt = performance.now();
    return;
  }

  if (activePointers.size === 1) {
    cancelPendingTouchBreak();
    const [, remainingPoint] = Array.from(activePointers.entries())[0];
    isDown = true;
    if (multiTouchGestureActive) {
      isRotating = true;
      holdDuration = 0;
      lastPointer.copy(remainingPoint);
      currentHit = null;
      lastGestureAt = performance.now();
      suppressClickUntil = performance.now() + 260;
      return;
    }
    isRotating = false;
    pointerTravel = 0;
    holdDuration = 0;
    lastPointer.copy(remainingPoint);
    currentHit = getSurfaceHitAt(remainingPoint.x, remainingPoint.y);
    lastGestureAt = performance.now();
    return;
  }

  isDown = false;
  if (pointerTravel > 7 || isRotating || multiTouchGestureActive) suppressClickUntil = performance.now() + 260;
  isRotating = false;
  multiTouchGestureActive = false;
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

function zoneSurfaceDistance(zone: BreakZone, normal: THREE.Vector3): number {
  const dot = clamp(normal.clone().normalize().dot(zone.normal), -1, 1);
  if (dot < ZONE_BACKFACE_DOT) return Infinity;
  return Math.acos(dot) * SPHERE_RADIUS;
}

function createStrokeSamples(previousHit: SurfaceHit, hit: SurfaceHit, pixelTravel: number): SurfaceHit[] {
  const count = Math.min(3, Math.max(1, Math.floor(pixelTravel / 24) + 1));
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
  const jitter = sampleIndex % 2 === 0 ? 0.12 : -0.1;
  return {
    kind: 'stroke',
    direction: rotatePoint(direction, jitter),
    stretch: Math.min(2.35, 1.28 + surfaceTravel * 1.08 + pixelTravel * 0.004),
    width: Math.min(1.02, 0.76 + surfaceTravel * 0.16 + pixelTravel * 0.0018),
  };
}

function deformSphereSurfaces(): void {
  deformSphereGeometry(shellMesh, shellBasePositions, {
    carveStrength: 1,
    carveDepth: CORE_EXPOSURE_DEPTH,
  });
  deformSphereGeometry(rubberMesh, rubberBasePositions, {
    carveStrength: 0,
    carveDepth: 0,
  });
  deformSphereGeometry(coreMesh, coreBasePositions, {
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

    let carveDepression = 0;
    zones.forEach((zone) => {
      const surfaceDistance = zoneSurfaceDistance(zone, normal);
      if (options.carveStrength <= 0 || zone.shards.length === 0) return;
      const carveRadius = zone.radius * (1.72 + Math.min(0.18, zone.fractureCount * 0.018));
      if (surfaceDistance > carveRadius) return;

      const localPoint = surfaceToZonePoint(zone, normal);
      const footprintMask = shardFootprintMask(zone, localPoint, zone.radius * 0.08);
      if (footprintMask <= 0) return;

      const fractureDepth = Math.min(0.032, zone.fractureCount * 0.0038);
      carveDepression += (
        options.carveDepth
        + zone.damage * 0.004
        + fractureDepth
      ) * zone.progress * footprintMask;
    });

    const nextRadius = radius
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

function zoneShardHitDistance(zone: BreakZone, localPoint: Point): number {
  return zone.shards.reduce((nearest, shard) => (
    Math.min(nearest, shardHitDistance(zone, shard, localPoint))
  ), Infinity);
}

function shardHitDistance(zone: BreakZone, shard: Shard, localPoint: Point): number {
  if (pointInPolygon(localPoint, shard.polygon)) return 0;

  const visiblePolygon = visibleShardPolygon(zone, shard);
  if (pointInPolygon(localPoint, visiblePolygon)) return 0;

  return Math.min(
    polygonEdgeDistance(localPoint, shard.polygon),
    polygonEdgeDistance(localPoint, visiblePolygon),
  );
}

function visibleShardPolygon(zone: BreakZone, shard: Shard): Point[] {
  const progress = smoothstep(zone.progress);
  const consumed = smoothstep(shard.consumed);
  const splitProgress = progress * 0.68;
  const shardDistance = Math.hypot(shard.center.x, shard.center.y);
  const shardDirection = shardDistance > EPSILON
    ? { x: shard.center.x / shardDistance, y: shard.center.y / shardDistance }
    : { x: Math.cos(shard.phase), y: Math.sin(shard.phase) };
  const gap = splitProgress * (0.028 + zone.fractureCount * 0.006) * (1 - consumed * 0.15);
  const inset = Math.min(0.16, splitProgress * (0.048 + zone.fractureCount * 0.006));
  const shiftedCenter = {
    x: shard.center.x + shardDirection.x * gap,
    y: shard.center.y + shardDirection.y * gap,
  };

  return shard.polygon.map((point) => ({
    x: shiftedCenter.x + (point.x - shard.center.x) * (1 - inset),
    y: shiftedCenter.y + (point.y - shard.center.y) * (1 - inset),
  }));
}

function zoneOutlineMask(zone: BreakZone, localPoint: Point, softness: number): number {
  let nearestEdge = Infinity;

  for (const outline of zone.outline) {
    if (pointInPolygon(localPoint, outline)) return 1;
    nearestEdge = Math.min(nearestEdge, polygonEdgeDistance(localPoint, outline));
  }

  if (!Number.isFinite(nearestEdge)) return 0;
  return smoothstep(1 - nearestEdge / Math.max(softness, EPSILON)) * 0.42;
}

function waxColor(tint: number, consumed: number): THREE.Color {
  const target = tint > 0 ? colors.waxLight : colors.waxDark;
  const color = colors.wax.clone().lerp(target, Math.abs(tint) * 0.34);
  return color.lerp(colors.waxCut, Math.min(0.2, consumed * 0.1));
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

function subtractConvexPolygon(subject: Point[], clip: Point[]): Point[][] {
  if (subject.length < 3 || clip.length < 3) return [];

  let remaining: Point[][] = [dedupePoints(subject)];
  const outsidePieces: Point[][] = [];
  const clipSign = Math.sign(polygonArea(clip)) || 1;

  for (let i = 0; i < clip.length; i += 1) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const nextRemaining: Point[][] = [];

    remaining.forEach((piece) => {
      const inside = clipPolygonToHalfPlane(piece, a, b, clipSign, true);
      const outside = clipPolygonToHalfPlane(piece, a, b, clipSign, false);
      if (isUsablePolygon(outside, 0.0006)) outsidePieces.push(outside);
      if (isUsablePolygon(inside, 0.0006)) nextRemaining.push(inside);
    });

    remaining = nextRemaining;
    if (remaining.length === 0) break;
  }

  return outsidePieces.filter((piece) => isUsablePolygon(piece, 0.0006));
}

function clipPolygonToHalfPlane(
  subject: Point[],
  a: Point,
  b: Point,
  sign: number,
  keepInside: boolean,
): Point[] {
  const output: Point[] = [];
  if (subject.length === 0) return output;

  let start = subject[subject.length - 1];
  for (const end of subject) {
    const endInside = isInsideClip(end, a, b, sign);
    const startInside = isInsideClip(start, a, b, sign);
    const endKeep = keepInside ? endInside : !endInside;
    const startKeep = keepInside ? startInside : !startInside;

    if (endKeep) {
      if (!startKeep) output.push(lineIntersection(start, end, a, b));
      output.push(end);
    } else if (startKeep) {
      output.push(lineIntersection(start, end, a, b));
    }
    start = end;
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

function clonePolygon(points: Point[]): Point[] {
  return points.map((point) => ({ x: point.x, y: point.y }));
}

function isUsablePolygon(points: Point[], minArea: number): boolean {
  return points.length >= 3 && Math.abs(polygonArea(points)) > minArea;
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

function polygonPerimeter(points: Point[]): number {
  let perimeter = 0;
  for (let i = 0; i < points.length; i += 1) {
    perimeter += distance(points[i], points[(i + 1) % points.length]);
  }
  return perimeter;
}

function polygonLongestEdge(points: Point[]): number {
  let longest = 0;
  for (let i = 0; i < points.length; i += 1) {
    longest = Math.max(longest, distance(points[i], points[(i + 1) % points.length]));
  }
  return longest;
}

function polygonCompactness(points: Point[]): number {
  const perimeter = polygonPerimeter(points);
  if (perimeter <= EPSILON) return 0;
  return (4 * Math.PI * Math.abs(polygonArea(points))) / (perimeter * perimeter);
}

function polygonShapeMetrics(points: Point[]): {
  area: number;
  apparentWidth: number;
  compactness: number;
} {
  const area = Math.abs(polygonArea(points));
  const longestEdge = polygonLongestEdge(points);
  return {
    area,
    apparentWidth: area / Math.max(longestEdge, EPSILON),
    compactness: polygonCompactness(points),
  };
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

function polygonsIntersect(a: Point[], b: Point[]): boolean {
  if (a.some((point) => pointInPolygon(point, b)) || b.some((point) => pointInPolygon(point, a))) {
    return true;
  }

  for (let i = 0; i < a.length; i += 1) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j += 1) {
      if (segmentsIntersect(a1, a2, b[j], b[(j + 1) % b.length])) return true;
    }
  }

  return false;
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ad = sub(d, a);
  const cd = sub(d, c);
  const ca = sub(a, c);
  const cb = sub(b, c);
  const d1 = cross(ab, ac);
  const d2 = cross(ab, ad);
  const d3 = cross(cd, ca);
  const d4 = cross(cd, cb);

  if (
    ((d1 > EPSILON && d2 < -EPSILON) || (d1 < -EPSILON && d2 > EPSILON))
    && ((d3 > EPSILON && d4 < -EPSILON) || (d3 < -EPSILON && d4 > EPSILON))
  ) {
    return true;
  }

  return isPointOnSegment(c, a, b)
    || isPointOnSegment(d, a, b)
    || isPointOnSegment(a, c, d)
    || isPointOnSegment(b, c, d);
}

function isPointOnSegment(point: Point, a: Point, b: Point): boolean {
  return Math.abs(cross(sub(b, a), sub(point, a))) <= EPSILON
    && point.x >= Math.min(a.x, b.x) - EPSILON
    && point.x <= Math.max(a.x, b.x) + EPSILON
    && point.y >= Math.min(a.y, b.y) - EPSILON
    && point.y <= Math.max(a.y, b.y) + EPSILON;
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
  const AudioContextCtor = window.AudioContext
    || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;

  audioContext ??= new AudioContextCtor();
  if (audioContext.state === 'suspended') {
    void audioContext.resume();
  }
  return audioContext;
}

function playCrack(force: number, density = 1): void {
  const context = ensureAudioContext();
  if (!context) return;
  void loadCrackSamples(context).then((buffers) => {
    if (buffers.length === 0) return;

    const source = context.createBufferSource();
    const gain = context.createGain();
    const sampleIndex = Math.floor(noise(zoneId * 421 + performance.now()) * buffers.length);
    source.buffer = buffers[sampleIndex];
    source.playbackRate.value = clamp(0.94 + (force - 1) * 0.035 + (density - 1) * 0.018, 0.9, 1.08);
    gain.gain.value = Math.min(0.95, 0.42 + force * 0.2 + density * 0.08) * fractureTuning.audioVolume;
    source.connect(gain);
    gain.connect(context.destination);
    source.start();
  });
}

function resetCrackSamples(): void {
  crackSampleBuffers.length = 0;
  crackSamplePromise = null;
  crackSampleKey = '';
}

function selectedCrackPreset(): CrackSamplePreset {
  return CRACK_SAMPLE_PRESETS.find((preset) => preset.label === fractureTuning.audioSample)
    ?? CRACK_SAMPLE_PRESETS[0];
}

async function loadCrackSamples(context: AudioContext): Promise<AudioBuffer[]> {
  if (fractureTuning.audioSample === LOCAL_CRACK_SAMPLE_LABEL) {
    return uploadedCrackSampleBuffers;
  }

  const preset = selectedCrackPreset();
  if (crackSampleKey !== preset.label) {
    resetCrackSamples();
    crackSampleKey = preset.label;
  }
  if (crackSampleBuffers.length > 0) return crackSampleBuffers;

  crackSamplePromise ??= Promise.all(preset.paths.map(async (path) => {
    try {
      const response = await fetch(path);
      if (!response.ok) return;
      const arrayBuffer = await response.arrayBuffer();
      crackSampleBuffers.push(await context.decodeAudioData(arrayBuffer));
    } catch {
      // Recorded samples are optional local assets; missing files should not break the artwork.
    }
  })).then(() => undefined);

  await crackSamplePromise;
  return crackSampleBuffers;
}

function openCrackSamplePicker(): void {
  crackFileInput ??= document.createElement('input');
  crackFileInput.type = 'file';
  crackFileInput.accept = 'audio/*';
  crackFileInput.multiple = true;
  crackFileInput.onchange = () => {
    void loadUploadedCrackSamples(crackFileInput?.files ?? null);
    if (crackFileInput) crackFileInput.value = '';
  };
  crackFileInput.click();
}

async function loadUploadedCrackSamples(files: FileList | null): Promise<void> {
  if (!files || files.length === 0) return;

  const context = ensureAudioContext();
  if (!context) return;

  uploadedCrackSampleBuffers.length = 0;
  const fileList = Array.from(files);
  await Promise.all(fileList.map(async (file) => {
    try {
      uploadedCrackSampleBuffers.push(await context.decodeAudioData(await file.arrayBuffer()));
    } catch {
      // Ignore unsupported local files and keep any successfully decoded samples.
    }
  }));

  if (uploadedCrackSampleBuffers.length > 0) {
    fractureTuning.audioSample = LOCAL_CRACK_SAMPLE_LABEL;
    resetCrackSamples();
    audioSampleController?.updateDisplay();
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
