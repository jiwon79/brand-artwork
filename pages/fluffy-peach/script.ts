/// <reference types="vite/client" />
import * as THREE from 'three';
import GUI from 'lil-gui';
import { exposeGuiInDebugMode } from '../../common/debug';
import { boneDefinitions, BoneRig } from './bone-rig';
import { fitBoneFrames } from './bone-animation';
import backgroundFragment from './background.frag?raw';
import bodyFragment from './body.frag?raw';
import furRibbonFragment from './fur-ribbon.frag?raw';
import furRibbonVertex from './fur-ribbon.vert?raw';
import furShellFragment from './fur-shell.frag?raw';
import furShellVertex from './fur-shell.vert?raw';
import paletteShader from './palette.glsl?raw';
import { motionFrames } from './motion-data';
import { MOTION_FPS } from './motion-editor';
import { MotionEditor } from './motion-editor-ui';
import { loopFrame, variantGesture } from './motion-loop';
import { shapeFactor, variants, type VariantColors } from './variants';

const params = new URLSearchParams(location.search);
const shapeAliases: Record<string, string> = { drop: 'flower', cloud: 'wave' };
const requestedShape = shapeAliases[params.get('shape') ?? ''] ?? params.get('shape');
const requestedVariant = variants.findIndex((variant) => variant.id === requestedShape);
let targetVariant = requestedVariant >= 0 ? requestedVariant : 3;
const variantWeights = variants.map((_, index) => Number(index === targetVariant));
const colorChannels: readonly (keyof VariantColors)[] = [
  'base', 'cool', 'blush', 'warm', 'highlight', 'bottom', 'detail', 'furTip',
  'backgroundTop', 'backgroundBottom', 'shadow', 'eye',
];
function hexVector(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return new THREE.Vector3((value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}
const paletteVectors = variants.map((variant) => Object.fromEntries(
  colorChannels.map((channel) => [channel, hexVector(variant.colors[channel])]),
) as Record<keyof VariantColors, THREE.Vector3>);
const selectedColors = paletteVectors[targetVariant];
const paletteUniforms = {
  uBaseColor: { value: selectedColors.base.clone() },
  uCoolColor: { value: selectedColors.cool.clone() },
  uBlushColor: { value: selectedColors.blush.clone() },
  uWarmColor: { value: selectedColors.warm.clone() },
  uHighlightColor: { value: selectedColors.highlight.clone() },
  uBottomColor: { value: selectedColors.bottom.clone() },
  uDetailColor: { value: selectedColors.detail.clone() },
  uFurTipColor: { value: selectedColors.furTip.clone() },
  uBackgroundTop: { value: selectedColors.backgroundTop.clone() },
  uBackgroundBottom: { value: selectedColors.backgroundBottom.clone() },
  uShadowColor: { value: selectedColors.shadow.clone() },
  uEyeColor: { value: selectedColors.eye.clone() },
};
const variantFactors = variants.map((variant) => Float32Array.from(
  motionFrames[0].radii,
  (_, index) => shapeFactor(variant.id, -(index + 0.5) * Math.PI * 2 / motionFrames[0].radii.length),
));
const currentFactors = new Float32Array(motionFrames[0].radii.length);
const currentMotionFactors = new Float32Array(currentFactors.length);
function tipMask(angle: number, tip: number) {
  const distance = Math.atan2(Math.sin(angle - tip), Math.cos(angle - tip));
  return Math.exp(-Math.pow(distance / 0.4, 2));
}
const angularSamples = Float32Array.from(motionFrames[0].radii,
  (_, index) => -(index + 0.5) * Math.PI * 2 / motionFrames[0].radii.length);
const starMotionMask = angularSamples.map((angle) => [
  [Math.PI * 0.1, 0.16],
  [Math.PI * 0.5, 0.15],
  [Math.PI * 0.9, 0.16],
  [Math.PI * 1.3, 0.15],
  [Math.PI * 1.7, 0.16],
].reduce((sum, [tip, strength]) => sum + strength * tipMask(angle, tip), -0.055));
const flowerMotionMask = angularSamples.map((angle) => Math.cos(4 * angle - Math.PI));
const restingFrame = motionFrames[Math.floor(motionFrames.length / 2)];
const referenceWidths = motionFrames.map((frame) => frame.radii[0] + frame.radii[frame.radii.length / 2]);
const baselineRadii = Float32Array.from(motionFrames[0].radii, (_, point) =>
  motionFrames.reduce((sum, frame) => sum + frame.radii[point], 0) / motionFrames.length);
const baselineMean = baselineRadii.reduce((sum, radius) => sum + radius, 0) / baselineRadii.length;
const boneRig = new BoneRig();
const boneAnimationFrames = fitBoneFrames(motionFrames.map((frame) => frame.radii));
let bodyBoneWeights: Float32Array | null = null;
let fiberBoneWeights: Float32Array | null = null;
let bodyRestPositions: Float32Array | null = null;
let fiberRestPositions: Float32Array | null = null;
let bodyCheekWeights: Float32Array | null = null;
let fiberCheekWeights: Float32Array | null = null;
let boneRigActive = false;

function blendColor(target: THREE.Vector3, channel: keyof VariantColors) {
  target.set(0, 0, 0);
  for (let index = 0; index < variants.length; index++) {
    target.addScaledVector(paletteVectors[index][channel], variantWeights[index]);
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#artwork');
if (!canvas) throw new Error('Artwork canvas is missing');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
const scene = new THREE.Scene();
const meshBackdrop = new THREE.Color('#1b2635');
const camera = new THREE.OrthographicCamera(-360, 360, 360, -360, 0.1, 3000);
camera.position.z = 1000;
scene.add(new THREE.AmbientLight(0xcbd9e9, 1.1));
const meshLight = new THREE.DirectionalLight(0xffffff, 2);
meshLight.position.set(-260, 300, 700);
scene.add(meshLight);

const shadowUniforms = {
  uShadow: { value: new THREE.Vector2(-75, -191) },
  uShadowScale: { value: 1 },
  ...paletteUniforms,
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
const bodyUniforms = { uCheek: { value: 0 }, uStarSoftness: { value: 0 }, ...paletteUniforms };
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
// The inspection view shares the deforming geometry with the finished body.
const meshSurface = new THREE.Mesh(shape, new THREE.MeshPhongMaterial({
  color: 0xa7bacb,
  specular: 0x52677b,
  shininess: 28,
  side: THREE.DoubleSide,
}));
const meshWire = new THREE.Mesh(shape, new THREE.MeshBasicMaterial({
  color: 0x284052,
  wireframe: true,
  transparent: true,
  opacity: 0.66,
  depthWrite: false,
}));
meshWire.scale.setScalar(1.003);
meshSurface.add(meshWire);
meshSurface.visible = false;
character.add(meshSurface);

// The source rays are drawn in a front-facing measurement plane. Their lengths
// are the original 720px-reference distances, before any variant deformation.
const contourGuides = new THREE.Group();
const rayPositions = new Float32Array(64 * 2 * 3);
const outlinePositions = new Float32Array(64 * 3);
const rayGeometry = new THREE.BufferGeometry();
const outlineGeometry = new THREE.BufferGeometry();
for (const [geometry, positions] of [
  [rayGeometry, rayPositions], [outlineGeometry, outlinePositions],
] as const) {
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
}
const rayGuides = new THREE.LineSegments(rayGeometry, new THREE.LineBasicMaterial({
  color: 0x81d8d2, transparent: true, opacity: 0.28, depthTest: false, depthWrite: false,
}));
const outlineGuide = new THREE.LineLoop(outlineGeometry, new THREE.LineBasicMaterial({
  color: 0x88e2d9, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false,
}));
const selectedRayGuide = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 1, 8), new THREE.MeshBasicMaterial({
  color: 0xffc392, depthTest: false, depthWrite: false,
}));
const selectedEndpoint = new THREE.Mesh(new THREE.SphereGeometry(5.5, 12, 8), selectedRayGuide.material);
const contourCenter = new THREE.Mesh(new THREE.CircleGeometry(3, 20), new THREE.MeshBasicMaterial({
  color: 0xffd6ad, depthTest: false, depthWrite: false,
}));
for (const guide of [rayGuides, outlineGuide, selectedRayGuide, selectedEndpoint, contourCenter]) {
  guide.renderOrder = 20;
  contourGuides.add(guide);
}
contourGuides.visible = false;
character.add(contourGuides);

const boneGuides = new THREE.Group();
const boneLinks = boneDefinitions.slice(1).map(() => {
  const link = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 1, 8), new THREE.MeshBasicMaterial({
    color: 0xffd4a6, depthTest: false, depthWrite: false,
  }));
  link.renderOrder = 21;
  boneGuides.add(link);
  return link;
});
const boneJoints = boneDefinitions.map((_, index) => {
  const marker = new THREE.Mesh(new THREE.SphereGeometry(index === 0 ? 6 : 5, 12, 8), new THREE.MeshBasicMaterial({
    color: index === 0 ? 0xffefcb : 0xffad81, depthTest: false, depthWrite: false,
  }));
  marker.renderOrder = 22;
  boneGuides.add(marker);
  return marker;
});
const boneAxes = boneDefinitions.map(() => {
  const axis = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 22, 6), new THREE.MeshBasicMaterial({
    color: 0xffc088, depthTest: false, depthWrite: false,
  }));
  axis.renderOrder = 23;
  boneGuides.add(axis);
  return axis;
});
boneGuides.visible = false;
character.add(boneGuides);

