import * as THREE from 'three';

type VectorLike = {
  x: number;
  y: number;
  z: number;
};

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x171011, 8, 15);

const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
camera.position.set(0, 0.18, 7.4);

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
renderer.setClearColor(0x171011, 1);

const clock = new THREE.Clock();
const root = new THREE.Group();
scene.add(root);

const pointer = {
  x: 0,
  y: 0,
  targetX: 0,
  targetY: 0,
  pressure: 0,
  targetPressure: 0,
  isDown: false,
};

const outerRadius = 2.18;
const shellRadius = 1.46;
const marshmallowRadius = 1.1;

const highlightMaterial = new THREE.MeshBasicMaterial({
  color: 0xdbfffa,
  transparent: true,
  opacity: 0.38,
  depthWrite: false,
});

const rubberMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xa7fff0,
  roughness: 0.08,
  metalness: 0,
  transmission: 0.58,
  thickness: 1.1,
  ior: 1.23,
  clearcoat: 1,
  clearcoatRoughness: 0.04,
  transparent: true,
  opacity: 0.34,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const chocolateMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x351711,
  roughness: 0.72,
  metalness: 0.03,
  clearcoat: 0.18,
  clearcoatRoughness: 0.62,
  side: THREE.DoubleSide,
});

const chocolateEdgeMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x5c2b20,
  roughness: 0.64,
  metalness: 0.02,
  clearcoat: 0.28,
  clearcoatRoughness: 0.5,
});

const marshmallowMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xfff1f4,
  emissive: 0x6a2432,
  emissiveIntensity: 0.08,
  roughness: 0.92,
  metalness: 0,
  clearcoat: 0.18,
  clearcoatRoughness: 0.88,
  transmission: 0.08,
  thickness: 0.55,
});

const lobeMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xffdce4,
  roughness: 0.96,
  metalness: 0,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
});

const outerGeometry = new THREE.SphereGeometry(outerRadius, 96, 64);
const outerBasePositions = copyPositions(outerGeometry);
const outerPouch = new THREE.Mesh(outerGeometry, rubberMaterial);
outerPouch.renderOrder = 3;
root.add(outerPouch);

const seam = new THREE.Mesh(
  new THREE.TorusGeometry(outerRadius * 1.005, 0.014, 12, 180),
  highlightMaterial,
);
seam.rotation.x = Math.PI / 2;
seam.renderOrder = 4;
root.add(seam);

const verticalSeam = new THREE.Mesh(
  new THREE.TorusGeometry(outerRadius * 1.006, 0.009, 10, 180),
  highlightMaterial.clone(),
);
verticalSeam.rotation.y = Math.PI / 2;
verticalSeam.renderOrder = 4;
root.add(verticalSeam);

const marshmallowGeometry = new THREE.SphereGeometry(marshmallowRadius, 80, 48);
const marshmallowBasePositions = copyPositions(marshmallowGeometry);
const marshmallow = new THREE.Mesh(marshmallowGeometry, marshmallowMaterial);
marshmallow.renderOrder = 1;
root.add(marshmallow);

const marshmallowLobes = createMarshmallowLobes();
root.add(marshmallowLobes);

const shell = createChocolateShell();
root.add(shell);

const rim = new THREE.Mesh(
  new THREE.TorusGeometry(shellRadius * 0.86, 0.05, 14, 180),
  chocolateEdgeMaterial,
);
rim.position.z = shellRadius * 0.5;
rim.renderOrder = 2;
root.add(rim);

const crumbs = createChocolateCrumbs();
root.add(crumbs);

const bubbles = createRubberBubbles();
root.add(bubbles);

const floorShadow = new THREE.Mesh(
  new THREE.CircleGeometry(2.45, 96),
  new THREE.MeshBasicMaterial({
    color: 0x070404,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  }),
);
floorShadow.position.set(0, -2.55, -0.3);
floorShadow.scale.set(1.28, 0.26, 1);
floorShadow.rotation.x = -Math.PI / 2;
scene.add(floorShadow);

