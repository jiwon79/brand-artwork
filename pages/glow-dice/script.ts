/// <reference types="vite/client" />
import * as THREE from 'three';
import GUI from 'lil-gui';
import { COLOR_PRESETS, type ColorPreset } from './presets';
import { createStepper } from '../../common/stepper';
import { ProcessView, PROCESS_STEPS, STAGE_DESCRIPTIONS, type ProcessStage } from './process-view';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { createDiceGeometry } from './geometry';
import { createField, DicePaint, FIELD_HEIGHT, random, type Cell } from './field';

function studioEnvironment(renderer: THREE.WebGLRenderer) {
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0.015, 0.016, 0.019);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const materials: THREE.MeshBasicMaterial[] = [];
  const panelCanvas = document.createElement('canvas');
  panelCanvas.width = panelCanvas.height = 128;
  const context = panelCanvas.getContext('2d')!;
  const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 64);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.4, '#bbbbbb');
  gradient.addColorStop(0.75, '#555555');
  gradient.addColorStop(1, '#000000');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const softboxTexture = new THREE.CanvasTexture(panelCanvas);
  softboxTexture.colorSpace = THREE.SRGBColorSpace;
  function panel(x: number, y: number, z: number, w: number, h: number, power: number) {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(power, power * 1.008, power * 1.015), map: softboxTexture });
    const mesh = new THREE.Mesh(geometry, material);
    materials.push(material);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, 1);
    mesh.lookAt(0, 0, 0);
    studio.add(mesh);
  }
  panel(-1.5, 2.5, 7, 9, 9, 1.15);
  panel(4, 0, 5, 0.8, 8, 2.2);
  panel(-4, -2, 3, 0.45, 6, 1.6);
  panel(0, -5, 3, 6, 0.5, 1.1);
  panel(0, 1, -5, 5, 2, 1.3);
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(studio, 0.015, 0.1, 30);
  generator.dispose();
  geometry.dispose();
  softboxTexture.dispose();
  materials.forEach(material => material.dispose());
  return target;
}

const canvas = document.querySelector('canvas')!;
const status = document.querySelector<HTMLElement>('.status')!;
const params = new URLSearchParams(location.search);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const look = {
  ...COLOR_PRESETS['차콜 · 기본'],
  animate: !reducedMotion.matches && !(import.meta.env.DEV && params.has('still')),
  spinDuration: 0,
  size: 0.6,
  brushWidth: 1.5,
  preset: '차콜 · 기본',
};