const boneReferencePositions = new Float32Array(64 * 3);
const boneReferenceGeometry = new THREE.BufferGeometry();
boneReferenceGeometry.setAttribute('position', new THREE.BufferAttribute(boneReferencePositions, 3).setUsage(THREE.DynamicDrawUsage));
const boneReference = new THREE.LineLoop(boneReferenceGeometry, new THREE.LineBasicMaterial({
  color: 0x72ffe1, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95,
}));
boneReference.renderOrder = 24;
boneReference.visible = false;
character.add(boneReference);

function updateBoneGuides() {
  const [rootX, rootY] = boneRig.jointPosition(0);
  for (let index = 0; index < boneDefinitions.length; index++) {
    const [x, y] = boneRig.jointPosition(index);
    boneJoints[index].position.set(x, y, 0);
    const selected = index === editor.selectedBoneIndex;
    boneJoints[index].material.color.setHex(selected ? 0xffffff : 0xffad81);
    boneJoints[index].scale.setScalar(selected ? 1.5 : 1);
    const angle = Math.atan2(boneDefinitions[index].y, boneDefinitions[index].x) + boneRig.poses[index].angle;
    boneAxes[index].position.set(x + Math.cos(angle) * 11, y + Math.sin(angle) * 11, 0);
    boneAxes[index].rotation.z = angle - Math.PI / 2;
    boneAxes[index].material.color.setHex(selected ? 0xffffff : 0xffc088);
    if (index > 0) {
      const link = boneLinks[index - 1];
      link.position.set((x + rootX) / 2, (y + rootY) / 2, 0);
      link.scale.y = Math.hypot(x - rootX, y - rootY);
      link.rotation.z = Math.atan2(y - rootY, x - rootX) - Math.PI / 2;
    }
  }
}

