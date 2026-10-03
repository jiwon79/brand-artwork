/// <reference types="vite/client" />
import * as THREE from 'three';
import GUI from 'lil-gui';
import { controlDefinitions, DeformationRig } from './deformation-rig';
import { createMotionClips, cycleFrame, forwardFrame, smooth, SOURCE_END, LOOP_FRAMES, PREVIOUS_LOOP_FRAMES, sampleDefaultPose } from './motion-clips';
import { restRadius, restSurface } from './rest-surface';
import { bindSurface, skinBoundPoint, cheekWeight } from './surface-binding';
import { FurRenderer, FUR_RENDER_ORDER } from './fur-renderer';
import { fitControlFrames } from './motion-fit';
import backgroundFragment from './background.frag?raw';
import bodyFragment from './body.frag?raw';
import paletteShader from './palette.glsl?raw';
import { motionFrames } from './motion-data';
import { DEFAULT_PLAYBACK_SPEED, MOTION_FPS } from './motion-track';
import { variants, type VariantColors } from './variants';
import { TouchReaction } from './touch-reaction';
import { pinchDistance, pinchZoom } from './zoom';

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
let targetVariant = requestedVariant >= 0 ? requestedVariant : variants.findIndex((variant) => variant.id === 'wave');
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
let deformationRig = new DeformationRig(variants[targetVariant].id);
const fittedControlFrames = fitControlFrames(motionFrames.map((frame) => frame.radii));
const { clips: motionClips, timeMaps } = createMotionClips(fittedControlFrames);

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
const bodyGeometry = new THREE.SphereGeometry(1, 88, 64);
const bodyDirections = Float32Array.from(bodyGeometry.getAttribute('position').array as ArrayLike<number>);
const bodyPosition = bodyGeometry.getAttribute('position') as THREE.BufferAttribute;
bodyPosition.setUsage(THREE.DynamicDrawUsage);
const influenceColors = new Float32Array(bodyDirections.length);
const influenceColorAttribute = new THREE.BufferAttribute(influenceColors, 3).setUsage(THREE.DynamicDrawUsage);
bodyGeometry.setAttribute('color', influenceColorAttribute);
const bodyUniforms = { uCheek: { value: 0 }, uStarSoftness: { value: 0 }, ...paletteUniforms };
const body: THREE.Mesh<THREE.SphereGeometry, THREE.Material> = new THREE.Mesh(
  bodyGeometry,
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
const artworkBodyMaterial = body.material;
const inspectionBodyMaterial = new THREE.MeshStandardMaterial({ color: 0xb3bac3, roughness: 0.92 });
const influenceBodyMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
// The inspection overlay shares the animated body geometry, so every wire follows the real skin.
const bodyWire = new THREE.Mesh(bodyGeometry, new THREE.MeshBasicMaterial({
  color: 0x35404f, wireframe: true, transparent: true, opacity: 0.32,
  depthTest: false, depthWrite: false, side: THREE.FrontSide,
}));
bodyWire.scale.setScalar(1.003);
bodyWire.renderOrder = 80;
bodyWire.visible = false;
character.add(bodyWire);
// The real rig uses independent weighted controls, so no connection is drawn between them.
const controlMarkerGeometry = new THREE.SphereGeometry(6, 14, 10);
const influencePalette = [
  0xffc27a, 0xff8d91, 0xf7ab6d, 0xe5cf78, 0x9ed99c, 0x73cdb7, 0x76c8df,
  0x83aaf0, 0xa8a1ef, 0xd3a0df, 0xf0a6c8, 0xed9eab, 0xe8a477,
].map((value) => new THREE.Color(value));
const influenceMarkerMaterials = influencePalette.map((color) => new THREE.MeshBasicMaterial({
  color, transparent: true, depthTest: false, depthWrite: false,
}));
const controlMarkers = controlDefinitions.map((_, index) => {
  const marker = new THREE.Mesh(controlMarkerGeometry, influenceMarkerMaterials[index]);
  marker.frustumCulled = false;
  marker.renderOrder = 91;
  return marker;
});
const controlDisplay = new THREE.Group();
controlDisplay.add(...controlMarkers);
controlDisplay.visible = false;
character.add(controlDisplay);
const fur = new FurRenderer(bodyGeometry, bodyDirections, bodyUniforms, deformationRig, baselineRadii);
character.add(fur.group);
let bodyBinding = bindSurface(deformationRig, bodyDirections, baselineRadii);

const eyeMaterial = new THREE.ShaderMaterial({
  vertexShader: `varying vec3 vNormal; void main() { vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform vec3 uEyeColor; varying vec3 vNormal; void main() { float edge = smoothstep(0.0, 0.67, abs(normalize(vNormal).z)); gl_FragColor = vec4(uEyeColor, edge * 0.88); }`,
  uniforms: { uEyeColor: paletteUniforms.uEyeColor },
  transparent: true,
  depthWrite: false,
});
const eyes = Array.from({ length: 2 }, () => {
  const eye = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), eyeMaterial);
  eye.renderOrder = FUR_RENDER_ORDER + 1;
  character.add(eye);
  return eye;
});
const eyePosition = new Float32Array(3);

