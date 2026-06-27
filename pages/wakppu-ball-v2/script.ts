import * as THREE from 'three';

type VectorLike = {
  x: number;
  y: number;
  z: number;
};

type OpacityMaterial = THREE.Material & {
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
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

let crackProgress = 0;
let crackTarget = 0;

const outerRadius = 2.18;
const shellRadius = 1.46;
const marshmallowRadius = 1.1;

const highlightMaterial = new THREE.MeshBasicMaterial({
  color: 0xdbfffa,
  transparent: true,
  opacity: 0.24,
  depthWrite: false,
});

const rubberMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xa7fff0,
  roughness: 0.08,
  metalness: 0,
  transmission: 0.72,
  thickness: 0.11,
  ior: 1.23,
  clearcoat: 1,
  clearcoatRoughness: 0.04,
  transparent: true,
  opacity: 0.2,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const chocolateMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x351711,
  roughness: 0.88,
  metalness: 0.01,
  clearcoat: 0.06,
  clearcoatRoughness: 0.86,
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
  emissiveIntensity: 0.1,
  roughness: 0.86,
  metalness: 0,
  clearcoat: 0.34,
  clearcoatRoughness: 0.72,
  transmission: 0.12,
  thickness: 0.72,
  transparent: true,
  opacity: 0,
});

const lobeMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xffdce4,
  roughness: 0.96,
  metalness: 0,
  transparent: true,
  opacity: 0,
  depthWrite: false,
});

const outerGeometry = new THREE.SphereGeometry(outerRadius, 96, 64);
const outerBasePositions = copyPositions(outerGeometry);
const outerPouch = new THREE.Mesh(outerGeometry, rubberMaterial);
outerPouch.renderOrder = 3;
root.add(outerPouch);

const seam = new THREE.Mesh(
  new THREE.TorusGeometry(outerRadius * 1.005, 0.004, 8, 180),
  highlightMaterial,
);
seam.rotation.x = Math.PI / 2;
seam.renderOrder = 4;
root.add(seam);

const verticalSeam = new THREE.Mesh(
  new THREE.TorusGeometry(outerRadius * 1.006, 0.003, 8, 180),
  highlightMaterial.clone(),
);
verticalSeam.rotation.y = Math.PI / 2;
verticalSeam.renderOrder = 4;
root.add(verticalSeam);

const marshmallowGeometry = new THREE.SphereGeometry(marshmallowRadius, 80, 48);
const marshmallowBasePositions = copyPositions(marshmallowGeometry);
const marshmallow = new THREE.Mesh(marshmallowGeometry, marshmallowMaterial);
marshmallow.position.y = -0.08;
marshmallow.scale.set(1.12, 0.82, 0.92);
marshmallow.renderOrder = 1;
root.add(marshmallow);

const marshmallowLobes = createMarshmallowLobes();
root.add(marshmallowLobes);

const marshmallowDrips = createMarshmallowDrips();
root.add(marshmallowDrips);

const solidChocolateMaterial = chocolateMaterial.clone();
solidChocolateMaterial.color.set(0x32140f);
solidChocolateMaterial.transparent = true;
solidChocolateMaterial.opacity = 1;
solidChocolateMaterial.depthWrite = true;

const solidChocolateShell = new THREE.Mesh(
  new THREE.SphereGeometry(shellRadius, 96, 64),
  solidChocolateMaterial,
);
solidChocolateShell.renderOrder = 2;
root.add(solidChocolateShell);

const shell = createChocolateShell();
root.add(shell);

const rimMaterial = chocolateEdgeMaterial.clone();
rimMaterial.transparent = true;
rimMaterial.opacity = 0;

const rim = new THREE.Mesh(
  new THREE.TorusGeometry(shellRadius * 0.86, 0.05, 14, 180),
  rimMaterial,
);
rim.position.z = shellRadius * 0.5;
rim.renderOrder = 2;
root.add(rim);

const crumbs = createChocolateCrumbs();
root.add(crumbs);