scene.add(new THREE.HemisphereLight(0xd6fff7, 0x2c1511, 1.55));

const keyLight = new THREE.DirectionalLight(0xffdac3, 3.4);
keyLight.position.set(-3.4, 4.8, 4.2);
scene.add(keyLight);

const coolLight = new THREE.PointLight(0x7cfff1, 4.6, 11);
coolLight.position.set(3.6, 1.6, 3.1);
scene.add(coolLight);

const lowWarmLight = new THREE.PointLight(0xff8d66, 2.2, 8);
lowWarmLight.position.set(-2.5, -2.7, 2.7);
scene.add(lowWarmLight);

function copyPositions(geometry: THREE.BufferGeometry): Float32Array {
  return new Float32Array((geometry.attributes.position.array as Float32Array));
}

function createChocolateShell(): THREE.Group {
  const group = new THREE.Group();
  const latSteps = 12;
  const lonSteps = 24;
  const latMin = -Math.PI * 0.47;
  const latMax = Math.PI * 0.47;

  for (let y = 0; y < latSteps; y += 1) {
    const lat0 = THREE.MathUtils.lerp(latMin, latMax, y / latSteps);
    const lat1 = THREE.MathUtils.lerp(latMin, latMax, (y + 0.82) / latSteps);

    for (let x = 0; x < lonSteps; x += 1) {
      const lon0 = THREE.MathUtils.lerp(-Math.PI, Math.PI, x / lonSteps);
      const lon1 = THREE.MathUtils.lerp(-Math.PI, Math.PI, (x + 0.82) / lonSteps);
      const latMid = (lat0 + lat1) * 0.5;
      const lonMid = (lon0 + lon1) * 0.5;
      const front = Math.cos(latMid) * Math.cos(lonMid);

      if (front > 0.48) continue;
      if ((x + y * 3) % 17 === 0 && front > -0.25) continue;

      const geometry = createSphericalPatchGeometry(lat0, lat1, lon0, lon1, shellRadius + noise2(x, y) * 0.025);
      const material = chocolateMaterial.clone();
      const shade = 0.82 + noise2(x + 11, y + 7) * 0.32;
      material.color.setRGB(0.21 * shade, 0.09 * shade, 0.06 * shade);
      const patch = new THREE.Mesh(geometry, material);
      patch.renderOrder = 2;
      patch.userData.spin = noise2(x + 21, y + 31) * 0.002;
      group.add(patch);
    }
  }

  const backCap = new THREE.Mesh(
    new THREE.SphereGeometry(shellRadius * 0.997, 64, 32, 0, Math.PI * 2, 0, Math.PI),
    new THREE.MeshPhysicalMaterial({
      color: 0x2c120f,
      roughness: 0.78,
      metalness: 0.02,
      transparent: true,
      opacity: 0.34,
      side: THREE.BackSide,
    }),
  );
  backCap.renderOrder = 0;
  group.add(backCap);

  return group;
}