function start() {
  const events = new AbortController();
  const processView = new ProcessView();
  let stage: ProcessStage = 'final';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setClearColor(0x030304);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = look.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
  const environment = studioEnvironment(renderer);
  scene.environment = environment.texture;
  // A large area light models studio illumination without point-like glare.
  RectAreaLightUniformsLib.init();
  const softbox = new THREE.RectAreaLight(0xf9faff, 2.1, 12, 15);
  softbox.position.set(-5, 7, 12);
  softbox.lookAt(0, 0, 0);
  scene.add(softbox);
  const key = new THREE.DirectionalLight(0xf9faff, 0.22);
  key.position.set(-8, 12, 16);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.normalBias = 0.018;
  key.shadow.bias = -0.0001;
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 70;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xe5e7f0, 0.08);
  fill.position.set(6, -3, 8);
  scene.add(fill);
  const ambient = new THREE.AmbientLight(0xd9dbe4, look.ambientIntensity);
  scene.add(ambient);

  const geometry = createDiceGeometry();
  const shellMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x56575a, roughness: look.roughness, metalness: 0.12,
    clearcoat: look.clearcoat, clearcoatRoughness: 0.18, envMapIntensity: look.environment,
  });
  const socketMaterial = new THREE.MeshStandardMaterial({
    color: 0x010101, roughness: 0.5, metalness: 0.05, envMapIntensity: 0.08, side: THREE.DoubleSide,
  });
  const lightMaterial = new THREE.MeshStandardMaterial({
    color: 0x010101, emissive: 0xfafaff, roughness: 0.65, envMapIntensity: 0.04,
  });
  const uniforms = { intensity: { value: look.light } };
  lightMaterial.onBeforeCompile = shader => {
    shader.uniforms.uIntensity = uniforms.intensity;
    shader.vertexShader = `attribute float cellLuminance;
      attribute float cellReveal;
      varying float vLuminance;
      varying float vReveal;
      ${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>
      vLuminance = cellLuminance; vReveal = cellReveal;`);
    shader.fragmentShader = `uniform float uIntensity;
      varying float vLuminance;
      varying float vReveal;
      ${shader.fragmentShader}`.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance *= 1.15 * pow(vLuminance, 0.85) * vReveal * uIntensity;`);
  };

  const neutralShell = new THREE.MeshMatcapMaterial({ color: 0x858a94 });
  // Matcap supplies shape shading; per-die enamel variation stays in Final.
  neutralShell.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '');
  };
  const neutralSocket = new THREE.MeshBasicMaterial({ color: 0x151922, side: THREE.DoubleSide });
  const neutralPip = new THREE.MeshBasicMaterial({ color: 0xe1e5ee });

  const backgroundMaterial = new THREE.MeshStandardMaterial({ color: 0x030304, roughness: 1 });
  const backgroundGeometry = new THREE.PlaneGeometry(160, 80);
  const background = new THREE.Mesh(backgroundGeometry, backgroundMaterial);
  background.position.z = -0.66;
  background.receiveShadow = true;
  scene.add(background);

  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  target.samples = 4;
  const composer = new EffectComposer(renderer, target);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), look.glow, 0.1, 0.8);
  const output = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(output);

  let cells: Cell[] = [];
  let meshes: THREE.InstancedMesh[] = [];
  let width = 10;
  let height = FIELD_HEIGHT;
  const requestedTime = Number(params.get('t'));
  let time = import.meta.env.DEV && Number.isFinite(requestedTime) ? Math.max(0, requestedTime) : 0;
  let disposed = false;
  let dirty = true;
  let previousTime = 0;
  let paint: DicePaint;
  let luminanceAttribute: THREE.InstancedBufferAttribute;
  let revealAttribute: THREE.InstancedBufferAttribute;
  let activePointer: number | undefined;
  const lastPointer = new THREE.Vector2(Infinity, Infinity);
  const velocity = new THREE.Vector2();
  let lastPointerTime = 0;
  let pointerMoved = false;
  const transform = new THREE.Object3D();
  const color = new THREE.Color();

  function rebuild() {
    meshes.forEach(mesh => { scene.remove(mesh); mesh.dispose(); });
    cells = createField(width, height);
    const previousPaint = paint;
    paint = new DicePaint(cells, width, height);
    if (previousPaint) paint.reframe(previousPaint, time);
    geometry.lights.dispose();
    luminanceAttribute = new THREE.InstancedBufferAttribute(new Float32Array(cells.length), 1);
    luminanceAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.lights.setAttribute('cellLuminance', luminanceAttribute);
    revealAttribute = new THREE.InstancedBufferAttribute(new Float32Array(cells.length), 1);
    revealAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.lights.setAttribute('cellReveal', revealAttribute);
    meshes = [
      new THREE.InstancedMesh(geometry.shell, shellMaterial, cells.length),
      new THREE.InstancedMesh(geometry.sockets, socketMaterial, cells.length),
      new THREE.InstancedMesh(geometry.lights, lightMaterial, cells.length),
    ];
    meshes.forEach((mesh, index) => {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = index === 0;
      mesh.receiveShadow = index !== 2;
      scene.add(mesh);
    });
    cells.forEach((cell, index) => {
      // Charcoal enamel varies from near-black to a muted graphite face.
      const shade = 0.33 + random(cell.seed + 45) * 0.67;
      color.setRGB(shade, shade, shade);
      meshes[0].setColorAt(index, color);
    });
    dirty = true;
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const aspect = w / h;
    // Portrait matches the source's ten columns; landscape extends the wall.
    height = (aspect < 0.7 ? 10 / aspect : FIELD_HEIGHT) / look.size;
    width = height * aspect;
    camera.aspect = aspect;
    camera.position.z = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    camera.far = Math.max(100, camera.position.z + 10);
    camera.updateProjectionMatrix();
    const extent = Math.max(width, height) * 0.65;
    Object.assign(key.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent });
    key.shadow.camera.updateProjectionMatrix();
    const ratio = Math.min(devicePixelRatio, 2, Math.sqrt(2400000 / (w * h)));
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(ratio);
    composer.setSize(w, h);
    rebuild();
  }

  function pointerPosition(event: PointerEvent) {
    const bounds = canvas.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * width;
    const y = (0.5 - (event.clientY - bounds.top) / bounds.height) * height;
    return { x, y };
  }
  canvas.addEventListener('pointerdown', event => {
    if (activePointer !== undefined) return;
    activePointer = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    const { x, y } = pointerPosition(event);
    lastPointer.set(x, y);
    lastPointerTime = event.timeStamp;
    velocity.set(0, 0);
    pointerMoved = false;
    paint.beginStroke(time);
  }, { signal: events.signal });
  function drawSample(event: PointerEvent) {
    const point = pointerPosition(event);
    const dx = point.x - lastPointer.x;
    const dy = point.y - lastPointer.y;
    if (Math.hypot(dx, dy) < 0.025) return;
    const seconds = Math.max((event.timeStamp - lastPointerTime) / 1000, 0.008);
    const weight = pointerMoved ? 0.45 : 1;
    velocity.lerp(new THREE.Vector2(dx / seconds, dy / seconds), weight);
    processView.record(lastPointer, point, velocity, width, height, look.brushWidth);
    paint.paint(lastPointer, point, time, velocity, reducedMotion.matches || !look.animate, 0.9 * look.brushWidth, look.spinDuration);
    lastPointer.set(point.x, point.y);
    lastPointerTime = event.timeStamp;
    pointerMoved = true;
    dirty = true;
  }
  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== activePointer) return;
    const samples = event.getCoalescedEvents?.() ?? [];
    for (const sample of samples.length ? samples : [event]) drawSample(sample);
  }, { signal: events.signal });
  canvas.addEventListener('pointerup', event => {
    if (event.pointerId !== activePointer) return;
    drawSample(event);
    if (!pointerMoved) {
      processView.record(lastPointer, lastPointer, { x: 0, y: 0 }, width, height, look.brushWidth);
      paint.paint(lastPointer, lastPointer, time, { x: 0, y: 0 }, reducedMotion.matches || !look.animate, 0.9 * look.brushWidth, look.spinDuration);
      dirty = true;
    }
    activePointer = undefined;
  }, { signal: events.signal });
  const releasePointer = (event: PointerEvent) => {
    if (activePointer === event.pointerId) activePointer = undefined;
  };
  canvas.addEventListener('pointercancel', releasePointer, { signal: events.signal });
  canvas.addEventListener('lostpointercapture', releasePointer, { signal: events.signal });
  function reset() {
    if (activePointer !== undefined && canvas.hasPointerCapture(activePointer)) {
      canvas.releasePointerCapture(activePointer);
    }
    activePointer = undefined;
    pointerMoved = false;
    velocity.set(0, 0);
    lastPointer.set(Infinity, Infinity);
    time = previousTime = 0;
    paint.reset();
    processView.reset();
    dirty = true;
  }
  window.addEventListener('keydown', event => {
    if ((event.target as HTMLElement)?.closest('.lil-gui')) return;
    if (event.code === 'Space') { event.preventDefault(); look.animate = !look.animate; dirty = true; }
    if (event.key.toLowerCase() === 'r') reset();
    if (event.key.toLowerCase() === 'd' && !event.repeat) setGuiVisible(!guiVisible);
  }, { signal: events.signal });
  reducedMotion.addEventListener('change', () => {
    look.animate = !reducedMotion.matches;
    if (reducedMotion.matches) paint.settle(time);
    dirty = true;
  }, { signal: events.signal });
  document.addEventListener('visibilitychange', () => { previousTime = 0; }, { signal: events.signal });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    renderer.setAnimationLoop(null);
    status.hidden = false;
    status.textContent = '그래픽 연결이 끊겼습니다. 페이지를 새로고침해 주세요.';
  }, { signal: events.signal });

  const gui = new GUI({ title: 'Glow Dice', width: 280 });
  gui.domElement.id = 'dice-controls';
  let guiVisible = true;
  function setGuiVisible(visible: boolean) {
    guiVisible = visible;
    if (visible) gui.show(); else gui.hide();
  }
  gui.add(look, 'size', 0.3, 1.8, 0.05).name('주사위 크기').onFinishChange(() => {
    if (activePointer !== undefined) reset();
    resize();
  });
  gui.add(look, 'brushWidth', 0.3, 3, 0.05).name('커서 두께');
  gui.add(look, 'spinDuration', 0, 5, 0.05).name('중간 회전 시간 (초)');
  gui.add(look, 'preset', [...Object.keys(COLOR_PRESETS), '직접 설정']).name('프리셋').listen().onChange((name: string) => {
    if (!(name in COLOR_PRESETS)) return;
    Object.assign(look, COLOR_PRESETS[name as ColorPreset]);
    shellMaterial.color.set(look.diceColor);
    shellMaterial.roughness = look.roughness;
    shellMaterial.clearcoat = look.clearcoat;
    shellMaterial.envMapIntensity = look.environment;
    lightMaterial.emissive.set(look.pipColor);
    backgroundMaterial.color.set(look.backgroundColor);
    renderer.setClearColor(look.backgroundColor);
    renderer.toneMappingExposure = look.exposure;
    softbox.color.set(look.lightColor);
    key.color.set(look.lightColor);
    softbox.intensity = look.softboxIntensity;
    key.intensity = look.keyIntensity;
    fill.intensity = look.fillIntensity;
    ambient.intensity = look.ambientIntensity;
    uniforms.intensity.value = look.light;
    bloom.strength = look.glow;
    gui.controllersRecursive().forEach(controller => controller.updateDisplay());
    dirty = true;
  });
  gui.onChange(event => {
    if (event.property in COLOR_PRESETS['차콜 · 기본']) look.preset = '직접 설정';
  });
  const lighting = gui.addFolder('조명');
  lighting.add(look, 'exposure', 0.2, 2.5, 0.01).name('노출').onChange(() => { renderer.toneMappingExposure = look.exposure; dirty = true; });
  lighting.addColor(look, 'lightColor').name('조명 색').onChange(() => { softbox.color.set(look.lightColor); key.color.set(look.lightColor); dirty = true; });
  lighting.add(look, 'softboxIntensity', 0, 6, 0.01).name('넓은 조명').onChange(() => { softbox.intensity = look.softboxIntensity; dirty = true; });
  lighting.add(look, 'keyIntensity', 0, 2, 0.01).name('그림자 조명').onChange(() => { key.intensity = look.keyIntensity; dirty = true; });
  lighting.add(look, 'fillIntensity', 0, 1, 0.01).name('보조 조명').onChange(() => { fill.intensity = look.fillIntensity; dirty = true; });
  lighting.add(look, 'ambientIntensity', 0, 1, 0.01).name('전체 밝기').onChange(() => { ambient.intensity = look.ambientIntensity; dirty = true; });
  lighting.close();
  const palette = gui.addFolder('색감');
  palette.addColor(look, 'diceColor').name('주사위 색').onChange(() => { shellMaterial.color.set(look.diceColor); dirty = true; });
  palette.addColor(look, 'pipColor').name('눈의 색').onChange(() => { lightMaterial.emissive.set(look.pipColor); dirty = true; });
  palette.addColor(look, 'backgroundColor').name('배경 색').onChange(() => { backgroundMaterial.color.set(look.backgroundColor); renderer.setClearColor(look.backgroundColor); dirty = true; });
  palette.add(look, 'light', 0, 3, 0.01).name('눈의 밝기').onChange(() => { uniforms.intensity.value = look.light; dirty = true; });
  palette.add(look, 'glow', 0, 0.6, 0.01).name('빛 번짐').onChange(() => { bloom.strength = look.glow; dirty = true; });
  palette.close();
  const motion = gui.addFolder('움직임');
  motion.add(look, 'animate').name('애니메이션').listen();
  motion.add({ reset }, 'reset').name('처음으로');
  motion.close();
  const material = gui.addFolder('재질');
  material.add(look, 'roughness', 0.1, 0.65, 0.01).name('표면 거칠기').onChange(() => { shellMaterial.roughness = look.roughness; dirty = true; });
  material.add(look, 'clearcoat', 0, 1, 0.01).name('코팅 반사').onChange(() => { shellMaterial.clearcoat = look.clearcoat; dirty = true; });
  material.add(look, 'environment', 0, 1.5, 0.01).name('주변 반사').onChange(() => { shellMaterial.envMapIntensity = look.environment; dirty = true; });
  material.close();
  gui.add({ save: () => {
    const imageCanvas = processView.canvas.hidden ? canvas : processView.canvas;
    imageCanvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = paint.active ? 'glow-dice-drawing.png' : 'glow-dice.png';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  } }, 'save').name('이미지 저장');

  const stepper = createStepper({
    steps: PROCESS_STEPS,
    initialStep: 'final',
    ariaLabel: '주사위 렌더링 단계',
    onChange: next => {
      if (paint) reset();
      stage = next;
      canvas.setAttribute('aria-label', `${STAGE_DESCRIPTIONS[stage]}. 드래그로 그리기, R로 지우기, Space로 일시 정지, 1–5로 단계 선택.`);
      dirty = true;
    },
  });
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  renderer.setAnimationLoop(now => {
    if (document.hidden || disposed) { previousTime = 0; return; }
    const delta = previousTime ? Math.min((now - previousTime) / 1000, 0.05) : 0;
    previousTime = now;
    if (look.animate) {
      // Keep a gesture clock; the dark wall and settled strokes can rest.
      const moving = paint.isMoving(time);
      time += delta;
      if (moving) dirty = true;
    }
    if (!dirty) return;
    cells.forEach((_, index) => {
      revealAttribute.setX(index, paint.pose(index, time, transform));
      luminanceAttribute.setX(index, paint.states[index].luminance);
      meshes.forEach(mesh => mesh.setMatrixAt(index, transform.matrix));
    });
    revealAttribute.needsUpdate = true;
    luminanceAttribute.needsUpdate = true;
    meshes.forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; });
    const neutral = stage === 'rotation';
    renderer.toneMapping = neutral ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    renderer.setClearColor(neutral ? '#030304' : look.backgroundColor);
    meshes[0].material = neutral ? neutralShell : shellMaterial;
    meshes[1].material = neutral ? neutralSocket : socketMaterial;
    meshes[2].material = neutral ? neutralPip : lightMaterial;
    background.visible = !neutral;
    bloom.enabled = stage === 'final';
    processView.draw(stage, paint, height, canvas);
    if (stage === 'rotation' || stage === 'final') composer.render();
    status.hidden = true;
    dirty = false;
  });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    renderer.setAnimationLoop(null);
    observer.disconnect();
    events.abort();
    gui.destroy();
    stepper.destroy();
    processView.dispose();
    [neutralShell, neutralSocket, neutralPip].forEach(material => material.dispose());
    meshes.forEach(mesh => mesh.dispose());
    Object.values(geometry).forEach(part => part.dispose());
    [shellMaterial, socketMaterial, lightMaterial, backgroundMaterial].forEach(material => material.dispose());
    backgroundGeometry.dispose();
    environment.dispose();
    bloom.dispose();
    output.dispose();
    composer.dispose();
    renderer.dispose();
  };
  window.addEventListener('pagehide', event => { if (!event.persisted) dispose(); }, { signal: events.signal });
  import.meta.hot?.dispose(dispose);
}

try { start(); }
catch (error) {
  console.error(error);
  status.textContent = '주사위를 렌더링할 수 없습니다. WebGL을 지원하는 브라우저로 열어 주세요.';
}
