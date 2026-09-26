/// <reference types="vite/client" />
import * as THREE from 'three';
import GUI from 'lil-gui';
import { exposeGuiInDebugMode } from '../../common/debug';
import backgroundFragment from './background.frag?raw';
import bodyFragment from './body.frag?raw';
import furRibbonFragment from './fur-ribbon.frag?raw';
import furRibbonVertex from './fur-ribbon.vert?raw';
import furShellFragment from './fur-shell.frag?raw';
import furShellVertex from './fur-shell.vert?raw';
import paletteShader from './palette.glsl?raw';
import { motionFrames } from './motion-data';

const canvas = document.querySelector<HTMLCanvasElement>('#artwork');
if (!canvas) throw new Error('Artwork canvas is missing');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-360, 360, 360, -360, 0.1, 3000);
camera.position.z = 1000;

const shadowUniforms = {
  uShadow: { value: new THREE.Vector2(-75, -191) },
  uShadowScale: { value: 1 },
};
const background = new THREE.Mesh(
  new THREE.PlaneGeometry(3000, 3000),
  new THREE.ShaderMaterial({
    uniforms: shadowUniforms,
    vertexShader: `varying vec2 vWorld; void main() { vWorld = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: backgroundFragment,
    depthWrite: false,
  }),
);
background.position.z = -450;
scene.add(background);

const character = new THREE.Group();
scene.add(character);
const shape = new THREE.SphereGeometry(1, 88, 64);
const original = Float32Array.from(shape.getAttribute('position').array as ArrayLike<number>);
const shapePosition = shape.getAttribute('position') as THREE.BufferAttribute;
const shapeNormal = shape.getAttribute('normal') as THREE.BufferAttribute;
shapePosition.setUsage(THREE.DynamicDrawUsage);
const bodyUniforms = { uCheek: { value: 0 } };
const body = new THREE.Mesh(
  shape,
  new THREE.ShaderMaterial({
    vertexShader: `varying vec3 vLocal; varying vec3 vNormal; void main() { vLocal = position; vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `precision highp float;
${paletteShader}
${bodyFragment}`,
    uniforms: bodyUniforms,
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide,
  }),
);
character.add(body);

// Thin translucent shells fill the volume between the body and visible fiber tips.
const SHELL_COUNT = 13;
const shells = Array.from({ length: SHELL_COUNT }, (_, index) => {
  const layer = index / (SHELL_COUNT - 1);
  const geometry = shape.clone();
  geometry.setAttribute('basePosition', shapePosition);
  geometry.setAttribute('normal', shapeNormal);
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  positions.setUsage(THREE.DynamicDrawUsage);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 300);
  const mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
    vertexShader: `precision highp float;
${paletteShader}
${furShellVertex}`,
    fragmentShader: furShellFragment,
    uniforms: { uCheek: bodyUniforms.uCheek, uLayer: { value: layer } },
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  }));
  mesh.renderOrder = index + 1;
  character.add(mesh);
  return { positions, layer };
});

// Camera-facing tapered ribbons stay legible at the silhouette while rotating.
const FIBER_COUNT = 14000;
const fiberSeeds = new Float32Array(FIBER_COUNT * 5);
const fiberRoots = new Float32Array(FIBER_COUNT * 3);
const fiberTips = new Float32Array(FIBER_COUNT * 3);
const fiberDirections = new Float32Array(FIBER_COUNT * 3);
const fiberWidths = new Float32Array(FIBER_COUNT);
let randomState = 723981;
function random() {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState / 4294967296;
}
for (let i = 0; i < FIBER_COUNT; i++) {
  const z = random() * 2 - 1;
  const angle = random() * Math.PI * 2;
  const side = Math.sqrt(1 - z * z);
  const x = Math.cos(angle) * side;
  const y = Math.sin(angle) * side;
  const length = (7 + Math.pow(random(), 1.15) * 26) * (1 + THREE.MathUtils.smoothstep(y, -0.1, 0.55) * 0.36);
  const lean = (random() - 0.5) * 0.65;
  fiberSeeds.set([x, y, z, length, lean], i * 5);
  fiberDirections.set([x, y, z], i * 3);
  fiberWidths[i] = 0.58 + random() * 0.34;
}
const fiberGeometry = new THREE.InstancedBufferGeometry();
const fiberStations = [0, 0.22, 0.48, 0.73, 1];
const fiberVertices = fiberStations.flatMap((along) => [-1, along, 0, 1, along, 0]);
const fiberIndices = fiberStations.slice(1).flatMap((_, station) => {
  const start = station * 2;
  return [start, start + 1, start + 2, start + 2, start + 1, start + 3];
});
fiberGeometry.setIndex(fiberIndices);
fiberGeometry.setAttribute('position', new THREE.Float32BufferAttribute(fiberVertices, 3));
const fiberRootAttribute = new THREE.InstancedBufferAttribute(fiberRoots, 3).setUsage(THREE.DynamicDrawUsage);
const fiberTipAttribute = new THREE.InstancedBufferAttribute(fiberTips, 3).setUsage(THREE.DynamicDrawUsage);
fiberGeometry.setAttribute('instanceRoot', fiberRootAttribute);
fiberGeometry.setAttribute('instanceTip', fiberTipAttribute);
fiberGeometry.setAttribute('instanceDirection', new THREE.InstancedBufferAttribute(fiberDirections, 3));
fiberGeometry.setAttribute('instanceWidth', new THREE.InstancedBufferAttribute(fiberWidths, 1));
fiberGeometry.instanceCount = FIBER_COUNT;
fiberGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 300);
const fur = new THREE.Mesh(fiberGeometry, new THREE.ShaderMaterial({
  vertexShader: `precision highp float;
${paletteShader}
${furRibbonVertex}`,
  fragmentShader: furRibbonFragment,
  uniforms: bodyUniforms,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
}));
fur.renderOrder = SHELL_COUNT + 1;
character.add(fur);