function createSphericalPatchGeometry(lat0: number, lat1: number, lon0: number, lon1: number, radius: number): THREE.BufferGeometry {
  const rows = 3;
  const cols = 3;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let row = 0; row <= rows; row += 1) {
    const v = row / rows;
    const lat = THREE.MathUtils.lerp(lat0, lat1, v);

    for (let col = 0; col <= cols; col += 1) {
      const u = col / cols;
      const lon = THREE.MathUtils.lerp(lon0, lon1, u);
      const p = sphericalPoint(radius, lat, lon);
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

function sphericalPoint(radius: number, lat: number, lon: number): VectorLike {
  const c = Math.cos(lat);
  return {
    x: radius * c * Math.sin(lon),
    y: radius * Math.sin(lat),
    z: radius * c * Math.cos(lon),
  };
}

function createMarshmallowLobes(): THREE.Group {
  const group = new THREE.Group();
  const seeds = [
    [-0.36, 0.26, 0.78, 0.5],
    [0.28, 0.18, 0.9, 0.46],
    [-0.08, -0.22, 0.92, 0.54],
    [0.42, -0.3, 0.66, 0.36],
    [-0.46, -0.18, 0.58, 0.34],
    [0.04, 0.44, 0.62, 0.34],
  ];

  for (const [x, y, z, scale] of seeds) {
    const lobe = new THREE.Mesh(new THREE.SphereGeometry(scale, 36, 24), lobeMaterial.clone());
    lobe.position.set(x, y, z);
    lobe.scale.set(1.08, 0.86, 0.72);
    lobe.userData.baseY = y;
    lobe.renderOrder = 1;
    group.add(lobe);
  }

  return group;
}

function createChocolateCrumbs(): THREE.Group {
  const group = new THREE.Group();
  const crumbMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x6b3525,
    roughness: 0.8,
    metalness: 0.01,
  });

  for (let i = 0; i < 26; i += 1) {
    const angle = i * 2.399 + 0.24;
    const band = 0.68 + noise1(i) * 0.36;
    const geometry = new THREE.DodecahedronGeometry(0.025 + noise1(i + 50) * 0.035, 0);
    const crumb = new THREE.Mesh(geometry, crumbMaterial.clone());
    crumb.position.set(
      Math.cos(angle) * shellRadius * band,
      Math.sin(angle) * shellRadius * band * 0.74,
      shellRadius * (0.53 + noise1(i + 13) * 0.18),
    );
    crumb.rotation.set(noise1(i + 2) * Math.PI, noise1(i + 5) * Math.PI, noise1(i + 8) * Math.PI);
    crumb.userData.drift = noise1(i + 9) * 0.02;
    crumb.renderOrder = 3;
    group.add(crumb);
  }

  return group;
}

function createRubberBubbles(): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: 0xe8fffb,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
  });

  for (let i = 0; i < 18; i += 1) {
    const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.025 + noise1(i + 2) * 0.04, 18, 12), material.clone());
    const lat = -0.9 + noise1(i + 3) * 1.8;
    const lon = -Math.PI + noise1(i + 4) * Math.PI * 2;
    const radius = 1.7 + noise1(i + 5) * 0.34;
    const p = sphericalPoint(radius, lat, lon);
    bubble.position.set(p.x, p.y, p.z);
    bubble.userData.float = noise1(i + 10) * Math.PI * 2;
    bubble.renderOrder = 5;
    group.add(bubble);
  }

  return group;
}

function updateOuterPouch(time: number, dent: THREE.Vector3): void {
  const positions = outerGeometry.attributes.position.array as Float32Array;
  const press = pointer.pressure;

  for (let i = 0; i < positions.length; i += 3) {
    const x = outerBasePositions[i];
    const y = outerBasePositions[i + 1];
    const z = outerBasePositions[i + 2];
    const length = Math.hypot(x, y, z);
    const nx = x / length;
    const ny = y / length;
    const nz = z / length;
    const surfaceDot = nx * dent.x + ny * dent.y + nz * dent.z;
    const directDent = Math.max(0, (surfaceDot - 0.7) / 0.3);
    const raisedLip = Math.max(0, 1 - Math.abs(surfaceDot - 0.69) / 0.13);
    const wave =
      Math.sin(time * 1.45 + nx * 4.4 + ny * 2.6) * 0.014 +
      Math.sin(time * 1.02 + nz * 5.7 + ny * 1.7) * 0.011;
    const displacement = wave - directDent * directDent * press * 0.34 + raisedLip * press * 0.052;
    const radius = outerRadius + displacement;

    positions[i] = nx * radius;
    positions[i + 1] = ny * radius;
    positions[i + 2] = nz * radius;
  }

  outerGeometry.attributes.position.needsUpdate = true;
  outerGeometry.computeVertexNormals();
}

