/// <reference types="vite/client" />
import * as THREE from 'three';
import GUI from 'lil-gui';
import { boneDefinitions, BoneRig } from './bone-rig';
import { createBoneMotion, cycleFrame, forwardFrame, smooth, SOURCE_END, BONE_LOOP_FRAMES, PREVIOUS_BONE_LOOP_FRAMES, sampleDefaultPose } from './bone-motion';
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
import { DEFAULT_PLAYBACK_SPEED, MOTION_FPS } from './motion-track';
import { variants, type VariantColors } from './variants';
import { TouchReaction } from './touch-reaction';
import { pinchDistance, pinchZoom, MIN_ZOOM, MAX_ZOOM } from './zoom';

const params = new URLSearchParams(location.search);
if (params.has('editor') || params.has('rig')) {
  const url = new URL(location.href);
  url.searchParams.delete('editor');
  url.searchParams.delete('rig');
  history.replaceState(null, '', url);
}
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
const boneAnimationFrames = fitBoneFrames(motionFrames.map((frame) => frame.radii));
const { clips: boneClips, timeMaps } = createBoneMotion(boneAnimationFrames);
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
// The inspection overlay shares the animated body geometry, so every wire follows the real skin.
const bodyWire = new THREE.Mesh(shape, new THREE.MeshBasicMaterial({
  color: 0xf8f5ff, wireframe: true, transparent: true, opacity: 0.36,
  depthTest: false, depthWrite: false, side: THREE.FrontSide,
}));
bodyWire.scale.setScalar(1.003);
bodyWire.renderOrder = 80;
bodyWire.visible = false;
character.add(bodyWire);
const boneLinesPosition = new Float32Array((boneDefinitions.length - 1) * 4 * 3);
const boneLineGeometry = new THREE.BufferGeometry();
boneLineGeometry.setAttribute('position', new THREE.BufferAttribute(boneLinesPosition, 3).setUsage(THREE.DynamicDrawUsage));
const boneLines = new THREE.LineSegments(boneLineGeometry, new THREE.LineBasicMaterial({
  color: 0x6b3568, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false,
}));
boneLines.frustumCulled = false;
boneLines.renderOrder = 90;
const boneMarkerGeometry = new THREE.SphereGeometry(4.6, 10, 8);
const boneMarkerMaterial = new THREE.MeshBasicMaterial({
  color: 0xfff2cd, transparent: true, depthTest: false, depthWrite: false,
});
const boneMarkers = boneDefinitions.map(() => {
  const marker = new THREE.Mesh(boneMarkerGeometry, boneMarkerMaterial);
  marker.frustumCulled = false;
  marker.renderOrder = 91;
  return marker;
});
const boneDisplay = new THREE.Group();
boneDisplay.add(boneLines, ...boneMarkers);
boneDisplay.visible = false;
character.add(boneDisplay);
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
const startTime = performance.now();
const controls = { turnX: 0, turnY: 0, turnZ: 0 };
const view = { shape: variants[targetVariant].id, mesh: false, bones: false, zoom: 1 };
const guiMount = document.querySelector<HTMLElement>('#gui');
if (!guiMount) throw new Error('GUI mount is missing');
const gui = new GUI({ title: '솜결 · 구조 보기', container: guiMount, width: 244 });
const shapeController = gui.add(view, 'shape', Object.fromEntries(variants.map((variant) => [variant.label, variant.id])))
  .name('모양').onChange((id: typeof view.shape) => {
    const index = variants.findIndex((variant) => variant.id === id);
    if (index >= 0) selectVariant(index);
  });
function applyInspection() {
  bodyWire.visible = view.mesh;
  boneDisplay.visible = view.bones;
  for (const shell of shells) shell.mesh.visible = !view.mesh;
  fur.visible = !view.mesh;
  canvas!.style.filter = view.mesh || view.bones ? 'none' : '';
  refresh();
}
gui.add(view, 'mesh').name('몸체 메시').onChange(applyInspection);
gui.add(view, 'bones').name('관절 13개').onChange(applyInspection);
const zoomController = gui.add(view, 'zoom', MIN_ZOOM, MAX_ZOOM, 0.01).name('확대').onChange((value: number) => {
  camera.zoom = value;
  camera.updateProjectionMatrix();
  refresh();
});
let frameRequested = false;
function refresh() {
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(render);
}
function selectVariant(index: number) {
  targetVariant = index;
  view.shape = variants[index].id;
  shapeController.updateDisplay();
  document.body.style.backgroundColor = variants[index].colors.backgroundTop;
  const url = new URL(location.href);
  url.searchParams.set('shape', variants[index].id);
  history.replaceState(null, '', url);
  refresh();
}
document.body.style.backgroundColor = variants[targetVariant].colors.backgroundTop;

