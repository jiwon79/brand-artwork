import * as THREE from 'three';

type OpacityMaterial = THREE.Material & {
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
};

type PointerState = {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  pressure: number;
  targetPressure: number;
  isDown: boolean;
};

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x151313, 7.5, 13);

const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
camera.position.set(0, 0.05, 6.15);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: true,
  powerPreference: 'high-performance',
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.setClearColor(0x151313, 1);

const pointer: PointerState = {
  x: 0,
  y: 0,
  targetX: 0,
  targetY: 0,
  pressure: 0,
  targetPressure: 0,
  isDown: false,
};

const clock = new THREE.Clock();
const ball = new THREE.Group();
scene.add(ball);

let breakProgress = 0;
let breakTarget = 0;

const squishyRadius = 1.18;
const waxRadius = 1.28;
const rubberRadius = 1.34;

const rubberMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xf4fffb,
  roughness: 0.05,
  metalness: 0,
  transmission: 0.86,
  thickness: 0.055,
  ior: 1.22,
  clearcoat: 1,
  clearcoatRoughness: 0.03,
  transparent: true,
  opacity: 0.18,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const waxMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xc8e86d,
  roughness: 0.82,
  metalness: 0,
  clearcoat: 0.08,
  clearcoatRoughness: 0.82,
  transparent: true,
  opacity: 1,
  side: THREE.DoubleSide,
});

const squishyMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xffcfdf,
  emissive: 0x562437,
  emissiveIntensity: 0.07,
  roughness: 0.72,
  metalness: 0,
  clearcoat: 0.44,
  clearcoatRoughness: 0.46,
  transparent: true,
  opacity: 0,
});

const shineMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.26,
  depthWrite: false,
});

const rubberGeometry = new THREE.SphereGeometry(rubberRadius, 96, 64);
const rubberBase = copyPositions(rubberGeometry);
const rubberCover = new THREE.Mesh(rubberGeometry, rubberMaterial);
rubberCover.renderOrder = 4;
ball.add(rubberCover);

const rubberKnot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 32, 18), rubberMaterial.clone());
rubberKnot.position.set(0.02, rubberRadius * 0.92, -0.04);
rubberKnot.scale.set(0.74, 0.28, 0.58);
rubberKnot.renderOrder = 5;
ball.add(rubberKnot);

const rubberHighlights = createRubberHighlights();
ball.add(rubberHighlights);

const squishyGeometry = new THREE.SphereGeometry(squishyRadius, 96, 64);
const squishyBase = copyPositions(squishyGeometry);
const squishyCore = new THREE.Mesh(squishyGeometry, squishyMaterial);
squishyCore.scale.set(1.04, 0.92, 1);
squishyCore.renderOrder = 1;
ball.add(squishyCore);

const intactWaxShell = new THREE.Mesh(new THREE.SphereGeometry(waxRadius, 96, 64), waxMaterial);
intactWaxShell.renderOrder = 2;
ball.add(intactWaxShell);

const waxFlakes = createWaxFlakes();
ball.add(waxFlakes);

const cracks = createCracks();
ball.add(cracks);

const waxDust = createWaxDust();
ball.add(waxDust);

const tableShadow = new THREE.Mesh(
  new THREE.CircleGeometry(1.75, 96),
  new THREE.MeshBasicMaterial({
    color: 0x050404,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  }),
);
tableShadow.position.set(0, -1.82, -0.45);
tableShadow.scale.set(1.34, 0.24, 1);
tableShadow.rotation.x = -Math.PI / 2;
scene.add(tableShadow);

scene.add(new THREE.HemisphereLight(0xf8fffb, 0x2c1916, 1.4));

const keyLight = new THREE.DirectionalLight(0xffeadc, 3.2);
keyLight.position.set(-3.2, 4.8, 4.6);
scene.add(keyLight);

const fillLight = new THREE.PointLight(0xb9ffe7, 3.1, 9);
fillLight.position.set(3.2, 1.4, 2.4);
scene.add(fillLight);

const lowLight = new THREE.PointLight(0xff86a8, 1.7, 7);
lowLight.position.set(-2.4, -2.1, 2.2);
scene.add(lowLight);

function copyPositions(geometry: THREE.BufferGeometry): Float32Array {
  return new Float32Array(geometry.attributes.position.array as Float32Array);
}

function createRubberHighlights(): THREE.Group {
  const group = new THREE.Group();
  const spots = [
    [-0.46, 0.56, 1.16, 0.13, 0.09],
    [0.52, 0.48, 1.12, 0.12, 0.08],
    [0.64, -0.24, 1.1, 0.1, 0.06],
  ];

  for (const [x, y, z, sx, sy] of spots) {
    const spot = new THREE.Mesh(new THREE.CircleGeometry(1, 36), shineMaterial.clone());
    spot.position.set(x, y, z);
    spot.scale.set(sx, sy, 1);
    spot.renderOrder = 6;
    group.add(spot);
  }

  return group;
}