const queryTime = Number(params.get('t'));
const frozenTime = params.has('t') && Number.isFinite(queryTime) ? Math.max(0, queryTime) : null;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const startTime = performance.now();
const controls = { turnX: 0, turnY: 0, turnZ: 0 };
const view = { shape: variants[targetVariant].id, mesh: false, handles: false };
const gui = new GUI({ title: '솜결 · 구조 보기' });
const shapeController = gui.add(view, 'shape', Object.fromEntries(variants.map((variant) => [variant.label, variant.id])))
  .name('모양').onChange((id: typeof view.shape) => {
    const index = variants.findIndex((variant) => variant.id === id);
    if (index >= 0) selectVariant(index);
  });
function applyInspection() {
  const inspecting = view.mesh || view.handles;
  body.material = view.handles ? influenceBodyMaterial : view.mesh ? inspectionBodyMaterial : artworkBodyMaterial;
  bodyWire.visible = view.mesh;
  controlDisplay.visible = view.handles;
  fur.group.visible = !inspecting;
  for (const eye of eyes) eye.visible = !inspecting;
  canvas!.style.filter = inspecting ? 'none' : '';
  refresh();
}
gui.add(view, 'mesh').name('몸체 메시').onChange(applyInspection);
gui.add(view, 'handles').name('변형 컨트롤').onChange(applyInspection);
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
function ensureSurfaceBindings() {
  const id = variants[targetVariant].id;
  if (deformationRig.shape === id) return;
  deformationRig = new DeformationRig(id);
  bodyBinding = bindSurface(deformationRig, bodyDirections, baselineRadii);
  fur.bind(deformationRig, baselineRadii);
}
const surfaceRest = new Float32Array(3);
function sampleSurface(x: number, y: number, z: number, target: Float32Array, offset: number) {
  restSurface(deformationRig.shape, x, y, z, baselineRadii, surfaceRest);
  surfaceRest[2] += cheekWeight(deformationRig.shape, x, y, z) * cheekStrength;
  deformationRig.skinPoint(surfaceRest[0], surfaceRest[1], surfaceRest[2], deformationRig.weightsFor(surfaceRest[0], surfaceRest[1]), target, offset);
}
function updateBodyGeometry() {
  const bodyPositions = bodyPosition.array as Float32Array;
  for (let i = 0; i < bodyDirections.length; i += 3) {
    skinBoundPoint(deformationRig, bodyBinding, i / 3, cheekStrength, bodyPositions, i);
    if (reaction.deforming) {
      const push = reaction.displacement(bodyPositions[i], bodyPositions[i + 1], bodyPositions[i + 2]);
      bodyPositions[i] += reaction.normal.x * push;
      bodyPositions[i + 1] += reaction.normal.y * push;
      bodyPositions[i + 2] += reaction.normal.z * push;
    }
  }
  bodyPosition.needsUpdate = true;
  bodyGeometry.computeVertexNormals();
  fur.update(deformationRig, cheekStrength, reaction, bodyPositions);
}

