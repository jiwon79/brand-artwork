/// <reference types="vite/client" />
import * as THREE from 'three';
import GUI from 'lil-gui';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { exposeGuiInDebugMode } from '../../common/debug';
import { createDiceGeometry } from './geometry';
import { createField, FIELD_HEIGHT, poseCell, random, type Cell, type Ripple } from './field';

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
  animate: !reducedMotion.matches && !(import.meta.env.DEV && params.has('still')),
  speed: 1,
  exposure: 1,
  roughness: 0.4,
  clearcoat: 0.75,
  environment: 0.55,
  light: 1.35,
  glow: 0.18,
  density: 1,
};

function start() {
  const events = new AbortController();
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
  scene.add(new THREE.AmbientLight(0xd9dbe4, 0.12));

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
  const uniforms = { time: { value: 0 }, intensity: { value: look.light } };
  lightMaterial.onBeforeCompile = shader => {
    shader.uniforms.uTime = uniforms.time;
    shader.uniforms.uIntensity = uniforms.intensity;
    shader.vertexShader = `attribute float pipIndex;
      attribute float cellSeed;
      varying float vPip;
      varying float vSeed;
      ${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>
      vPip = pipIndex; vSeed = cellSeed;`);
    shader.fragmentShader = `uniform float uTime;
      uniform float uIntensity;
      varying float vPip;
      varying float vSeed;
      ${shader.fragmentShader}`.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float phase = vSeed * 91.7 + vPip * 13.73;
      float pulse = sin(uTime * (0.72 + fract(vSeed * 17.0) * 0.38) + phase);
      float lit = smoothstep(-0.32, -0.12, pulse);
      float variation = 0.85 + 0.15 * sin(phase * 2.3);
      totalEmissiveRadiance *= lit * variation * uIntensity;`);
  };

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
  let lastPointerRipple = -Infinity;
  const ripples: Ripple[] = [];
  const transform = new THREE.Object3D();
  const color = new THREE.Color();

  function rebuild() {
    meshes.forEach(mesh => { scene.remove(mesh); mesh.dispose(); });
    cells = createField(width, height);
    const seeds = new Float32Array(cells.map(cell => cell.seed));
    geometry.lights.setAttribute('cellSeed', new THREE.InstancedBufferAttribute(seeds, 1));
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
    height = (aspect < 0.7 ? 10 / aspect : FIELD_HEIGHT) / look.density;
    width = height * aspect;
    camera.aspect = aspect;
    camera.position.z = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
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

  function rippleAt(event: PointerEvent) {
    const bounds = canvas.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * width;
    const y = (0.5 - (event.clientY - bounds.top) / bounds.height) * height;
    ripples.push({ x, y, start: time - (look.animate ? 0 : 0.7) });
    if (ripples.length > 8) ripples.shift();
    lastPointerRipple = time;
    dirty = true;
  }
  canvas.addEventListener('pointerdown', event => {
    canvas.setPointerCapture(event.pointerId);
    rippleAt(event);
  }, { signal: events.signal });
  canvas.addEventListener('pointermove', event => {
    if (event.buttons && time - lastPointerRipple > 0.15) rippleAt(event);
  }, { signal: events.signal });
  window.addEventListener('keydown', event => {
    if ((event.target as HTMLElement)?.closest('.lil-gui')) return;
    if (event.code === 'Space') { event.preventDefault(); look.animate = !look.animate; dirty = true; }
    if (event.key.toLowerCase() === 'r') { time = 0; ripples.length = 0; dirty = true; }
  }, { signal: events.signal });
  reducedMotion.addEventListener('change', () => { look.animate = !reducedMotion.matches; dirty = true; }, { signal: events.signal });
  document.addEventListener('visibilitychange', () => { previousTime = 0; }, { signal: events.signal });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    renderer.setAnimationLoop(null);
    status.hidden = false;
    status.textContent = '그래픽 연결이 끊겼습니다. 페이지를 새로고침해 주세요.';
  }, { signal: events.signal });

  const gui = exposeGuiInDebugMode(new GUI({ title: 'Glow Dice' }));
  const motion = gui.addFolder('움직임');
  motion.add(look, 'animate').name('자동 회전').listen();
  motion.add(look, 'speed', 0.1, 2, 0.05).name('속도');
  motion.add(look, 'density', 0.6, 1.8, 0.05).name('주사위 크기').onFinishChange(resize);
  motion.add({ reset: () => { time = 0; ripples.length = 0; dirty = true; } }, 'reset').name('처음으로');
  const material = gui.addFolder('재질과 빛');
  material.add(look, 'exposure', 0.4, 1.8, 0.01).name('노출').onChange(() => { renderer.toneMappingExposure = look.exposure; dirty = true; });
  material.add(look, 'roughness', 0.1, 0.65, 0.01).name('표면 거칠기').onChange(() => { shellMaterial.roughness = look.roughness; dirty = true; });
  material.add(look, 'clearcoat', 0, 1, 0.01).name('코팅 반사').onChange(() => { shellMaterial.clearcoat = look.clearcoat; dirty = true; });
  material.add(look, 'environment', 0, 1.5, 0.01).name('주변 반사').onChange(() => { shellMaterial.envMapIntensity = look.environment; dirty = true; });
  material.add(look, 'light', 0, 3, 0.01).name('눈의 밝기').onChange(() => { uniforms.intensity.value = look.light; dirty = true; });
  material.add(look, 'glow', 0, 0.6, 0.01).name('빛 번짐').onChange(() => { bloom.strength = look.glow; dirty = true; });
  gui.add({ save: () => {
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'glow-dice.png';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  } }, 'save').name('이미지 저장');

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  renderer.setAnimationLoop(now => {
    if (document.hidden || disposed) { previousTime = 0; return; }
    const delta = previousTime ? Math.min((now - previousTime) / 1000, 0.05) : 0;
    previousTime = now;
    if (look.animate) { time += delta * look.speed; dirty = true; }
    if (!dirty) return;
    uniforms.time.value = time;
    while (ripples.length && time - ripples[0].start > 7) ripples.shift();
    cells.forEach((cell, index) => {
      poseCell(cell, time, ripples, transform);
      meshes.forEach(mesh => mesh.setMatrixAt(index, transform.matrix));
    });
    meshes.forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; });
    composer.render();
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