function createWaxFlakes(): THREE.Group {
  const group = new THREE.Group();
  const latSteps = 9;
  const lonSteps = 17;
  const latMin = -Math.PI * 0.47;
  const latMax = Math.PI * 0.47;

  for (let row = 0; row < latSteps; row += 1) {
    const lat0 = THREE.MathUtils.lerp(latMin, latMax, row / latSteps);
    const lat1 = THREE.MathUtils.lerp(latMin, latMax, (row + 0.86) / latSteps);

    for (let col = 0; col < lonSteps; col += 1) {
      const lon0 = THREE.MathUtils.lerp(-Math.PI, Math.PI, col / lonSteps);
      const lon1 = THREE.MathUtils.lerp(-Math.PI, Math.PI, (col + 0.86) / lonSteps);
      const latMid = (lat0 + lat1) * 0.5;
      const lonMid = (lon0 + lon1) * 0.5;
      const front = Math.cos(latMid) * Math.cos(lonMid);

      if (front > 0.98) continue;
      if ((col * 5 + row * 3) % 23 === 0 && front > -0.25) continue;

      const cellLat = lat1 - lat0;
      const cellLon = lon1 - lon0;
      const latCenter = (lat0 + lat1) * 0.5 + noise2(col + 2, row + 3) * cellLat * 0.18;
      const lonCenter = (lon0 + lon1) * 0.5 + noise2(col + 6, row + 9) * cellLon * 0.18;
      const latSpan = cellLat * (0.46 + noise1(col * 29 + row * 7) * 0.42);
      const lonSpan = cellLon * (0.44 + noise1(col * 17 + row * 37) * 0.5);
      const geometry = createWaxFlakeGeometry(
        latCenter - latSpan * 0.5,
        latCenter + latSpan * 0.5,
        lonCenter - lonSpan * 0.5,
        lonCenter + lonSpan * 0.5,
        waxRadius + noise2(col, row) * 0.014,
        col * 97 + row * 131,
      );
      const material = waxMaterial.clone();
      const shade = 0.84 + noise2(col + 11, row + 7) * 0.12;
      material.color.setRGB(0.68 * shade, 0.79 * shade, 0.28 * shade);
      material.opacity = 0;

      const flake = new THREE.Mesh(geometry, material);
      const normal = new THREE.Vector3(
        Math.sin(lonMid) * Math.cos(latMid),
        Math.sin(latMid),
        Math.cos(lonMid) * Math.cos(latMid),
      ).normalize();
      flake.renderOrder = 3;
      flake.userData.normal = normal;
      flake.userData.shift = 0.012 + noise1(col * 23 + row * 41) * 0.058;
      flake.userData.rotation = new THREE.Vector3(
        noise2(col + 3, row + 5),
        noise2(col + 7, row + 11),
        noise2(col + 13, row + 17),
      ).multiplyScalar(0.12);
      group.add(flake);
    }
  }

  return group;
}