const reaction = new TouchReaction();
const characterPicker = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
function pointRayAt(event: PointerEvent) {
  const bounds = canvas!.getBoundingClientRect();
  pointerNdc.set(
    (event.clientX - bounds.left) / bounds.width * 2 - 1,
    -(event.clientY - bounds.top) / bounds.height * 2 + 1,
  );
  characterPicker.setFromCamera(pointerNdc, camera);
}
let dragging: {
  pointerId: number; x: number; y: number; lastX: number; lastY: number;
  pitch: number; yaw: number; moved: boolean; touched: boolean;
} | null = null;
const touchPoints = new Map<number, [number, number]>();
let pinch: { distance: number; zoom: number } | null = null;
canvas.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'touch') {
    touchPoints.set(event.pointerId, [event.clientX, event.clientY]);
    canvas.setPointerCapture(event.pointerId);
    if (touchPoints.size >= 2) {
      reaction.end(performance.now(), true);
      dragging = null;
      canvas.classList.remove('dragging');
      const [first, second] = [...touchPoints.values()];
      pinch = { distance: pinchDistance(first, second), zoom: camera.zoom };
      return;
    }
  }
  if (dragging || (event.pointerType === 'mouse' && event.button !== 0)) return;
  pointRayAt(event);
  character.updateMatrixWorld(true);
  const hit = characterPicker.intersectObject(body)[0];
  if (hit?.face) {
    reaction.begin(character.worldToLocal(hit.point.clone()), hit.face.normal, performance.now());
    refresh();
  }
  dragging = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    pitch: controls.turnX,
    yaw: controls.turnY,
    moved: false,
    touched: Boolean(hit),
  };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (touchPoints.has(event.pointerId)) touchPoints.set(event.pointerId, [event.clientX, event.clientY]);
  if (pinch && touchPoints.size >= 2) {
    const [first, second] = [...touchPoints.values()];
    camera.zoom = Math.round(pinchZoom(pinch.zoom, pinch.distance, pinchDistance(first, second)) * 100) / 100;
    camera.updateProjectionMatrix();
    view.zoom = camera.zoom;
    zoomController.updateDisplay();
    refresh();
    return;
  }
  if (!dragging || event.pointerId !== dragging.pointerId) return;
  const moved = Math.hypot(event.clientX - dragging.x, event.clientY - dragging.y);
  if (!dragging.moved && moved < 8) return;
  if (!dragging.moved) reaction.drag(0, 0);
  dragging.moved = true;
  const unit = Math.min(canvas.clientWidth, canvas.clientHeight) / 720;
  const dx = (event.clientX - dragging.x) / unit;
  const dy = (event.clientY - dragging.y) / unit;
  controls.turnX = THREE.MathUtils.clamp(dragging.pitch + dy * 0.38, -90, 90);
  controls.turnY = ((dragging.yaw + dx * 0.5 + 180) % 360 + 360) % 360 - 180;
  if (dragging.touched) {
    reaction.drag(event.clientX - dragging.lastX, event.clientY - dragging.lastY);
  }
  dragging.lastX = event.clientX;
  dragging.lastY = event.clientY;
  canvas.classList.add('dragging');
  refresh();
});
function stopDragging(event: PointerEvent) {
  touchPoints.delete(event.pointerId);
  if (touchPoints.size < 2) pinch = null;
  if (dragging?.pointerId === event.pointerId) {
    if (!dragging.moved) reaction.end(performance.now(), event.type !== 'pointerup');
    dragging = null;
    canvas!.classList.remove('dragging');
  }
  if (canvas!.hasPointerCapture(event.pointerId)) canvas!.releasePointerCapture(event.pointerId);
  refresh();
}
canvas.addEventListener('pointerup', stopDragging);
canvas.addEventListener('pointercancel', stopDragging);
canvas.addEventListener('lostpointercapture', stopDragging);

