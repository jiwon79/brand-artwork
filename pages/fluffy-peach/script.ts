/// <reference types="vite/client" />
import * as THREE from 'three';
import GUI from 'lil-gui';
import { exposeGuiInDebugMode } from '../../common/debug';
import { boneDefinitions, BoneRig } from './bone-rig';
import { createBoneClips, cycleFrame, forwardFrame, smooth, SOURCE_END, BONE_LOOP_FRAMES, sampleDefaultPose } from './bone-motion';
import { restRadius, restSurface } from './bone-surface';
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
import { variants, type VariantColors } from './variants';

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
const restingFrame = motionFrames[Math.floor(motionFrames.length / 2)];
const baselineRadii = Float32Array.from(motionFrames[0].radii, (_, point) =>
  motionFrames.reduce((sum, frame) => sum + frame.radii[point], 0) / motionFrames.length);
let boneRig = new BoneRig(variants[targetVariant].id);
let referenceRig = new BoneRig(variants[targetVariant].id);
const boneAnimationFrames = fitBoneFrames(motionFrames.map((frame) => frame.radii));
const boneClips = createBoneClips(boneAnimationFrames);
let bodyBoneWeights: Float32Array | null = null;
let fiberBoneWeights: Float32Array | null = null;
let bodyRestPositions: Float32Array | null = null;
let fiberRestPositions: Float32Array | null = null;
let bodyCheekWeights: Float32Array | null = null;
let fiberCheekWeights: Float32Array | null = null;

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
    const angle = Math.atan2(boneRig.definitions[index].y, boneRig.definitions[index].x) + boneRig.poses[index].angle;
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
  clips: boneClips,
  legacyFrames: boneAnimationFrames,
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
  if (event.type === 'pointerup' && editor.showingMesh && !editor.comparing
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

let pausedAt = 0;
let cheekStrength = 0;
let lastRenderTime = performance.now();
function ensureBoneWeights() {
  const id = variants[targetVariant].id;
  if (boneRig.shape !== id) {
    boneRig = new BoneRig(id);
    referenceRig = new BoneRig(id);
    bodyBoneWeights = fiberBoneWeights = null;
  }
  if (bodyBoneWeights && fiberBoneWeights) return;
  bodyBoneWeights = new Float32Array(original.length / 3 * boneDefinitions.length);
  bodyRestPositions = new Float32Array(original.length);
  bodyCheekWeights = new Float32Array(original.length / 3);
  for (let vertex = 0; vertex < original.length / 3; vertex++) {
    const x = original[vertex * 3], y = original[vertex * 3 + 1], z = original[vertex * 3 + 2];
    restSurface(id, x, y, z, baselineRadii, bodyRestPositions, vertex * 3);
    bodyBoneWeights.set(boneRig.weightsFor(bodyRestPositions[vertex * 3], bodyRestPositions[vertex * 3 + 1]), vertex * boneDefinitions.length);
    bodyCheekWeights[vertex] = id === 'original' ? Math.max(0, z)
      * Math.exp(-Math.pow((x - 0.71) / 0.26, 2) - Math.pow((y + 0.38) / 0.38, 2)) * 44 : 0;
  }
  fiberBoneWeights = new Float32Array(FIBER_COUNT * boneDefinitions.length);
  fiberRestPositions = new Float32Array(FIBER_COUNT * 3);
  fiberCheekWeights = new Float32Array(FIBER_COUNT);
  for (let fiber = 0; fiber < FIBER_COUNT; fiber++) {
    const x = fiberSeeds[fiber * 5], y = fiberSeeds[fiber * 5 + 1], z = fiberSeeds[fiber * 5 + 2];
    restSurface(id, x, y, z, baselineRadii, fiberRestPositions, fiber * 3);
    fiberBoneWeights.set(boneRig.weightsFor(fiberRestPositions[fiber * 3], fiberRestPositions[fiber * 3 + 1]), fiber * boneDefinitions.length);
    fiberRestPositions[fiber * 3] -= x * 1.5;
    fiberRestPositions[fiber * 3 + 1] -= y * 1.5;
    fiberRestPositions[fiber * 3 + 2] -= z * 1.5;
    fiberCheekWeights[fiber] = id === 'original' ? Math.max(0, z)
      * Math.exp(-Math.pow((x - 0.71) / 0.26, 2) - Math.pow((y + 0.38) / 0.38, 2)) * 44 : 0;
  }
}
const surfaceRest = new Float32Array(3);
function surface(x: number, y: number, z: number, target: Float32Array, offset: number) {
  restSurface(boneRig.shape, x, y, z, baselineRadii, surfaceRest);
  if (boneRig.shape === 'original') surfaceRest[2] += Math.max(0, z)
    * Math.exp(-Math.pow((x - 0.71) / 0.26, 2) - Math.pow((y + 0.38) / 0.38, 2)) * cheekStrength * 44;
  boneRig.skinPoint(surfaceRest[0], surfaceRest[1], surfaceRest[2], boneRig.weightsFor(surfaceRest[0], surfaceRest[1]), target, offset);
}
function updateShape(meshOnly: boolean) {
  const bodyPositions = shapePosition.array as Float32Array;
  for (let i = 0; i < original.length; i += 3) {
    if (bodyRestPositions && bodyBoneWeights && bodyCheekWeights) {
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
    if (fiberBoneWeights && fiberRestPositions && fiberCheekWeights) {
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
  const timelineFrame = cycleFrame(seconds * MOTION_FPS);
  const forward = timelineFrame <= SOURCE_END;
  const source = forwardFrame(timelineFrame);
  const a = forward ? Math.floor(source) : SOURCE_END;
  const b = forward ? Math.min(a + 1, SOURCE_END) : 0;
  const fraction = forward ? source - a : smooth((timelineFrame - SOURCE_END) / (BONE_LOOP_FRAMES - SOURCE_END));
  const first = motionFrames[a], second = motionFrames[b];
  const lerp = (one: number, two: number) => THREE.MathUtils.lerp(one, two, fraction);
  const selectedVariant = variants[targetVariant];
  cheekStrength = selectedVariant.id === 'original'
    ? lerp(THREE.MathUtils.smoothstep(a, 45, 76), THREE.MathUtils.smoothstep(b, 45, 76)) : 0;
  bodyUniforms.uCheek.value = cheekStrength;
  bodyUniforms.uStarSoftness.value = variantWeights[3];
  ensureBoneWeights();
  boneRig.setPose(editor.sampleBonePose(timelineFrame));
  const meshView = editor.showingMesh;
  updateShape(meshView);
  // Leave room below the rig for the shape picker, including the star's tips.
  const previewZoom = meshView ? (selectedVariant.id === 'original' ? 1.65 : 1.4) : 1;
  camera.position.y = meshView ? -44 : 0;
  if (camera.zoom !== previewZoom) {
    camera.zoom = previewZoom;
    camera.updateProjectionMatrix();
  }
  background.visible = !meshView;
  scene.background = meshView ? meshBackdrop : null;
  body.visible = !meshView;
  meshSurface.visible = meshView;
  boneGuides.visible = meshView;
  boneReference.visible = meshView && editor.showBoneReference;
  if (boneGuides.visible) updateBoneGuides();
  if (boneReference.visible) {
    referenceRig.setPose(sampleDefaultPose(boneClips, selectedVariant.id, timelineFrame));
    for (let index = 0; index < 64; index++) {
      const angle = -index * Math.PI * 2 / 64;
      restSurface(selectedVariant.id, Math.cos(angle), Math.sin(angle), 0, baselineRadii, surfaceRest);
      referenceRig.skinPoint(surfaceRest[0], surfaceRest[1], 0,
        referenceRig.weightsFor(surfaceRest[0], surfaceRest[1]), boneReferencePositions, index * 3);
    }
    boneReferenceGeometry.getAttribute('position').needsUpdate = true;
  }
  for (const shell of shells) shell.mesh.visible = !meshView;
  fur.visible = !meshView;
  for (const eye of eyes) eye.visible = !meshView;

  const sourceCx = lerp(first.center[0], second.center[0]);
  const sourceCy = lerp(first.center[1], second.center[1]);
  const isOriginal = selectedVariant.id === 'original';
  const cx = isOriginal ? sourceCx : 360;
  const cy = isOriginal ? sourceCy : 355;
  character.position.set(cx - 360, 360 - cy, 0);
  character.rotation.set(
    THREE.MathUtils.degToRad(controls.turnX),
    THREE.MathUtils.degToRad(controls.turnY),
    THREE.MathUtils.degToRad(controls.turnZ),
  );
  for (let i = 0; i < 2; i++) {
    const sourceEyeX = lerp(first.eyes[i * 2], second.eyes[i * 2]) - sourceCx;
    const sourceEyeY = sourceCy - lerp(first.eyes[i * 2 + 1], second.eyes[i * 2 + 1]);
    const ex = (isOriginal ? sourceEyeX : restingFrame.eyes[i * 2] - restingFrame.center[0]) + selectedVariant.eyeShift[0];
    const openness = isOriginal ? lerp(first.eyes[4], second.eyes[4])
      : 1 - 0.85 * Math.exp(-Math.pow((timelineFrame / BONE_LOOP_FRAMES - 0.64) / 0.023, 2));
    const ey = (isOriginal ? sourceEyeY : restingFrame.center[1] - restingFrame.eyes[i * 2 + 1])
      - (1 - openness) * 11 + selectedVariant.eyeShift[1];
    const eyeRadius = restRadius(selectedVariant.id, ex, ey, baselineRadii);
    const seedX = ex / eyeRadius, seedY = ey / eyeRadius;
    const proportion = Math.min(0.98, Math.hypot(seedX, seedY));
    surface(seedX, seedY, Math.sqrt(1 - proportion * proportion), eyePosition, 0);
    eyes[i].position.set(eyePosition[0], eyePosition[1], eyePosition[2] + 1);
    eyes[i].scale.set(4.9, Math.max(1.4, 9.3 * openness), 2.1);
  }
  shadowUniforms.uShadow.value.set(cx + boneRig.poses[0].dx * 0.7 - 465, -191);
  shadowUniforms.uShadowScale.value = 0.94 + Math.max(0, cy - 350) * 0.0012;
  editor.updateDisplay();
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