function updateContourGuides(selected: number) {
  for (let index = 0; index < currentRadii.length; index++) {
    const angle = angularSamples[index];
    const x = Math.cos(angle) * currentRadii[index];
    const y = Math.sin(angle) * currentRadii[index];
    rayPositions.set([0, 0, 150, x, y, 150], index * 6);
    outlinePositions.set([x, y, 150], index * 3);
  }
  const angle = angularSamples[selected];
  const length = currentRadii[selected];
  const endX = Math.cos(angle) * length, endY = Math.sin(angle) * length;
  selectedRayGuide.position.set(endX / 2, endY / 2, 155);
  selectedRayGuide.scale.y = length;
  selectedRayGuide.rotation.z = angle - Math.PI / 2;
  selectedEndpoint.position.set(endX, endY, 155);
  rayGeometry.getAttribute('position').needsUpdate = true;
  outlineGeometry.getAttribute('position').needsUpdate = true;
}

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
    uniforms: { ...bodyUniforms, uLayer: { value: layer } },
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  }));
  mesh.renderOrder = index + 1;
  character.add(mesh);
  return { mesh, positions, layer };
});

// Camera-facing tapered ribbons stay legible at the silhouette while rotating.
const FIBER_COUNT = 23000;
const fiberSeeds = new Float32Array(FIBER_COUNT * 5);
const fiberRoots = new Float32Array(FIBER_COUNT * 3);
const fiberTips = new Float32Array(FIBER_COUNT * 3);
const fiberDirections = new Float32Array(FIBER_COUNT * 3);
const fiberWidths = new Float32Array(FIBER_COUNT);
const fiberBends = new Float32Array(FIBER_COUNT);
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
  const guardHair = random() < 0.17;
  const length = (guardHair ? 16 + Math.pow(random(), 1.1) * 15 : 7 + Math.pow(random(), 0.7) * 17)
    * (1 + THREE.MathUtils.smoothstep(y, -0.1, 0.55) * 0.26) * 1.09;
  const lean = (random() - 0.5) * 0.82;
  fiberSeeds.set([x, y, z, length, lean], i * 5);
  fiberDirections.set([x, y, z], i * 3);
  fiberWidths[i] = 0.49 + random() * 0.28;
  fiberBends[i] = (random() - 0.5) * 4.5 * Math.min(1, length / 25);
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
fiberGeometry.setAttribute('instanceBend', new THREE.InstancedBufferAttribute(fiberBends, 1));
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
  fragmentShader: `uniform vec3 uEyeColor; varying vec3 vNormal; void main() { float edge = smoothstep(0.0, 0.67, abs(normalize(vNormal).z)); gl_FragColor = vec4(uEyeColor, edge * 0.88); }`,
  uniforms: { uEyeColor: paletteUniforms.uEyeColor },
  transparent: true,
  depthWrite: false,
});
const eyes = Array.from({ length: 2 }, () => {
  const eye = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), eyeMaterial);
  eye.renderOrder = SHELL_COUNT + 2;
  character.add(eye);
  return eye;
});
const eyePosition = new Float32Array(3);