let cheekStrength = 0;
let lastRenderTime = performance.now();
function ensureBoneWeights() {
  const id = variants[targetVariant].id;
  if (boneRig.shape !== id) {
    boneRig = new BoneRig(id);
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
function updateShape() {
  const bodyPositions = shapePosition.array as Float32Array;
  for (let i = 0; i < original.length; i += 3) {
    if (bodyRestPositions && bodyBoneWeights && bodyCheekWeights) {
      boneRig.skinPoint(bodyRestPositions[i], bodyRestPositions[i + 1],
        bodyRestPositions[i + 2] + cheekStrength * bodyCheekWeights[i / 3],
        bodyBoneWeights, bodyPositions, i, i / 3 * boneDefinitions.length);
    } else {
      surface(original[i], original[i + 1], original[i + 2], bodyPositions, i);
    }
    if (reaction.deforming) {
      const push = reaction.displacement(bodyPositions[i], bodyPositions[i + 1], bodyPositions[i + 2]);
      bodyPositions[i] += reaction.normal.x * push;
      bodyPositions[i + 1] += reaction.normal.y * push;
      bodyPositions[i + 2] += reaction.normal.z * push;
    }
  }
  shapePosition.needsUpdate = true;
  shape.computeVertexNormals();
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
    if (reaction.deforming) {
      const push = reaction.displacement(fiberRoots[vertex], fiberRoots[vertex + 1], fiberRoots[vertex + 2]);
      fiberRoots[vertex] += reaction.normal.x * push;
      fiberRoots[vertex + 1] += reaction.normal.y * push;
      fiberRoots[vertex + 2] += reaction.normal.z * push;
      const tipPush = push * 0.72;
      fiberTips[vertex] += reaction.normal.x * tipPush;
      fiberTips[vertex + 1] += reaction.normal.y * tipPush;
      fiberTips[vertex + 2] += reaction.normal.z * tipPush;
    }
    if (reaction.active) {
      fiberTips[vertex] += reaction.furLagX * Math.max(0, z);
      fiberTips[vertex + 1] += reaction.furLagY * Math.max(0, z);
    }
  }
  fiberRootAttribute.needsUpdate = true;
  fiberTipAttribute.needsUpdate = true;
}

function updateBoneDisplay() {
  if (!view.bones) return;
  const center = boneRig.jointPosition(0);
  const rimCount = boneDefinitions.length - 1;
  for (let index = 0; index < boneDefinitions.length; index++) {
    const [x, y] = boneRig.jointPosition(index);
    boneMarkers[index].position.set(x, y, 155);
    if (index === 0) continue;
    const next = boneRig.jointPosition(index === rimCount ? 1 : index + 1);
    boneLinesPosition.set([center[0], center[1], 155, x, y, 155,
      x, y, 155, next[0], next[1], 155], (index - 1) * 12);
  }
  boneLineGeometry.getAttribute('position').needsUpdate = true;
}

function render(now: number) {
  frameRequested = false;
  const delta = Math.min(Math.max(now - lastRenderTime, 0) / 1000, 0.05);
  lastRenderTime = now;
  reaction.advance(delta);
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
  const seconds = frozenTime ?? (reduceMotion ? 2.25 : (now - startTime) / 1000 * DEFAULT_PLAYBACK_SPEED);
  const timelineFrame = cycleFrame(seconds * MOTION_FPS);
  const previousFrame = timeMaps[variants[targetVariant].id].oldAtNew(timelineFrame);
  const forward = previousFrame <= SOURCE_END;
  const source = forwardFrame(previousFrame);
  const a = forward ? Math.floor(source) : SOURCE_END;
  const b = forward ? Math.min(a + 1, SOURCE_END) : 0;
  const fraction = forward ? source - a : smooth((previousFrame - SOURCE_END) / (PREVIOUS_BONE_LOOP_FRAMES - SOURCE_END));
  const first = motionFrames[a], second = motionFrames[b];
  const lerp = (one: number, two: number) => THREE.MathUtils.lerp(one, two, fraction);
  const selectedVariant = variants[targetVariant];
  cheekStrength = selectedVariant.id === 'original'
    ? lerp(THREE.MathUtils.smoothstep(a, 45, 76), THREE.MathUtils.smoothstep(b, 45, 76)) : 0;
  bodyUniforms.uCheek.value = cheekStrength;
  bodyUniforms.uStarSoftness.value = variantWeights[3];
  ensureBoneWeights();
  boneRig.setPose(sampleDefaultPose(boneClips, selectedVariant.id, timelineFrame));
  updateShape();
  updateBoneDisplay();

  const sourceCx = lerp(first.center[0], second.center[0]);
  const sourceCy = lerp(first.center[1], second.center[1]);
  const isOriginal = selectedVariant.id === 'original';
  const cx = isOriginal ? sourceCx : 360;
  const cy = isOriginal ? sourceCy : 355;
  character.position.set(cx - 360, 360 - cy, 0);
  const squash = reaction.squash;
  const rebound = reaction.rebound;
  character.scale.set(1 + squash * 0.165 - rebound * 0.045,
    1 - squash * 0.27 + rebound * 0.08, 1);
  character.rotation.set(
    THREE.MathUtils.degToRad(controls.turnX) + reaction.dragPitch,
    THREE.MathUtils.degToRad(controls.turnY),
    THREE.MathUtils.degToRad(controls.turnZ) + reaction.dragTilt,
  );
  for (let i = 0; i < 2; i++) {
    const sourceEyeX = lerp(first.eyes[i * 2], second.eyes[i * 2]) - sourceCx;
    const sourceEyeY = sourceCy - lerp(first.eyes[i * 2 + 1], second.eyes[i * 2 + 1]);
    const ex = (isOriginal ? sourceEyeX : restingFrame.eyes[i * 2] - restingFrame.center[0]) + selectedVariant.eyeShift[0];
    const openness = isOriginal ? lerp(first.eyes[4], second.eyes[4])
      : 1 - 0.85 * Math.exp(-Math.pow((timelineFrame / BONE_LOOP_FRAMES - 0.64) / 0.023, 2));
    const reactedOpenness = openness * reaction.eyeOpen;
    const ey = (isOriginal ? sourceEyeY : restingFrame.center[1] - restingFrame.eyes[i * 2 + 1])
      - (1 - reactedOpenness) * 11 + selectedVariant.eyeShift[1];
    const eyeRadius = restRadius(selectedVariant.id, ex, ey, baselineRadii);
    const seedX = ex / eyeRadius, seedY = ey / eyeRadius;
    const proportion = Math.min(0.98, Math.hypot(seedX, seedY));
    surface(seedX, seedY, Math.sqrt(1 - proportion * proportion), eyePosition, 0);
    if (reaction.deforming) {
      const push = reaction.displacement(eyePosition[0], eyePosition[1], eyePosition[2]);
      eyePosition[0] += reaction.normal.x * push;
      eyePosition[1] += reaction.normal.y * push;
      eyePosition[2] += reaction.normal.z * push;
    }
    eyes[i].position.set(eyePosition[0], eyePosition[1], eyePosition[2] + 1);
    eyes[i].scale.set(4.9, Math.max(1.1, 9.3 * reactedOpenness), 2.1);
  }
  shadowUniforms.uShadow.value.set(cx + boneRig.poses[0].dx * 0.7 - 465, -191);
  shadowUniforms.uShadowScale.value = 0.94 + Math.max(0, cy - 350) * 0.0012;
  renderer.render(scene, camera);
  if ((frozenTime === null && !reduceMotion) || morphing || reaction.active) refresh();
}
function resize() {
  const width = Math.max(1, canvas!.clientWidth), height = Math.max(1, canvas!.clientHeight);
  const unit = Math.min(width, height) / 720;
  const largeDisplay = Math.min(1, Math.max(0, (Math.min(innerWidth, innerHeight) - 720) / 160));
  const blur = THREE.MathUtils.lerp(1.6 * unit, 0.7, largeDisplay);
  canvas!.style.setProperty('--artwork-blur', `${blur.toFixed(2)}px`);
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
