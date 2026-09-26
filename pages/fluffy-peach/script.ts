/// <reference types="vite/client" />
import * as THREE from 'three';
import GUI from 'lil-gui';
import { exposeGuiInDebugMode } from '../../common/debug';
import backgroundFragment from './background.frag?raw';
import bodyFragment from './body.frag?raw';
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
shapePosition.setUsage(THREE.DynamicDrawUsage);
const bodyUniforms = { uCheek: { value: 0 } };
const body = new THREE.Mesh(
  shape,
  new THREE.ShaderMaterial({
    vertexShader: `varying vec3 vLocal; varying vec3 vNormal; void main() { vLocal = position; vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: bodyFragment,
    uniforms: bodyUniforms,
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide,
  }),
);
character.add(body);

// Fibers grow from points on the deforming 3D surface, including its back.
const HAIR_COUNT = 18000;
const hairSeeds = new Float32Array(HAIR_COUNT * 5);
const hairPositions = new Float32Array(HAIR_COUNT * 6);
const hairColors = new Float32Array(HAIR_COUNT * 6);
let randomState = 723981;
function random() {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState / 4294967296;
}
for (let i = 0; i < HAIR_COUNT; i++) {
  const z = random() * 2 - 1;
  const angle = random() * Math.PI * 2;
  const side = Math.sqrt(1 - z * z);
  const x = Math.cos(angle) * side;
  const y = Math.sin(angle) * side;
  const length = (3 + Math.pow(random(), 2) * 14) * (y > 0.2 ? 1.2 : 1);
  const lean = (random() - 0.5) * 0.75;
  hairSeeds.set([x, y, z, length, lean], i * 5);
  let color: [number, number, number] = [0.86, 0.73, 0.91];
  if (x > 0.15) color = [1, 0.78, 0.72];
  if (y > 0.45) color = [1, 0.89, 0.85];
  if (x < -0.4 || y < -0.45) color = [0.66, 0.66, 0.96];
  hairColors.set(color, i * 6);
  hairColors.set(color, i * 6 + 3);
}
const hairGeometry = new THREE.BufferGeometry();
hairGeometry.setAttribute('position', new THREE.BufferAttribute(hairPositions, 3).setUsage(THREE.DynamicDrawUsage));
hairGeometry.setAttribute('color', new THREE.BufferAttribute(hairColors, 3));
const fur = new THREE.LineSegments(hairGeometry, new THREE.LineBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.10,
  depthWrite: false,
}));
character.add(fur);

const eyeMaterial = new THREE.ShaderMaterial({
  vertexShader: `varying vec3 vNormal; void main() { vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `varying vec3 vNormal; void main() { float edge = smoothstep(0.0, 0.67, abs(normalize(vNormal).z)); gl_FragColor = vec4(0.40, 0.39, 0.88, edge * 0.88); }`,
  transparent: true,
  depthWrite: false,
});
const eyes = Array.from({ length: 2 }, () => {
  const eye = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), eyeMaterial);
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
gui.add(controls, 'turnX', -90, 90, 1).name('위아래 회전').onChange(refresh);
gui.add(controls, 'turnY', -180, 180, 1).name('좌우 회전').onChange(refresh);
gui.add(controls, 'turnZ', -180, 180, 1).name('기울기').onChange(refresh);
gui.add(controls, 'paused').name('정지').onChange(refresh);

const currentRadii = new Float32Array(motionFrames[0].radii.length);
let pausedAt = 0;
let cheekStrength = 0;
function radiusAt(x: number, y: number) {
  const theta = (Math.atan2(-y, x) + Math.PI * 2) % (Math.PI * 2);
  const sample = theta * currentRadii.length / (Math.PI * 2) - 0.5;
  const first = ((Math.floor(sample) % currentRadii.length) + currentRadii.length) % currentRadii.length;
  const leftExpansion = THREE.MathUtils.smoothstep(-x, 0.3, 0.95) * 0.10;
  return THREE.MathUtils.lerp(currentRadii[first], currentRadii[(first + 1) % currentRadii.length], sample - Math.floor(sample)) * (0.94 + leftExpansion);
}
function surface(x: number, y: number, z: number, target: Float32Array, offset: number) {
  const radius = radiusAt(x, y);
  target[offset] = x * radius;
  target[offset + 1] = y * radius;
  const lobe = Math.exp(-Math.pow((x - 0.71) / 0.26, 2) - Math.pow((y + 0.38) / 0.38, 2));
  target[offset + 2] = z * 116 + Math.max(0, z) * lobe * cheekStrength * 44;
}
function updateShape() {
  for (let i = 0; i < original.length; i += 3) {
    surface(original[i], original[i + 1], original[i + 2], shapePosition.array as Float32Array, i);
  }
  shapePosition.needsUpdate = true;
  shape.computeVertexNormals();
  for (let i = 0; i < HAIR_COUNT; i++) {
    const seed = i * 5;
    const vertex = i * 6;
    const x = hairSeeds[seed], y = hairSeeds[seed + 1], z = hairSeeds[seed + 2];
    surface(x, y, z, hairPositions, vertex);
    const length = hairSeeds[seed + 3], lean = hairSeeds[seed + 4];
    hairPositions[vertex + 3] = hairPositions[vertex] + x * length + y * lean * length;
    hairPositions[vertex + 4] = hairPositions[vertex + 1] + y * length - x * lean * length;
    hairPositions[vertex + 5] = hairPositions[vertex + 2] + z * length;
  }
  hairGeometry.attributes.position.needsUpdate = true;
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