const crackLines = createCrackLines();
root.add(crackLines);

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

      if (front > 0.68) continue;
      if ((x + y * 3) % 17 === 0 && front > -0.25) continue;

      const geometry = createSphericalPatchGeometry(lat0, lat1, lon0, lon1, shellRadius + noise2(x, y) * 0.025);
      const material = chocolateMaterial.clone();
      const shade = 0.82 + noise2(x + 11, y + 7) * 0.32;
      material.color.setRGB(0.21 * shade, 0.09 * shade, 0.06 * shade);
      material.transparent = true;
      material.opacity = 0;
      const patch = new THREE.Mesh(geometry, material);
      patch.renderOrder = 2;
      patch.userData.opacityMax = 1;
      patch.userData.breakNormal = new THREE.Vector3(
        Math.sin(lonMid) * Math.cos(latMid),
        Math.sin(latMid),
        Math.cos(lonMid) * Math.cos(latMid),
      ).normalize();
      patch.userData.breakShift = 0.07 + noise1(x * 19 + y * 31) * 0.34;
      patch.userData.breakRotation = new THREE.Vector3(
        noise2(x + 21, y + 31),
        noise2(x + 41, y + 13),
        noise2(x + 9, y + 53),
      ).multiplyScalar(0.38);
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
      opacity: 0,
      side: THREE.BackSide,
    }),
  );
  backCap.renderOrder = 0;
  backCap.userData.opacityMax = 0.34;
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
    [-0.36, 0.16, 0.78, 0.52],
    [0.3, 0.1, 0.9, 0.48],
    [-0.08, -0.34, 0.92, 0.58],
    [0.46, -0.42, 0.66, 0.36],
    [-0.48, -0.3, 0.58, 0.34],
    [0.04, 0.3, 0.62, 0.34],
  ];

  for (const [x, y, z, scale] of seeds) {
    const lobe = new THREE.Mesh(new THREE.SphereGeometry(scale, 36, 24), lobeMaterial.clone());
    lobe.position.set(x, y, z);
    lobe.scale.set(1.22, 0.58, 0.72);
    lobe.userData.baseY = y;
    lobe.renderOrder = 1;
    group.add(lobe);
  }

  return group;
}

function createMarshmallowDrips(): THREE.Group {
  const group = new THREE.Group();
  const seeds = [
    [-0.38, -0.78, 0.72, 0.16, 0.48, -0.12],
    [0.08, -0.82, 0.88, 0.18, 0.58, 0.06],
    [0.43, -0.68, 0.68, 0.13, 0.38, 0.18],
  ];

  for (const [x, y, z, sx, sy, rot] of seeds) {
    const drip = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), lobeMaterial.clone());
    drip.position.set(x, y, z);
    drip.scale.set(sx, sy, sx * 0.82);
    drip.rotation.z = rot;
    drip.userData.baseY = y;
    drip.userData.baseScaleY = sy;
    drip.renderOrder = 1;
    group.add(drip);
  }

  return group;
}

function createCrackLines(): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.LineBasicMaterial({
    color: 0x0f0504,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const branches = [
    [[-0.05, 0.74], [-0.16, 0.36], [-0.03, 0.08], [-0.22, -0.22], [-0.16, -0.62]],
    [[0.0, 0.52], [0.24, 0.24], [0.15, -0.1], [0.42, -0.34]],
    [[-0.1, 0.18], [-0.44, 0.1], [-0.58, -0.16]],
    [[0.08, -0.04], [0.36, 0.02], [0.62, -0.12]],
  ];

  for (const branch of branches) {
    const points = branch.map(([x, y]) => {
      const z = Math.sqrt(Math.max(0, shellRadius * shellRadius - x * x - y * y));
      return new THREE.Vector3(x, y, z + 0.018);
    });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material.clone());
    line.renderOrder = 4;
    group.add(line);
  }

  return group;
}

