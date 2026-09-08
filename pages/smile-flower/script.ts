/// <reference types="vite/client" />
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CELLS, CORE_PALETTE, PALETTE, PETAL_PALETTE, REFERENCE_HEIGHT, REFERENCE_WIDTH } from './reference-layout';
import { FLIP_DURATION, REST_ANGLE, otherModel, sampleFlip, sampleRipple, type ModelName } from './flip-motion';

const assets = {
  field: {
    flower: new URL('./assets/flower-web.glb', import.meta.url).href,
    smiley: new URL('./assets/smiley-web.glb', import.meta.url).href,
  },
  single: {
    flower: new URL('./assets/flower.glb', import.meta.url).href,
    smiley: new URL('./assets/smiley.glb', import.meta.url).href,
  },
};
type ViewMode = 'field' | 'single';
type Part = { mesh: THREE.InstancedMesh; materialName: string; model: ModelName; variant: ViewMode; colors: THREE.Color[] };

function studioEnvironment(renderer: THREE.WebGLRenderer) {
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0x0e0b10);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const materials: THREE.MeshBasicMaterial[] = [];
  function softbox(x: number, y: number, z: number, width: number, height: number, power: number) {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(power, power, power) });
    materials.push(material);
    const panel = new THREE.Mesh(geometry, material);
    panel.position.set(x, y, z);
    panel.scale.set(width, height, 1);
    panel.lookAt(0, 0, 0);
    studio.add(panel);
  }
  softbox(-3, 4, 5, 4, 5, 0.25);
  softbox(0, -4, 5, 8, 4, 3);
  softbox(0, 4, -3, 4, 2, 2.5);
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(studio, 0.025, 0.1, 30);
  generator.dispose();
  geometry.dispose();
  materials.forEach(material => material.dispose());
  return target;
}

function disposeModel(root: THREE.Object3D) {
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach(material => material.dispose());
  });
}