function updateMarshmallow(time: number, dent: THREE.Vector3): void {
  const positions = marshmallowGeometry.attributes.position.array as Float32Array;
  const press = pointer.pressure;

  for (let i = 0; i < positions.length; i += 3) {
    const x = marshmallowBasePositions[i];
    const y = marshmallowBasePositions[i + 1];
    const z = marshmallowBasePositions[i + 2];
    const length = Math.hypot(x, y, z);
    const nx = x / length;
    const ny = y / length;
    const nz = z / length;
    const surfaceDot = nx * dent.x + ny * dent.y + nz * dent.z;
    const softDent = Math.max(0, (surfaceDot - 0.5) / 0.5);
    const wobble =
      Math.sin(time * 2.1 + nx * 5.5 + ny * 1.4) * 0.035 +
      Math.sin(time * 1.6 + nz * 4.3 - ny * 2.3) * 0.028;
    const radius = marshmallowRadius + wobble - softDent * press * 0.1;

    positions[i] = nx * radius;
    positions[i + 1] = ny * radius;
    positions[i + 2] = nz * radius;
  }

  marshmallowGeometry.attributes.position.needsUpdate = true;
  marshmallowGeometry.computeVertexNormals();
}

function updatePointerFromEvent(event: PointerEvent): void {
  const rect = canvas.getBoundingClientRect();
  pointer.targetX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.targetY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
}

canvas.addEventListener('pointerenter', (event) => {
  updatePointerFromEvent(event);
  pointer.targetPressure = pointer.isDown ? 1 : 0.36;
});

canvas.addEventListener('pointermove', (event) => {
  updatePointerFromEvent(event);
  pointer.targetPressure = pointer.isDown ? 1 : 0.36;
});

canvas.addEventListener('pointerdown', (event) => {
  pointer.isDown = true;
  pointer.targetPressure = 1;
  updatePointerFromEvent(event);
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointerup', (event) => {
  pointer.isDown = false;
  pointer.targetPressure = 0.22;
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
  camera.position.z = width < 680 ? 8.3 : 7.4;
  camera.updateProjectionMatrix();
  root.scale.setScalar(width < 680 ? 0.86 : 1);
}

function animate(): void {
  const elapsed = clock.getElapsedTime();
  const time = reducedMotion ? 0.6 : elapsed;
  pointer.x += (pointer.targetX - pointer.x) * 0.08;
  pointer.y += (pointer.targetY - pointer.y) * 0.08;
  pointer.pressure += (pointer.targetPressure - pointer.pressure) * 0.1;

  const dent = new THREE.Vector3(pointer.x * 0.72, pointer.y * 0.62, 1).normalize();
  updateOuterPouch(time, dent);
  updateMarshmallow(time, dent);

  const idleRotation = reducedMotion ? 0 : Math.sin(time * 0.32) * 0.12;
  root.rotation.y += ((pointer.x * 0.28 + idleRotation) - root.rotation.y) * 0.035;
  root.rotation.x += ((-pointer.y * 0.16 + Math.sin(time * 0.27) * 0.04) - root.rotation.x) * 0.035;
  root.rotation.z = Math.sin(time * 0.22) * 0.025;

  seam.rotation.z = time * 0.08;
  verticalSeam.rotation.z = -time * 0.06;
  rim.rotation.z = Math.sin(time * 0.28) * 0.035;
  shell.rotation.y = Math.sin(time * 0.18) * 0.025;

  marshmallowLobes.children.forEach((child, index) => {
    const mesh = child as THREE.Mesh;
    const baseY = mesh.userData.baseY as number;
    mesh.position.y = baseY + Math.sin(time * 1.8 + index * 1.3) * 0.035;
    mesh.scale.y = 0.82 + Math.sin(time * 2.2 + index) * 0.04;
  });

  crumbs.children.forEach((child, index) => {
    child.rotation.x += 0.002 + index * 0.00002;
    child.rotation.y -= 0.0015;
    child.position.z += Math.sin(time * 1.2 + index) * 0.0004;
  });

  bubbles.children.forEach((child, index) => {
    const phase = child.userData.float as number;
    child.position.y += Math.sin(time * 1.3 + phase + index) * 0.0007;
  });

  floorShadow.scale.x = 1.28 + pointer.pressure * 0.05;
  floorShadow.material.opacity = 0.29 + pointer.pressure * 0.08;

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