const queryTime = Number(params.get('t'));
const frozenTime = params.has('t') && Number.isFinite(queryTime) ? Math.max(0, queryTime) : null;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let startTime = performance.now();
const controls = { turnX: 0, turnY: 0, turnZ: 0, paused: false };
const gui = exposeGuiInDebugMode(new GUI({ title: 'Fluffy Peach · 3D' }));
let editor: MotionEditor;
let frameRequested = false;
function refresh() {
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(render);
}
const variantButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#variant-picker button'));
function selectVariant(index: number) {
  targetVariant = index;
  for (const button of variantButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.variant === variants[index].id));
  }
  document.body.style.backgroundColor = variants[index].colors.backgroundTop;
  const url = new URL(location.href);
  url.searchParams.set('shape', variants[index].id);
  history.replaceState(null, '', url);
  editor?.setShape(variants[index].id);
  refresh();
}
for (const button of variantButtons) {
  const index = variants.findIndex((variant) => variant.id === button.dataset.variant);
  if (index >= 0) button.addEventListener('click', () => selectVariant(index));
}
for (const button of variantButtons) {
  button.setAttribute('aria-pressed', String(button.dataset.variant === variants[targetVariant].id));
}
document.body.style.backgroundColor = variants[targetVariant].colors.backgroundTop;
gui.add(controls, 'turnX', -90, 90, 1).name('위아래 회전').listen().onChange(refresh);
gui.add(controls, 'turnY', -180, 180, 1).name('좌우 회전').listen().onChange(refresh);
gui.add(controls, 'turnZ', -180, 180, 1).name('기울기').onChange(refresh);
gui.add(controls, 'paused').name('정지').onChange(refresh);
editor = new MotionEditor({
  frameCount: motionFrames.length,
  referenceWidths,
  contourFrames: motionFrames.map((frame) => frame.radii),
  boneFrames: boneAnimationFrames,
  shape: variants[targetVariant].id,
  initialSeconds: frozenTime ?? 0,
  readCurrentSeconds: () => frozenTime ?? Math.max(0, (pausedAt - startTime) / 1000),
  onClose: (seconds) => {
    const now = performance.now();
    startTime = now - seconds * 1000;
    pausedAt = now;
  },
  onChange: refresh,
});

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
const bonePicker = new THREE.Raycaster();
function stopDragging(event: PointerEvent) {
  if (!dragging || event.pointerId !== dragging.pointerId) return;
  if (event.type === 'pointerup' && editor.showingMesh && editor.showingBones && !editor.comparing
    && Math.hypot(event.clientX - dragging.x, event.clientY - dragging.y) < 5) {
    const bounds = canvas!.getBoundingClientRect();
    bonePicker.setFromCamera(new THREE.Vector2(
      (event.clientX - bounds.left) / bounds.width * 2 - 1,
      -(event.clientY - bounds.top) / bounds.height * 2 + 1,
    ), camera);
    const hit = bonePicker.intersectObjects(boneJoints)[0];
    if (hit) editor.selectBone(boneJoints.indexOf(hit.object as typeof boneJoints[number]));
  }
  dragging = null;
  canvas!.classList.remove('dragging');
  if (canvas!.hasPointerCapture(event.pointerId)) canvas!.releasePointerCapture(event.pointerId);
}
canvas.addEventListener('pointerup', stopDragging);
canvas.addEventListener('pointercancel', stopDragging);
canvas.addEventListener('lostpointercapture', stopDragging);