const eyeMaterial = new THREE.ShaderMaterial({
  vertexShader: `varying vec3 vNormal; void main() { vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `varying vec3 vNormal; void main() { float edge = smoothstep(0.0, 0.67, abs(normalize(vNormal).z)); gl_FragColor = vec4(0.40, 0.39, 0.88, edge * 0.88); }`,
  transparent: true,
  depthWrite: false,
});
const eyes = Array.from({ length: 2 }, () => {
  const eye = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), eyeMaterial);
  eye.renderOrder = SHELL_COUNT + 2;
  character.add(eye);
  return eye;
});

const params = new URLSearchParams(location.search);
const queryTime = Number(params.get('t'));
const frozenTime = params.has('t') && Number.isFinite(queryTime) ? Math.max(0, queryTime) : null;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const startTime = performance.now();
const controls = { turnX: 0, turnY: 0, turnZ: 0, paused: false };
const gui = exposeGuiInDebugMode(new GUI({ title: 'Fluffy Peach · 3D' }));
const refresh = () => { if (frozenTime !== null || reduceMotion) requestAnimationFrame(render); };
gui.add(controls, 'turnX', -90, 90, 1).name('위아래 회전').listen().onChange(refresh);
gui.add(controls, 'turnY', -180, 180, 1).name('좌우 회전').listen().onChange(refresh);
gui.add(controls, 'turnZ', -180, 180, 1).name('기울기').onChange(refresh);
gui.add(controls, 'paused').name('정지').onChange(refresh);

let dragging: { pointerId: number; x: number; y: number; pitch: number; yaw: number } | null = null;
canvas.addEventListener('pointerdown', (event) => {
  if (dragging || (event.pointerType === 'mouse' && event.button !== 0)) return;
  dragging = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    pitch: controls.turnX,
    yaw: controls.turnY,
  };
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', (event) => {
  if (!dragging || event.pointerId !== dragging.pointerId) return;
  const unit = Math.min(canvas.clientWidth, canvas.clientHeight) / 720;
  const dx = (event.clientX - dragging.x) / unit;
  const dy = (event.clientY - dragging.y) / unit;
  controls.turnX = THREE.MathUtils.clamp(dragging.pitch + dy * 0.38, -90, 90);
  controls.turnY = ((dragging.yaw + dx * 0.5 + 180) % 360 + 360) % 360 - 180;
  refresh();
});
function stopDragging(event: PointerEvent) {
  if (!dragging || event.pointerId !== dragging.pointerId) return;
  dragging = null;
  canvas!.classList.remove('dragging');
  if (canvas!.hasPointerCapture(event.pointerId)) canvas!.releasePointerCapture(event.pointerId);
}
canvas.addEventListener('pointerup', stopDragging);
canvas.addEventListener('pointercancel', stopDragging);
canvas.addEventListener('lostpointercapture', stopDragging);

const currentRadii = new Float32Array(motionFrames[0].radii.length);
let meanRadius = 135;
let sideRoundness = 0;
let pausedAt = 0;
let cheekStrength = 0;
function radiusAt(x: number, y: number) {
  const theta = (Math.atan2(-y, x) + Math.PI * 2) % (Math.PI * 2);
  const sample = theta * currentRadii.length / (Math.PI * 2) - 0.5;
  const first = ((Math.floor(sample) % currentRadii.length) + currentRadii.length) % currentRadii.length;
  const leftExpansion = THREE.MathUtils.smoothstep(-x, 0.3, 0.95) * 0.10;
  const contour = THREE.MathUtils.lerp(currentRadii[first], currentRadii[(first + 1) % currentRadii.length], sample - Math.floor(sample)) * (0.94 + leftExpansion);
  return THREE.MathUtils.lerp(contour, meanRadius, sideRoundness);
}
function surface(x: number, y: number, z: number, target: Float32Array, offset: number) {
  const radius = radiusAt(x, y);
  target[offset] = x * radius;
  target[offset + 1] = y * radius;
  const lobe = Math.exp(-Math.pow((x - 0.71) / 0.26, 2) - Math.pow((y + 0.38) / 0.38, 2));
  target[offset + 2] = z * 116 + Math.max(0, z) * lobe * cheekStrength * 44;
}
function updateShape() {
  const bodyPositions = shapePosition.array as Float32Array;
  for (let i = 0; i < original.length; i += 3) {
    surface(original[i], original[i + 1], original[i + 2], bodyPositions, i);
  }
  shapePosition.needsUpdate = true;
  shape.computeVertexNormals();
  for (const shell of shells) {
    const offset = 0.5 + 26 * Math.pow(shell.layer, 1.3);
    const positions = shell.positions.array as Float32Array;
    for (let i = 0; i < original.length; i++) {
      positions[i] = bodyPositions[i] + original[i] * offset;
    }
    shell.positions.needsUpdate = true;
  }
  for (let i = 0; i < FIBER_COUNT; i++) {
    const seed = i * 5;
    const vertex = i * 3;
    const x = fiberSeeds[seed], y = fiberSeeds[seed + 1], z = fiberSeeds[seed + 2];
    surface(x, y, z, fiberRoots, vertex);
    fiberRoots[vertex] -= x * 1.5;
    fiberRoots[vertex + 1] -= y * 1.5;
    fiberRoots[vertex + 2] -= z * 1.5;
    const length = fiberSeeds[seed + 3], lean = fiberSeeds[seed + 4];
    fiberTips[vertex] = fiberRoots[vertex] + x * length + y * lean * length;
    fiberTips[vertex + 1] = fiberRoots[vertex + 1] + y * length - x * lean * length;
    fiberTips[vertex + 2] = fiberRoots[vertex + 2] + z * length;
  }
  fiberRootAttribute.needsUpdate = true;
  fiberTipAttribute.needsUpdate = true;
}

function render(now: number) {
  if (!controls.paused) pausedAt = now;
  const seconds = frozenTime ?? (reduceMotion ? 2.25 : (pausedAt - startTime) / 1000);
  const frame = ((seconds * 24) % motionFrames.length + motionFrames.length) % motionFrames.length;
  const a = Math.floor(frame), b = (a + 1) % motionFrames.length, fraction = frame - a;
  const first = motionFrames[a], second = motionFrames[b];
  const lerp = (one: number, two: number) => THREE.MathUtils.lerp(one, two, fraction);
  cheekStrength = THREE.MathUtils.smoothstep(frame, 45, 76);
  bodyUniforms.uCheek.value = cheekStrength;
  for (let i = 0; i < currentRadii.length; i++) currentRadii[i] = lerp(first.radii[i], second.radii[i]);
  meanRadius = currentRadii.reduce((sum, value) => sum + value, 0) / currentRadii.length;
  // The clip only defines a front contour; round its hidden side profile during a turn.
  sideRoundness = THREE.MathUtils.smoothstep(Math.abs(Math.sin(THREE.MathUtils.degToRad(controls.turnY))), 0.15, 0.75) * 0.85;
  updateShape();

  const cx = lerp(first.center[0], second.center[0]);
  const cy = lerp(first.center[1], second.center[1]);
  character.position.set(cx - 360, 360 - cy, 0);
  character.rotation.set(
    THREE.MathUtils.degToRad(controls.turnX),
    THREE.MathUtils.degToRad(controls.turnY),
    THREE.MathUtils.degToRad(controls.turnZ),
  );
  for (let i = 0; i < 2; i++) {
    const ex = lerp(first.eyes[i * 2], second.eyes[i * 2]) - cx;
    const openness = lerp(first.eyes[4], second.eyes[4]);
    const ey = cy - lerp(first.eyes[i * 2 + 1], second.eyes[i * 2 + 1]) - (1 - openness) * 11;
    const proportion = Math.min(0.98, Math.hypot(ex, ey) / radiusAt(ex, ey));
    const depth = Math.sqrt(1 - proportion * proportion) * 116;
    eyes[i].position.set(ex, ey, depth + 1);
    eyes[i].scale.set(4.9, Math.max(1.4, 9.3 * openness), 2.1);
  }
  shadowUniforms.uShadow.value.set(cx - 465, -191);
  shadowUniforms.uShadowScale.value = 0.94 + Math.max(0, cy - 350) * 0.0012;
  renderer.render(scene, camera);
  if (frozenTime === null && !reduceMotion) requestAnimationFrame(render);
}
function resize() {
  const width = Math.max(1, innerWidth), height = Math.max(1, innerHeight);
  const unit = Math.min(width, height) / 720;
  canvas!.style.setProperty('--artwork-blur', `${(1.6 * unit).toFixed(2)}px`);
  camera.left = -width / (2 * unit);
  camera.right = width / (2 * unit);
  camera.top = height / (2 * unit);
  camera.bottom = -height / (2 * unit);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  if (frozenTime !== null || reduceMotion) render(performance.now());
}
addEventListener('resize', resize);
new ResizeObserver(resize).observe(canvas);
resize();
requestAnimationFrame(render);