let influenceKey = '';
function updateInfluenceColors() {
  if (!view.handles) return;
  const key = deformationRig.shape;
  if (key === influenceKey) return;
  influenceKey = key;
  for (let index = 0; index < bodyDirections.length / 3; index++) {
    let total = 0;
    let red = 0, green = 0, blue = 0;
    for (let control = 0; control < controlDefinitions.length; control++) {
      const weight = bodyBinding.controlWeights[index * controlDefinitions.length + control] ** 4;
      const color = influencePalette[control];
      red += color.r * weight;
      green += color.g * weight;
      blue += color.b * weight;
      total += weight;
    }
    const offset = index * 3;
    influenceColors[offset] = red / total;
    influenceColors[offset + 1] = green / total;
    influenceColors[offset + 2] = blue / total;
  }
  influenceColorAttribute.needsUpdate = true;
}

function updateControlDisplay() {
  if (!view.handles) return;
  for (let index = 0; index < controlDefinitions.length; index++) {
    const [x, y] = deformationRig.controlPosition(index);
    // The rig is planar: its controls live inside the body on the local XY plane.
    // A fixed front-facing Z offset makes them orbit outside the body when it rotates.
    controlMarkers[index].position.set(x, y, 0);
  }
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
  const fraction = forward ? source - a : smooth((previousFrame - SOURCE_END) / (PREVIOUS_LOOP_FRAMES - SOURCE_END));
  const first = motionFrames[a], second = motionFrames[b];
  const lerp = (one: number, two: number) => THREE.MathUtils.lerp(one, two, fraction);
  const selectedVariant = variants[targetVariant];
  cheekStrength = selectedVariant.id === 'original'
    ? lerp(THREE.MathUtils.smoothstep(a, 45, 76), THREE.MathUtils.smoothstep(b, 45, 76)) : 0;
  bodyUniforms.uCheek.value = cheekStrength;
  bodyUniforms.uStarSoftness.value = variantWeights[3];
  ensureSurfaceBindings();
  updateInfluenceColors();
  deformationRig.setPose(sampleDefaultPose(motionClips, selectedVariant.id, timelineFrame));
  updateBodyGeometry();
  updateControlDisplay();

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
      : 1 - 0.85 * Math.exp(-Math.pow((timelineFrame / LOOP_FRAMES - 0.64) / 0.023, 2));
    const reactedOpenness = openness * reaction.eyeOpen;
    const ey = (isOriginal ? sourceEyeY : restingFrame.center[1] - restingFrame.eyes[i * 2 + 1])
      - (1 - reactedOpenness) * 11 + selectedVariant.eyeShift[1];
    const eyeRadius = restRadius(selectedVariant.id, ex, ey, baselineRadii);
    const seedX = ex / eyeRadius, seedY = ey / eyeRadius;
    const proportion = Math.min(0.98, Math.hypot(seedX, seedY));
    sampleSurface(seedX, seedY, Math.sqrt(1 - proportion * proportion), eyePosition, 0);
    if (reaction.deforming) {
      const push = reaction.displacement(eyePosition[0], eyePosition[1], eyePosition[2]);
      eyePosition[0] += reaction.normal.x * push;
      eyePosition[1] += reaction.normal.y * push;
      eyePosition[2] += reaction.normal.z * push;
    }
    eyes[i].position.set(eyePosition[0], eyePosition[1], eyePosition[2] + 1);
    eyes[i].scale.set(4.9, Math.max(1.1, 9.3 * reactedOpenness), 2.1);
  }
  shadowUniforms.uShadow.value.set(cx + deformationRig.poses[0].dx * 0.7 - 465, -191);
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