const currentRadii = new Float32Array(motionFrames[0].radii.length);
let meanRadius = baselineMean;
let pausedAt = 0;
let cheekStrength = 0;
let lastRenderTime = performance.now();
let currentReferenceDetail = 1;
let currentFlutter = 1;
let currentWaveWeight = 0;
let gesture = 0;
let currentDepth = 1;
let currentEyeShiftX = 0;
let currentEyeShiftY = 0;
function radiusAt(x: number, y: number) {
  const theta = (Math.atan2(-y, x) + Math.PI * 2) % (Math.PI * 2);
  const sample = theta * currentRadii.length / (Math.PI * 2) - 0.5;
  const first = ((Math.floor(sample) % currentRadii.length) + currentRadii.length) % currentRadii.length;
  const leftExpansion = THREE.MathUtils.smoothstep(-x, 0.3, 0.95) * 0.10;
  const fraction = sample - Math.floor(sample);
  const contour = THREE.MathUtils.lerp(currentRadii[first], currentRadii[(first + 1) % currentRadii.length], fraction) * (0.94 + leftExpansion);
  const baselineContour = THREE.MathUtils.lerp(baselineRadii[first], baselineRadii[(first + 1) % baselineRadii.length], fraction) * (0.94 + leftExpansion);
  // Fade measured contour variation toward the poles in object space; rotation does not alter the contour.
  const poleBlend = Math.pow(Math.min(1, Math.hypot(x, y)), 0.7);
  const globalBreath = currentFlutter * (meanRadius - baselineMean);
  const localFlutter = currentFlutter * (contour - baselineContour - (meanRadius - baselineMean));
  const animated = baselineMean + globalBreath
    + poleBlend * (currentReferenceDetail * (baselineContour - baselineMean) + localFlutter);
  const factor = THREE.MathUtils.lerp(currentMotionFactors[first], currentMotionFactors[(first + 1) % currentMotionFactors.length], fraction);
  return animated * factor;
}
function restRadiusAt(x: number, y: number) {
  const theta = (Math.atan2(-y, x) + Math.PI * 2) % (Math.PI * 2);
  const sample = theta * baselineRadii.length / (Math.PI * 2) - 0.5;
  const first = ((Math.floor(sample) % baselineRadii.length) + baselineRadii.length) % baselineRadii.length;
  const fraction = sample - Math.floor(sample);
  const leftExpansion = THREE.MathUtils.smoothstep(-x, 0.3, 0.95) * 0.10;
  const contour = THREE.MathUtils.lerp(baselineRadii[first], baselineRadii[(first + 1) % baselineRadii.length], fraction)
    * (0.94 + leftExpansion);
  const poleBlend = Math.pow(Math.min(1, Math.hypot(x, y)), 0.7);
  return baselineMean + poleBlend * (contour - baselineMean);
}
function ensureBoneWeights() {
  if (bodyBoneWeights && fiberBoneWeights) return;
  bodyBoneWeights = new Float32Array(original.length / 3 * boneDefinitions.length);
  bodyRestPositions = new Float32Array(original.length);
  bodyCheekWeights = new Float32Array(original.length / 3);
  for (let vertex = 0; vertex < original.length / 3; vertex++) {
    const x = original[vertex * 3], y = original[vertex * 3 + 1], z = original[vertex * 3 + 2];
    const radius = restRadiusAt(x, y);
    bodyBoneWeights.set(boneRig.weightsFor(x * radius, y * radius), vertex * boneDefinitions.length);
    bodyRestPositions.set([x * radius, y * radius, z * 116], vertex * 3);
    bodyCheekWeights[vertex] = Math.max(0, z)
      * Math.exp(-Math.pow((x - 0.71) / 0.26, 2) - Math.pow((y + 0.38) / 0.38, 2)) * 44;
  }
  fiberBoneWeights = new Float32Array(FIBER_COUNT * boneDefinitions.length);
  fiberRestPositions = new Float32Array(FIBER_COUNT * 3);
  fiberCheekWeights = new Float32Array(FIBER_COUNT);
  for (let fiber = 0; fiber < FIBER_COUNT; fiber++) {
    const x = fiberSeeds[fiber * 5], y = fiberSeeds[fiber * 5 + 1], z = fiberSeeds[fiber * 5 + 2];
    const radius = restRadiusAt(x, y);
    fiberBoneWeights.set(boneRig.weightsFor(x * radius, y * radius), fiber * boneDefinitions.length);
    fiberRestPositions.set([x * (radius - 1.5), y * (radius - 1.5), z * (116 - 1.5)], fiber * 3);
    fiberCheekWeights[fiber] = Math.max(0, z)
      * Math.exp(-Math.pow((x - 0.71) / 0.26, 2) - Math.pow((y + 0.38) / 0.38, 2)) * 44;
  }
}
function waveBend(x: number) {
  return 16 * x + 4 * Math.sin(5.6 * x + 0.7);
}
function waveCrest(x: number, y: number) {
  return Math.exp(-Math.pow((x - 0.59) / 0.26, 2) - Math.pow((y - 0.74) / 0.26, 2));
}
function surface(x: number, y: number, z: number, target: Float32Array, offset: number) {
  if (boneRigActive) {
    const radius = restRadiusAt(x, y);
    const restX = x * radius, restY = y * radius;
    const lobe = Math.exp(-Math.pow((x - 0.71) / 0.26, 2) - Math.pow((y + 0.38) / 0.38, 2));
    const restZ = z * 116 + Math.max(0, z) * lobe * cheekStrength * 44;
    boneRig.skinPoint(restX, restY, restZ, boneRig.weightsFor(restX, restY), target, offset);
    return;
  }
  const radius = radiusAt(x, y);
  const crest = currentWaveWeight * waveCrest(x, y) * (1 + 0.35 * gesture);
  const beanStretch = variantWeights[1] * gesture;
  const starFlex = variantWeights[3] * gesture;
  target[offset] = (x * radius - 80 * crest) * (1 + 0.16 * beanStretch) + 22 * starFlex * y;
  target[offset + 1] = y * radius * (1 - 0.08 * beanStretch)
    + currentWaveWeight * waveBend(x) + 50 * crest + 16 * starFlex * x;
  const lobe = Math.exp(-Math.pow((x - 0.71) / 0.26, 2) - Math.pow((y + 0.38) / 0.38, 2));
  target[offset + 2] = z * 116 * currentDepth * (1 - 0.06 * beanStretch)
    + Math.max(0, z) * lobe * cheekStrength * 44 * currentReferenceDetail;
}
function updateShape(meshOnly: boolean) {
  const bodyPositions = shapePosition.array as Float32Array;
  for (let i = 0; i < original.length; i += 3) {
    if (boneRigActive && bodyRestPositions && bodyBoneWeights && bodyCheekWeights) {
      boneRig.skinPoint(bodyRestPositions[i], bodyRestPositions[i + 1],
        bodyRestPositions[i + 2] + cheekStrength * bodyCheekWeights[i / 3],
        bodyBoneWeights, bodyPositions, i, i / 3 * boneDefinitions.length);
    } else {
      surface(original[i], original[i + 1], original[i + 2], bodyPositions, i);
    }
  }
  shapePosition.needsUpdate = true;
  shape.computeVertexNormals();
  if (meshOnly) return;
  for (const shell of shells) {
    const offset = 0.5 + 29 * Math.pow(shell.layer, 1.3);
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
    const length = fiberSeeds[seed + 3], lean = fiberSeeds[seed + 4];
    if (boneRigActive && fiberBoneWeights && fiberRestPositions && fiberCheekWeights) {
      const restX = fiberRestPositions[vertex], restY = fiberRestPositions[vertex + 1];
      const restZ = fiberRestPositions[vertex + 2] + cheekStrength * fiberCheekWeights[i];
      const weightOffset = i * boneDefinitions.length;
      boneRig.skinPoint(restX, restY, restZ, fiberBoneWeights, fiberRoots, vertex, weightOffset);
      boneRig.skinPoint(restX + x * length + y * lean * length,
        restY + y * length - x * lean * length, restZ + z * length,
        fiberBoneWeights, fiberTips, vertex, weightOffset);
    } else {
      surface(x, y, z, fiberRoots, vertex);
      fiberRoots[vertex] -= x * 1.5;
      fiberRoots[vertex + 1] -= y * 1.5;
      fiberRoots[vertex + 2] -= z * 1.5;
      fiberTips[vertex] = fiberRoots[vertex] + x * length + y * lean * length;
      fiberTips[vertex + 1] = fiberRoots[vertex + 1] + y * length - x * lean * length;
      fiberTips[vertex + 2] = fiberRoots[vertex + 2] + z * length;
    }
  }
  fiberRootAttribute.needsUpdate = true;
  fiberTipAttribute.needsUpdate = true;
}