function createWaxFlakeGeometry(
  lat0: number,
  lat1: number,
  lon0: number,
  lon1: number,
  radius: number,
  seed: number,
): THREE.BufferGeometry {
  const rows = 3;
  const cols = 3;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let row = 0; row <= rows; row += 1) {
    const v = row / rows;
    const lat = THREE.MathUtils.lerp(lat0, lat1, v);

    for (let col = 0; col <= cols; col += 1) {
      const u = col / cols;
      const edge = row === 0 || row === rows || col === 0 || col === cols;
      const lon = THREE.MathUtils.lerp(lon0, lon1, u);
      const jitter = edge ? 0 : 1;
      const p = sphericalPoint(
        radius + noise2(seed + row * 23, col * 29) * 0.012,
        lat + noise2(seed + row * 11, col * 13) * (lat1 - lat0) * 0.08 * jitter,
        lon + noise2(seed + row * 17, col * 19) * (lon1 - lon0) * 0.08 * jitter,
      );
      positions.push(p.x, p.y, p.z);
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const a = row * (cols + 1) + col;
      const b = a + 1;
      const c = a + cols + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createCracks(): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.LineBasicMaterial({
    color: 0x6f8836,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const branches = [
    [[-0.02, 0.7], [-0.12, 0.36], [-0.02, 0.08], [-0.18, -0.18], [-0.12, -0.55]],
    [[0.02, 0.42], [0.22, 0.24], [0.13, -0.08], [0.42, -0.28]],
    [[-0.06, 0.22], [-0.34, 0.14], [-0.56, -0.1]],
    [[0.08, 0.02], [0.36, 0.04], [0.58, -0.12]],
  ];

  for (const branch of branches) {
    const points = branch.map(([x, y]) => {
      const z = Math.sqrt(Math.max(0, waxRadius * waxRadius - x * x - y * y));
      return new THREE.Vector3(x, y, z + 0.016);
    });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material.clone());
    line.renderOrder = 5;
    group.add(line);
  }

  return group;
}

function createWaxDust(): THREE.Group {
  const group = new THREE.Group();
  const material = waxMaterial.clone();
  material.opacity = 0;

  for (let i = 0; i < 34; i += 1) {
    const angle = i * 2.399 + 0.2;
    const band = 0.62 + noise1(i) * 0.42;
    const chip = new THREE.Mesh(new THREE.DodecahedronGeometry(0.018 + noise1(i + 50) * 0.032, 0), material.clone());
    const base = new THREE.Vector3(
      Math.cos(angle) * waxRadius * band,
      Math.sin(angle) * waxRadius * band * 0.76,
      waxRadius * (0.54 + noise1(i + 13) * 0.2),
    );
    chip.position.copy(base);
    chip.rotation.set(noise1(i + 2) * Math.PI, noise1(i + 5) * Math.PI, noise1(i + 8) * Math.PI);
    chip.userData.base = base;
    chip.userData.normal = base.clone().normalize();
    chip.userData.drift = noise1(i + 9) * 0.018;
    chip.renderOrder = 4;
    group.add(chip);
  }

  return group;
}

function sphericalPoint(radius: number, lat: number, lon: number): THREE.Vector3 {
  const c = Math.cos(lat);
  return new THREE.Vector3(
    radius * c * Math.sin(lon),
    radius * Math.sin(lat),
    radius * c * Math.cos(lon),
  );
}

function updateRubberCover(time: number, dent: THREE.Vector3): void {
  const positions = rubberGeometry.attributes.position.array as Float32Array;
  const press = pointer.pressure;

  for (let i = 0; i < positions.length; i += 3) {
    const x = rubberBase[i];
    const y = rubberBase[i + 1];
    const z = rubberBase[i + 2];
    const length = Math.hypot(x, y, z);
    const nx = x / length;
    const ny = y / length;
    const nz = z / length;
    const surfaceDot = nx * dent.x + ny * dent.y + nz * dent.z;
    const directDent = Math.max(0, (surfaceDot - 0.7) / 0.3);
    const raisedLip = Math.max(0, 1 - Math.abs(surfaceDot - 0.67) / 0.13);
    const wave =
      Math.sin(time * 1.24 + nx * 4.2 + ny * 2.4) * 0.01 +
      Math.sin(time * 0.94 + nz * 5.2 + ny * 1.6) * 0.008;
    const radius = rubberRadius + wave - directDent * directDent * press * 0.22 + raisedLip * press * 0.034;
    positions[i] = nx * radius;
    positions[i + 1] = ny * radius;
    positions[i + 2] = nz * radius;
  }

  rubberGeometry.attributes.position.needsUpdate = true;
  rubberGeometry.computeVertexNormals();
}

function updateSquishy(time: number, dent: THREE.Vector3): void {
  const positions = squishyGeometry.attributes.position.array as Float32Array;
  const reveal = smoothstep(0.16, 0.76, breakProgress);
  const press = pointer.pressure * (0.3 + reveal * 0.7);

  for (let i = 0; i < positions.length; i += 3) {
    const x = squishyBase[i];
    const y = squishyBase[i + 1];
    const z = squishyBase[i + 2];
    const length = Math.hypot(x, y, z);
    const nx = x / length;
    const ny = y / length;
    const nz = z / length;
    const surfaceDot = nx * dent.x + ny * dent.y + nz * dent.z;
    const softDent = Math.max(0, (surfaceDot - 0.5) / 0.5);
    const wobble =
      Math.sin(time * 2.0 + nx * 5.2 + ny * 1.4) * 0.032 * reveal +
      Math.sin(time * 1.45 + nz * 4.0 - ny * 2.1) * 0.026 * reveal;
    const slowRise = Math.max(0, -ny) * reveal * 0.05;
    const radius = squishyRadius + wobble + slowRise - softDent * press * 0.16;
    positions[i] = nx * radius;
    positions[i + 1] = ny * radius;
    positions[i + 2] = nz * radius;
  }

  squishyGeometry.attributes.position.needsUpdate = true;
  squishyGeometry.computeVertexNormals();
}

function updateBreakState(time: number): void {
  breakProgress += (breakTarget - breakProgress) * (breakTarget > breakProgress ? 0.044 : 0.08);
  if (Math.abs(breakTarget - breakProgress) < 0.001) {
    breakProgress = breakTarget;
  }

  const shellFade = smoothstep(0.1, 0.68, breakProgress);
  const flakeReveal = smoothstep(0.08, 0.62, breakProgress);
  const scatter = smoothstep(0.02, 0.42, breakProgress);
  const squishyReveal = smoothstep(0.22, 0.82, breakProgress);

  intactWaxShell.visible = true;
  waxMaterial.opacity = 1 - shellFade * 0.66;
  waxMaterial.depthWrite = waxMaterial.opacity > 0.58;

  setObjectOpacity(squishyCore, squishyReveal * 0.42);

  waxFlakes.visible = flakeReveal > 0.01;
  waxFlakes.children.forEach((child) => {
    const flake = child as THREE.Mesh;
    const normal = flake.userData.normal as THREE.Vector3;
    const shift = flake.userData.shift as number;
    const rotation = flake.userData.rotation as THREE.Vector3;
    setObjectOpacity(flake, flakeReveal * 0.82);
    flake.position.copy(normal).multiplyScalar(scatter * shift);
    flake.rotation.set(rotation.x * scatter, rotation.y * scatter, rotation.z * scatter);
  });

  waxDust.visible = flakeReveal > 0.05;
  waxDust.children.forEach((child, index) => {
    const chip = child as THREE.Mesh;
    const base = chip.userData.base as THREE.Vector3;
    const normal = chip.userData.normal as THREE.Vector3;
    const drift = chip.userData.drift as number;
    setObjectOpacity(chip, flakeReveal * 0.38);
    chip.position.copy(base).addScaledVector(normal, scatter * (0.018 + drift));
    chip.position.y += Math.sin(time * 1.1 + index) * 0.003 * flakeReveal;
  });

  cracks.visible = breakProgress > 0.02;
  const crackOpacity = smoothstep(0.02, 0.28, breakProgress) * 0.78;
  cracks.children.forEach((child) => setObjectOpacity(child, crackOpacity));
}

function setObjectOpacity(object: THREE.Object3D, opacity: number): void {
  const material = (object as THREE.Mesh).material as OpacityMaterial | OpacityMaterial[] | undefined;
  if (!material) return;
  const materials = Array.isArray(material) ? material : [material];
  materials.forEach((entry) => {
    entry.transparent = true;
    entry.opacity = opacity;
    entry.depthWrite = opacity > 0.88;
  });
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function updatePointerFromEvent(event: PointerEvent): void {
  const rect = canvas.getBoundingClientRect();
  pointer.targetX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.targetY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
}

canvas.addEventListener('pointerenter', (event) => {
  updatePointerFromEvent(event);
  pointer.targetPressure = pointer.isDown ? 1 : 0.22;
});

canvas.addEventListener('pointermove', (event) => {
  updatePointerFromEvent(event);
  pointer.targetPressure = pointer.isDown ? 1 : 0.22;
});

canvas.addEventListener('pointerdown', (event) => {
  pointer.isDown = true;
  pointer.targetPressure = 1;
  breakTarget = 0.82;
  updatePointerFromEvent(event);
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointerup', (event) => {
  pointer.isDown = false;
  pointer.targetPressure = 0.16;
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
});

canvas.addEventListener('pointerleave', () => {
  pointer.isDown = false;
  pointer.targetPressure = 0;
});

window.addEventListener('resize', resize);
resize();

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.position.z = width < 680 ? 6.8 : 6.15;
  camera.updateProjectionMatrix();
  ball.scale.setScalar(width < 680 ? 0.92 : 1);
}

function animate(): void {
  const elapsed = clock.getElapsedTime();
  const time = reducedMotion ? 0.6 : elapsed;
  pointer.x += (pointer.targetX - pointer.x) * 0.08;
  pointer.y += (pointer.targetY - pointer.y) * 0.08;
  pointer.pressure += (pointer.targetPressure - pointer.pressure) * 0.11;

  const dent = new THREE.Vector3(pointer.x * 0.7, pointer.y * 0.62, 1).normalize();
  updateRubberCover(time, dent);
  updateSquishy(time, dent);
  updateBreakState(time);

  const idleRotation = reducedMotion ? 0 : Math.sin(time * 0.28) * 0.1;
  ball.rotation.y += ((pointer.x * 0.24 + idleRotation) - ball.rotation.y) * 0.035;
  ball.rotation.x += ((-pointer.y * 0.15 + Math.sin(time * 0.24) * 0.035) - ball.rotation.x) * 0.035;
  ball.rotation.z = Math.sin(time * 0.2) * 0.018;
  rubberKnot.rotation.z = Math.sin(time * 1.2) * 0.08;

  tableShadow.scale.x = 1.34 + pointer.pressure * 0.05;
  tableShadow.material.opacity = 0.26 + pointer.pressure * 0.08;

  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

function noise1(seed: number): number {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function noise2(x: number, y: number): number {
  return noise1(x * 12.9898 + y * 78.233) * 2 - 1;
}