function createChocolateCrumbs(): THREE.Group {
  const group = new THREE.Group();
  const crumbMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x6b3525,
    roughness: 0.8,
    metalness: 0.01,
    transparent: true,
    opacity: 0,
  });

  for (let i = 0; i < 26; i += 1) {
    const angle = i * 2.399 + 0.24;
    const band = 0.68 + noise1(i) * 0.36;
    const geometry = new THREE.DodecahedronGeometry(0.025 + noise1(i + 50) * 0.035, 0);
    const crumb = new THREE.Mesh(geometry, crumbMaterial.clone());
    const basePosition = new THREE.Vector3(
      Math.cos(angle) * shellRadius * band,
      Math.sin(angle) * shellRadius * band * 0.74,
      shellRadius * (0.53 + noise1(i + 13) * 0.18),
    );
    crumb.position.copy(basePosition);
    crumb.rotation.set(noise1(i + 2) * Math.PI, noise1(i + 5) * Math.PI, noise1(i + 8) * Math.PI);
    crumb.userData.basePosition = basePosition;
    crumb.userData.breakNormal = basePosition.clone().normalize();
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
  const meltMotion = 0.36 + crackProgress * 0.92;

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
      Math.sin(time * 2.1 + nx * 5.5 + ny * 1.4) * 0.034 * meltMotion +
      Math.sin(time * 1.6 + nz * 4.3 - ny * 2.3) * 0.028 * meltMotion;
    const sag = Math.max(0, -ny) * (0.045 + crackProgress * 0.065);
    const radius = marshmallowRadius + wobble + sag - softDent * press * 0.08;

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

function updateBreakState(time: number): void {
  crackProgress += (crackTarget - crackProgress) * (crackTarget > crackProgress ? 0.045 : 0.08);
  if (Math.abs(crackTarget - crackProgress) < 0.001) {
    crackProgress = crackTarget;
  }

  const reveal = smoothstep(0.08, 0.82, crackProgress);
  const fracture = smoothstep(0.02, 0.36, crackProgress);
  const marshmallowReveal = smoothstep(0.16, 0.78, crackProgress);
  const solidOpacity = 1 - reveal;

  solidChocolateShell.visible = solidOpacity > 0.012;
  solidChocolateMaterial.opacity = solidOpacity;
  solidChocolateMaterial.depthWrite = solidOpacity > 0.18;

  marshmallow.visible = marshmallowReveal > 0.01;
  setObjectOpacity(marshmallow, marshmallowReveal);
  marshmallowLobes.visible = marshmallowReveal > 0.01;
  marshmallowLobes.children.forEach((child) => {
    setObjectOpacity(child, marshmallowReveal * 0.72);
  });
  marshmallowDrips.visible = marshmallowReveal > 0.01;
  marshmallowDrips.children.forEach((child) => {
    setObjectOpacity(child, marshmallowReveal * 0.78);
  });

  shell.visible = reveal > 0.01;
  shell.children.forEach((child) => {
    const mesh = child as THREE.Mesh;
    const normal = mesh.userData.breakNormal as THREE.Vector3 | undefined;
    const breakShift = mesh.userData.breakShift as number | undefined;
    const breakRotation = mesh.userData.breakRotation as THREE.Vector3 | undefined;
    const opacityMax = (mesh.userData.opacityMax as number | undefined) ?? 1;
    setObjectOpacity(mesh, reveal * opacityMax);

    if (normal && breakShift !== undefined && breakRotation) {
      const push = fracture * fracture * breakShift;
      mesh.position.copy(normal).multiplyScalar(push);
      mesh.rotation.set(
        breakRotation.x * fracture,
        breakRotation.y * fracture,
        breakRotation.z * fracture,
      );
    }
  });

  rim.visible = reveal > 0.04;
  rimMaterial.opacity = reveal;
  rim.scale.setScalar(0.9 + reveal * 0.1);

  crumbs.visible = reveal > 0.05;
  crumbs.children.forEach((child, index) => {
    const mesh = child as THREE.Mesh;
    const basePosition = mesh.userData.basePosition as THREE.Vector3;
    const normal = mesh.userData.breakNormal as THREE.Vector3;
    const drift = mesh.userData.drift as number;
    setObjectOpacity(mesh, reveal);
    mesh.position.copy(basePosition).addScaledVector(normal, fracture * (0.14 + drift * 4));
    mesh.position.y += Math.sin(time * 1.2 + index) * 0.01 * reveal;
  });

  crackLines.visible = crackProgress > 0.015 && crackProgress < 0.9;
  const crackOpacity = Math.sin(Math.min(1, crackProgress / 0.9) * Math.PI) * 0.78;
  crackLines.children.forEach((child) => {
    setObjectOpacity(child, crackOpacity);
  });
}

function setObjectOpacity(object: THREE.Object3D, opacity: number): void {
  const material = (object as THREE.Mesh).material as OpacityMaterial | OpacityMaterial[] | undefined;
  if (!material) return;
  const materials = Array.isArray(material) ? material : [material];

  materials.forEach((entry) => {
    entry.transparent = true;
    entry.opacity = opacity;
    entry.depthWrite = opacity > 0.82;
  });
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
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
  crackTarget = 1;
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
  updateBreakState(time);

  const idleRotation = reducedMotion ? 0 : Math.sin(time * 0.32) * 0.12;
  root.rotation.y += ((pointer.x * 0.28 + idleRotation) - root.rotation.y) * 0.035;
  root.rotation.x += ((-pointer.y * 0.16 + Math.sin(time * 0.27) * 0.04) - root.rotation.x) * 0.035;
  root.rotation.z = Math.sin(time * 0.22) * 0.025;

  seam.rotation.z = time * 0.08;
  verticalSeam.rotation.z = -time * 0.06;
  rim.rotation.z = Math.sin(time * 0.28) * 0.035;
  shell.rotation.y = Math.sin(time * 0.18) * 0.025;
  solidChocolateShell.rotation.y = shell.rotation.y;

  marshmallowLobes.children.forEach((child, index) => {
    const mesh = child as THREE.Mesh;
    const baseY = mesh.userData.baseY as number;
    mesh.position.y = baseY + Math.sin(time * 1.8 + index * 1.3) * (0.014 + crackProgress * 0.03);
    mesh.scale.y = 0.54 + crackProgress * 0.1 + Math.sin(time * 2.2 + index) * 0.035;
  });

  marshmallowDrips.children.forEach((child, index) => {
    const mesh = child as THREE.Mesh;
    const baseY = mesh.userData.baseY as number;
    const baseScaleY = mesh.userData.baseScaleY as number;
    mesh.position.y = baseY - crackProgress * (0.035 + index * 0.014);
    mesh.scale.y = baseScaleY * (1 + crackProgress * 0.22 + Math.sin(time * 1.6 + index) * 0.035);
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