function render(now: number) {
  frameRequested = false;
  const delta = Math.min(Math.max(now - lastRenderTime, 0) / 1000, 0.05);
  lastRenderTime = now;
  editor.advance(delta);
  const morphStep = reduceMotion ? 1 : 1 - Math.exp(-delta * 7);
  let morphing = false;
  for (let index = 0; index < variants.length; index++) {
    const target = Number(index === targetVariant);
    variantWeights[index] += (target - variantWeights[index]) * morphStep;
    if (Math.abs(variantWeights[index] - target) < 0.001) variantWeights[index] = target;
    else morphing = true;
  }
  currentReferenceDetail = 0;
  currentFlutter = 0;
  currentWaveWeight = variantWeights[4];
  currentDepth = 0;
  currentEyeShiftX = 0;
  currentEyeShiftY = 0;
  for (let index = 0; index < variants.length; index++) {
    currentReferenceDetail += variants[index].referenceDetail * variantWeights[index];
    currentFlutter += variants[index].flutter * variantWeights[index];
    currentDepth += variants[index].depth * variantWeights[index];
    currentEyeShiftX += variants[index].eyeShift[0] * variantWeights[index];
    currentEyeShiftY += variants[index].eyeShift[1] * variantWeights[index];
  }
  const editedResponse = editor.sample('response');
  currentFlutter *= editedResponse;
  for (let point = 0; point < currentFactors.length; point++) {
    let factor = 0;
    for (let index = 0; index < variants.length; index++) factor += variantFactors[index][point] * variantWeights[index];
    currentFactors[point] = factor;
  }
  blendColor(paletteUniforms.uBaseColor.value, 'base');
  blendColor(paletteUniforms.uCoolColor.value, 'cool');
  blendColor(paletteUniforms.uBlushColor.value, 'blush');
  blendColor(paletteUniforms.uWarmColor.value, 'warm');
  blendColor(paletteUniforms.uHighlightColor.value, 'highlight');
  blendColor(paletteUniforms.uBottomColor.value, 'bottom');
  blendColor(paletteUniforms.uDetailColor.value, 'detail');
  blendColor(paletteUniforms.uFurTipColor.value, 'furTip');
  blendColor(paletteUniforms.uBackgroundTop.value, 'backgroundTop');
  blendColor(paletteUniforms.uBackgroundBottom.value, 'backgroundBottom');
  blendColor(paletteUniforms.uShadowColor.value, 'shadow');
  blendColor(paletteUniforms.uEyeColor.value, 'eye');
  if (!controls.paused) pausedAt = now;
  const seconds = editor.active ? editor.frame / MOTION_FPS
    : frozenTime ?? (reduceMotion ? 2.25 : (pausedAt - startTime) / 1000);
  const frame = loopFrame(seconds, motionFrames.length);
  const a = Math.floor(frame), b = Math.min(a + 1, motionFrames.length - 1), fraction = frame - a;
  const first = motionFrames[a], second = motionFrames[b];
  const lerp = (one: number, two: number) => THREE.MathUtils.lerp(one, two, fraction);
  const referenceWeight = variantWeights[0];
  cheekStrength = THREE.MathUtils.smoothstep(frame, 45, 76) * referenceWeight;
  bodyUniforms.uCheek.value = cheekStrength;
  bodyUniforms.uStarSoftness.value = variantWeights[3];
  for (let i = 0; i < currentRadii.length; i++) currentRadii[i] = lerp(first.radii[i], second.radii[i]);
  boneRigActive = editor.showingBones && !editor.comparing;
  if (boneRigActive) {
    ensureBoneWeights();
    boneRig.setPose(editor.sampleBonePose(seconds * MOTION_FPS), editedResponse);
  }
  meanRadius = currentRadii.reduce((sum, value) => sum + value, 0) / currentRadii.length;
  gesture = variantGesture(frame, referenceWidths) * editedResponse;
  for (let point = 0; point < currentMotionFactors.length; point++) {
    currentMotionFactors[point] = currentFactors[point]
      * (1 + variantWeights[3] * gesture * starMotionMask[point])
      * (1 + 0.1 * variantWeights[2] * gesture * Math.max(0, flowerMotionMask[point]));
  }
  const meshView = editor.showingMesh;
  updateShape(meshView);
  const previewZoom = meshView ? 1.75 : 1;
  if (camera.zoom !== previewZoom) {
    camera.zoom = previewZoom;
    camera.updateProjectionMatrix();
  }
  background.visible = !meshView;
  scene.background = meshView ? meshBackdrop : null;
  body.visible = !meshView;
  meshSurface.visible = meshView;
  contourGuides.visible = meshView && !boneRigActive;
  boneGuides.visible = meshView && boneRigActive;
  boneReference.visible = boneGuides.visible && editor.showBoneReference;
  if (contourGuides.visible) updateContourGuides(editor.selectedContourIndex);
  if (boneGuides.visible) updateBoneGuides();
  if (boneReference.visible) {
    for (let index = 0; index < 64; index++) {
      const x = Math.cos(angularSamples[index]), y = Math.sin(angularSamples[index]);
      const radius = radiusAt(x, y);
      boneReferencePositions.set([x * radius, y * radius, 0], index * 3);
    }
    boneReferenceGeometry.getAttribute('position').needsUpdate = true;
  }
  for (const shell of shells) shell.mesh.visible = !meshView;
  fur.visible = !meshView;
  for (const eye of eyes) eye.visible = !meshView;

  const sourceCx = lerp(first.center[0], second.center[0]);
  const sourceCy = lerp(first.center[1], second.center[1]);
  const motionInfluence = 0.48 + 0.52 * referenceWeight;
  const cx = THREE.MathUtils.lerp(360, sourceCx, motionInfluence);
  const cy = THREE.MathUtils.lerp(360, sourceCy, motionInfluence);
  const sway = editor.sample('sway'), lift = editor.sample('lift');
  character.position.set(cx - 360 + sway, 360 - cy + lift, 0);
  character.rotation.set(
    THREE.MathUtils.degToRad(controls.turnX),
    THREE.MathUtils.degToRad(controls.turnY),
    THREE.MathUtils.degToRad(controls.turnZ + editor.sample('tilt')),
  );
  for (let i = 0; i < 2; i++) {
    const sourceEyeX = lerp(first.eyes[i * 2], second.eyes[i * 2]) - sourceCx;
    const sourceEyeY = sourceCy - lerp(first.eyes[i * 2 + 1], second.eyes[i * 2 + 1]);
    const ex = THREE.MathUtils.lerp(restingFrame.eyes[i * 2] - restingFrame.center[0], sourceEyeX, motionInfluence) + currentEyeShiftX;
    const openness = lerp(first.eyes[4], second.eyes[4]);
    const ey = THREE.MathUtils.lerp(restingFrame.center[1] - restingFrame.eyes[i * 2 + 1], sourceEyeY, motionInfluence)
      - (1 - openness) * 11 + currentEyeShiftY;
    const eyeRadius = boneRigActive ? restRadiusAt(ex, ey) : radiusAt(ex, ey);
    const seedX = ex / eyeRadius, seedY = ey / eyeRadius;
    const proportion = Math.min(0.98, Math.hypot(seedX, seedY));
    surface(seedX, seedY, Math.sqrt(1 - proportion * proportion), eyePosition, 0);
    eyes[i].position.set(eyePosition[0], eyePosition[1], eyePosition[2] + 1);
    eyes[i].scale.set(4.9, Math.max(1.4, 9.3 * openness), 2.1);
  }
  shadowUniforms.uShadow.value.set(cx + sway * 0.7 - 465, -191);
  shadowUniforms.uShadowScale.value = 0.94 + Math.max(0, cy - 350) * 0.0012;
  editor.updateDisplay(frame);
  renderer.render(scene, camera);
  if ((editor.active && editor.playing) || (!editor.active && frozenTime === null && !reduceMotion) || morphing) refresh();
}
function resize() {
  const width = Math.max(1, canvas!.clientWidth), height = Math.max(1, canvas!.clientHeight);
  const unit = Math.min(width, height) / 720;
  canvas!.style.setProperty('--artwork-blur', `${(1.6 * unit).toFixed(2)}px`);
  camera.left = -width / (2 * unit);
  camera.right = width / (2 * unit);
  camera.top = height / (2 * unit);
  camera.bottom = -height / (2 * unit);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  refresh();
}
addEventListener('resize', resize);
new ResizeObserver(resize).observe(canvas);
resize();