function start() {
  const artwork = document.querySelector<HTMLElement>('.artwork')!;
  const stage = document.querySelector<HTMLElement>('.stage')!;
  const canvas = document.querySelector<HTMLCanvasElement>('canvas')!;
  const status = document.querySelector<HTMLElement>('.status')!;
  const announcement = document.querySelector<HTMLElement>('#model-status')!;
  const modeButton = document.querySelector<HTMLButtonElement>('.mode-button')!;
  const playButton = document.querySelector<HTMLButtonElement>('.play-button')!;
  const replayButton = document.querySelector<HTMLButtonElement>('.replay-button')!;
  const flipButton = document.querySelector<HTMLButtonElement>('.flip-button')!;
  const events = new AbortController();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const query = new URLSearchParams(location.search);
  let mode: ViewMode = query.get('mode') === 'single' ? 'single' : 'field';
  let current: ModelName = 'smiley';
  let singleFlip: { from: ModelName; elapsed: number } | undefined;
  let timeline = 0;
  let paused = reducedMotion.matches;
  let ready = false;
  let disposed = false;
  let visible = true;
  let previousTime: number | undefined;
  let dirty = true;
  let controlsTimer: ReturnType<typeof setTimeout> | undefined;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.82;
  renderer.setClearColor(0x000000);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const environment = studioEnvironment(renderer);
  scene.environment = environment.texture;
  const camera = new THREE.OrthographicCamera(-6, 6, REFERENCE_HEIGHT / 2, -REFERENCE_HEIGHT / 2, 0.1, 70);
  camera.position.set(0, 0, 30);
  const parts: Part[] = [];
  const keyLights: THREE.DirectionalLight[] = [];
  const keyPosition = new THREE.Vector3(-3, 5, 3.5);
  const keyRight = new THREE.Vector3().crossVectors(keyPosition, THREE.Object3D.DEFAULT_UP).normalize();
  const keyUp = new THREE.Vector3().crossVectors(keyRight, keyPosition).normalize();
  for (let i = 0; i < 5; i++) {
    const key = new THREE.DirectionalLight(0xfff1fb, 4.45 / 5);
    const angle = i * Math.PI * (3 - Math.sqrt(5));
    const radius = 2.5 * Math.sqrt((i + 0.5) / 5);
    key.position.copy(keyPosition).addScaledVector(keyRight, radius * Math.cos(angle))
      .addScaledVector(keyUp, radius * Math.sin(angle)).multiplyScalar(4);
    key.castShadow = true;
    key.shadow.mapSize.set(4096, 4096);
    Object.assign(key.shadow.camera, { left: -13, right: 13, top: 14, bottom: -14, near: 0.1, far: 70 });
    key.shadow.bias = -0.000005;
    key.shadow.normalBias = 0.001;
    scene.add(key);
    keyLights.push(key);
  }
  const fill = new THREE.DirectionalLight(0xe3e4ff, 0.32);
  fill.position.set(3, -1, 5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffe6f1, 1.3);
  rim.position.set(-3, 4, -3);
  scene.add(rim);

  const transform = new THREE.Object3D();
  const color = new THREE.Color();

  function colorInstances() {
    for (const part of parts) {
      part.mesh.visible = part.variant === mode;
      if (!part.mesh.visible) continue;
      part.mesh.count = mode === 'field' ? CELLS.length : 1;
      for (let index = 0; index < part.mesh.count; index++) {
        const cell = CELLS[index];
        const accent = mode === 'field' ? PALETTE[cell.color] : (part.model === 'smiley' ? PALETTE.P : PALETTE.B);
        if (part.model === 'smiley') {
          color.set(accent);
        } else if (part.materialName.includes('enamel')) {
          color.set(mode === 'field' ? CORE_PALETTE[cell.color] : CORE_PALETTE.B);
        } else if (part.materialName.includes('porcelain')) {
          color.set(mode === 'field' ? PETAL_PALETTE[cell.porcelain] : PETAL_PALETTE.P);
        } else if (part.materialName.includes('stamens')) {
          color.set('#62576a');
        } else {
          color.set('#eee4ea');
        }
        // The top of the reference receives more of the broad studio light.
        if (mode === 'field') color.multiplyScalar(0.6 + 0.4 * (cell.y + REFERENCE_HEIGHT / 2) / REFERENCE_HEIGHT);
        part.colors[index] = color.clone();
      }
      part.mesh.instanceColor!.needsUpdate = true;
    }
    dirty = true;
  }

  function updateMatrices() {
    const count = mode === 'field' ? CELLS.length : 1;
    for (const part of parts) part.mesh.count = 0;
    for (let index = 0; index < count; index++) {
      const cell = CELLS[index];
      const pose = mode === 'field'
        ? sampleRipple(timeline, Math.hypot(cell.x, cell.y))
        : singleFlip ? sampleFlip(singleFlip.from, singleFlip.elapsed / FLIP_DURATION[singleFlip.from])
          : { model: current, rotationX: REST_ANGLE[current] };
      transform.position.set(mode === 'field' ? cell.x : 0, mode === 'field' ? cell.y : 0, 0);
      transform.rotation.set(pose.rotationX, 0, 0);
      transform.scale.setScalar((mode === 'field' ? 0.98 : 1) * (pose.model === 'flower' ? 1 : 0.98));
      transform.updateMatrix();
      for (const part of parts) {
        if (part.variant !== mode || part.model !== pose.model) continue;
        const slot = part.mesh.count++;
        part.mesh.setMatrixAt(slot, transform.matrix);
        part.mesh.setColorAt(slot, part.colors[index]);
      }
    }
    for (const part of parts) {
      part.mesh.instanceMatrix.needsUpdate = true;
      part.mesh.instanceColor!.needsUpdate = true;
    }
    renderer.shadowMap.needsUpdate = true;
  }

  function resizeView() {
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    const halfHeight = mode === 'field' ? REFERENCE_HEIGHT / 2 : 1.38 / Math.min(width / height, 1);
    const halfWidth = mode === 'field' ? REFERENCE_WIDTH / 2 : halfHeight * width / height;
    Object.assign(camera, { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight });
    camera.updateProjectionMatrix();
    const shadowSamples = mode === 'field' ? 3 : 5;
    for (const [index, light] of keyLights.entries()) {
      light.castShadow = index < shadowSamples;
      light.intensity = index < shadowSamples ? 4.45 / shadowSamples : 0;
      const angle = index * Math.PI * (3 - Math.sqrt(5));
      const radius = 2.5 * Math.sqrt((index + 0.5) / shadowSamples);
      light.position.copy(keyPosition).addScaledVector(keyRight, radius * Math.cos(angle))
        .addScaledVector(keyUp, radius * Math.sin(angle)).multiplyScalar(4);
      const size = mode === 'field' ? 14 : 1.6;
      Object.assign(light.shadow.camera, { left: -size, right: size, top: size, bottom: -size });
      light.shadow.camera.updateProjectionMatrix();
      light.shadow.normalBias = 0.001;
      light.shadow.radius = mode === 'field' ? 6 : 32;
    }
    // Keep at least the original 1080p raster on a small display and respect
    // high-DPI phones. Bound total pixels, rather than capping every device at 2x.
    const targetWidth = mode === 'field' ? 1080 : 1200;
    const desiredRatio = Math.max(devicePixelRatio, targetWidth / width);
    const pixelBudgetRatio = Math.sqrt(3_500_000 / (width * height));
    const textureLimitRatio = renderer.capabilities.maxTextureSize / Math.max(width, height);
    renderer.setPixelRatio(Math.min(desiredRatio, pixelBudgetRatio, textureLimitRatio));
    renderer.setSize(width, height, false);
    dirty = true;
  }

  function showControls() {
    artwork.classList.add('controls-visible');
    clearTimeout(controlsTimer);
    controlsTimer = setTimeout(() => artwork.classList.remove('controls-visible'), 2200);
  }

  function syncControls() {
    artwork.dataset.mode = mode;
    artwork.dataset.paused = String(paused);
    modeButton.textContent = mode === 'field' ? '하나씩 보기' : '전체 보기';
    playButton.hidden = replayButton.hidden = mode !== 'field';
    flipButton.hidden = mode !== 'single';
    playButton.textContent = paused ? '재생' : '일시정지';
    playButton.setAttribute('aria-label', paused ? '애니메이션 재생' : '애니메이션 일시정지');
    canvas.setAttribute('aria-label', mode === 'field' ? '꽃과 스마일이 원형 물결을 따라 뒤집히는 3D 애니메이션' : (current === 'smiley' ? '스마일 3D 모델' : '꽃 3D 모델'));
    flipButton.textContent = current === 'smiley' ? '꽃으로 바꾸기 ↻' : '스마일로 바꾸기 ↻';
  }

  function finishFlip() {
    if (!singleFlip) return;
    current = otherModel(singleFlip.from);
    singleFlip = undefined;
    flipButton.removeAttribute('aria-disabled');
    artwork.setAttribute('aria-busy', 'false');
    announcement.textContent = current === 'smiley' ? '스마일' : '꽃';
    syncControls();
    dirty = true;
  }

  modeButton.addEventListener('click', () => {
    if (!ready) return;
    finishFlip();
    mode = mode === 'field' ? 'single' : 'field';
    current = 'smiley';
    timeline = 0;
    announcement.textContent = mode === 'field' ? '전체 애니메이션' : '스마일';
    syncControls();
    colorInstances();
    resizeView();
    showControls();
  }, { signal: events.signal });
  playButton.addEventListener('click', () => {
    paused = !paused;
    previousTime = undefined;
    syncControls();
    showControls();
  }, { signal: events.signal });
  replayButton.addEventListener('click', () => {
    timeline = 0;
    previousTime = undefined;
    paused = reducedMotion.matches;
    dirty = true;
    syncControls();
    showControls();
  }, { signal: events.signal });
  flipButton.addEventListener('click', () => {
    if (!ready || singleFlip) return;
    singleFlip = { from: current, elapsed: 0 };
    previousTime = undefined;
    if (reducedMotion.matches) return finishFlip();
    flipButton.setAttribute('aria-disabled', 'true');
    flipButton.textContent = '전환 중…';
    artwork.setAttribute('aria-busy', 'true');
  }, { signal: events.signal });
  artwork.addEventListener('pointermove', showControls, { signal: events.signal });
  artwork.addEventListener('pointerdown', showControls, { signal: events.signal });
  canvas.addEventListener('webglcontextrestored', () => { dirty = true; previousTime = undefined; }, { signal: events.signal });
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) {
      paused = true;
      finishFlip();
      syncControls();
    }
  }, { signal: events.signal });

  const resize = new ResizeObserver(resizeView);
  resize.observe(stage);
  const intersection = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    previousTime = undefined;
  });
  intersection.observe(stage);

  const loader = new GLTFLoader();
  const requests = (['field', 'single'] as const).flatMap(variant =>
    (['flower', 'smiley'] as const).map(model => ({ variant, model })));
  Promise.all(requests.map(async ({ variant, model }) => {
    const gltf = await loader.loadAsync(assets[variant][model]);
    if (disposed) return disposeModel(gltf.scene);
    gltf.scene.updateMatrixWorld(true);
    const depthCenter = new THREE.Box3().setFromObject(gltf.scene).getCenter(new THREE.Vector3()).z;
    gltf.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const original = object.material as THREE.MeshStandardMaterial;
      const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld).translate(0, 0, -depthCenter);
      const material = new THREE.MeshPhysicalMaterial({
        color: '#ffffff', roughness: original.roughness,
        metalness: 0, clearcoat: 0, ior: 1.46,
        specularIntensity: 0.35, envMapIntensity: 0.18,
        vertexColors: geometry.hasAttribute('color'),
      });
      // A slight crown gives the molded plastic face a soft lighting gradient.
      if (model === 'smiley') {
        material.onBeforeCompile = shader => {
          shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>',
            '#include <beginnormal_vertex>\nobjectNormal.xy += position.xy * 0.18 * pow(max(normal.z, 0.0), 12.0);');
        };
      }
      const mesh = new THREE.InstancedMesh(geometry, material, variant === 'field' ? CELLS.length : 1);
      mesh.name = model + ' · ' + original.name;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color());
      mesh.frustumCulled = false;
      mesh.castShadow = model === 'flower';
      mesh.receiveShadow = model === 'flower';
      scene.add(mesh);
      parts.push({ mesh, materialName: original.name, model, variant, colors: [] });
    });
    disposeModel(gltf.scene);
  })).then(async () => {
    if (disposed) return;
    syncControls();
    colorInstances();
    resizeView();
    updateMatrices();
    await renderer.compileAsync(scene, camera);
    if (disposed) return;
    renderer.render(scene, camera);
    ready = true;
    status.hidden = true;
    artwork.setAttribute('aria-busy', 'false');
    for (const button of [modeButton, playButton, replayButton, flipButton]) button.disabled = false;
    showControls();
  }).catch(error => {
    if (disposed) return;
    console.error('Could not prepare the artwork.', error);
    status.textContent = '모델을 불러오지 못했습니다. 페이지를 새로고침해 주세요.';
    artwork.setAttribute('aria-busy', 'false');
  });

  renderer.setAnimationLoop((time: number) => {
    if (!ready || document.hidden || !visible) {
      previousTime = undefined;
      return;
    }
    const delta = previousTime === undefined ? 0 : Math.min((time - previousTime) / 1000, 0.1);
    previousTime = time;
    const moving = mode === 'field' ? !paused : Boolean(singleFlip);
    if (mode === 'field' && !paused) timeline += delta;
    if (singleFlip) {
      singleFlip.elapsed += delta;
      if (singleFlip.elapsed >= FLIP_DURATION[singleFlip.from]) finishFlip();
    }
    if (moving || dirty) {
      updateMatrices();
      dirty = false;
      renderer.render(scene, camera);
    }
  });

  syncControls();
  return () => {
    disposed = true;
    ready = false;
    renderer.setAnimationLoop(null);
    clearTimeout(controlsTimer);
    events.abort();
    resize.disconnect();
    intersection.disconnect();
    parts.forEach(({ mesh }) => { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); mesh.dispose(); });
    keyLights.forEach(light => light.shadow.dispose());
    environment.dispose();
    renderer.dispose();
  };
}

let dispose: (() => void) | undefined;
try { dispose = start(); }
catch (error) {
  console.error('Could not start the artwork.', error);
  document.querySelector('.status')!.textContent = '3D 화면을 시작하지 못했습니다. WebGL을 지원하는 브라우저에서 열어 주세요.';
  document.querySelector('.artwork')!.setAttribute('aria-busy', 'false');
}
window.addEventListener('pagehide', event => { if (!event.persisted) dispose?.(); });
if (import.meta.hot) import.meta.hot.dispose(() => dispose?.());
