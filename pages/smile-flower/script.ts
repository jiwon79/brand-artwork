/// <reference types="vite/client" />
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FLIP_DURATION, otherModel, sampleFlip, type ModelName } from './flip-motion';

const assets = {
  flower: new URL('./assets/flower.glb', import.meta.url).href,
  smiley: new URL('./assets/smiley.glb', import.meta.url).href,
};

// The same three softboxes illuminate both assets. The reflection environment
// is built locally, so the scene needs no external HDRI or texture downloads.
function studioEnvironment(renderer: THREE.WebGLRenderer) {
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0x111017);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const panels: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  function softbox(position: THREE.Vector3, width: number, height: number, intensity: number) {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(intensity, intensity, intensity) });
    const panel = new THREE.Mesh(geometry, material);
    panel.position.copy(position);
    panel.scale.set(width, height, 1);
    panel.lookAt(0, 0, 0);
    studio.add(panel);
    panels.push(panel);
  }
  softbox(new THREE.Vector3(-3, 4, 5), 3, 5, 4);
  softbox(new THREE.Vector3(4, 1, 3), 3, 4, 1.8);
  softbox(new THREE.Vector3(0, 3, -4), 4, 2, 3);
  const generator = new THREE.PMREMGenerator(renderer);
  const environment = generator.fromScene(studio, 0.035, 0.1, 30);
  generator.dispose();
  geometry.dispose();
  panels.forEach(panel => panel.material.dispose());
  return environment;
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
  const study = document.querySelector<HTMLElement>('.study')!;
  const stage = document.querySelector<HTMLElement>('.stage')!;
  const canvas = document.querySelector<HTMLCanvasElement>('#studio-canvas')!;
  const status = document.querySelector<HTMLElement>('.status')!;
  const title = document.querySelector<HTMLElement>('#model-title')!;
  const number = document.querySelector<HTMLElement>('.number')!;
  const button = document.querySelector<HTMLButtonElement>('.flip-button')!;
  const label = document.querySelector<HTMLElement>('.flip-label')!;
  const events = new AbortController();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.setClearColor(0x000000);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const scene = new THREE.Scene();
  const environment = studioEnvironment(renderer);
  scene.environment = environment.texture;
  const camera = new THREE.OrthographicCamera(-1.42, 1.42, 1.42, -1.42, 0.1, 30);
  camera.position.set(0, 0, 7);
  const pivot = new THREE.Group();
  scene.add(pivot);

  // Sample a broad key light with several shadow maps so the raised flower
  // center keeps its soft contact shadow, including while it turns.
  const keyPosition = new THREE.Vector3(-3, 5, 6);
  const right = new THREE.Vector3().crossVectors(keyPosition, THREE.Object3D.DEFAULT_UP).normalize();
  const up = new THREE.Vector3().crossVectors(right, keyPosition).normalize();
  const keyLights: THREE.DirectionalLight[] = [];
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI * (3 - Math.sqrt(5));
    const radius = 1.8 * Math.sqrt((i + 0.5) / 12);
    const light = new THREE.DirectionalLight(0xffedf7, 3 / 12);
    light.position.copy(keyPosition)
      .addScaledVector(right, radius * Math.cos(angle))
      .addScaledVector(up, radius * Math.sin(angle));
    light.castShadow = true;
    light.shadow.mapSize.set(512, 512);
    Object.assign(light.shadow.camera, { left: -1.5, right: 1.5, top: 1.5, bottom: -1.5, near: 0.1, far: 15 });
    light.shadow.bias = -0.000015;
    light.shadow.normalBias = 0.003;
    scene.add(light);
    keyLights.push(light);
  }
  const fill = new THREE.DirectionalLight(0xd6e4ff, 0.65);
  fill.position.set(4, 1, 3);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffd3e9, 1.8);
  rim.position.set(1, 3, -4);
  scene.add(rim);

  const models: Partial<Record<ModelName, THREE.Group>> = {};
  let current: ModelName = 'smiley';
  let displayed: ModelName = 'smiley';
  let animation: { from: ModelName; elapsed: number } | undefined;
  let ready = false;
  let disposed = false;
  let visible = true;
  let shadowsDirty = true;
  let previousTime: number | undefined;

  function showModel(name: ModelName) {
    for (const modelName of ['smiley', 'flower'] as const) {
      if (models[modelName]) models[modelName]!.visible = modelName === name;
    }
    if (displayed !== name) shadowsDirty = true;
    displayed = name;
    if (study.dataset.model === name) return;
    study.dataset.model = name;
    title.textContent = name === 'smiley' ? 'Smiley' : 'Flower';
    number.textContent = name === 'smiley' ? '01' : '02';
    canvas.setAttribute('aria-label', name === 'smiley' ? '스마일 3D 모델' : '꽃 3D 모델');
  }

  function finishFlip(target: ModelName) {
    animation = undefined;
    current = target;
    pivot.rotation.x = 0;
    showModel(target);
    shadowsDirty = true;
    stage.setAttribute('aria-busy', 'false');
    button.removeAttribute('aria-disabled');
    label.textContent = target === 'smiley' ? '꽃으로 바꾸기' : '스마일로 바꾸기';
  }

  button.addEventListener('click', () => {
    if (!ready || animation) return;
    if (reducedMotion.matches) {
      finishFlip(otherModel(current));
      return;
    }
    animation = { from: current, elapsed: 0 };
    previousTime = undefined;
    // Keep keyboard focus while guarding against repeated clicks mid-turn.
    button.setAttribute('aria-disabled', 'true');
    stage.setAttribute('aria-busy', 'true');
    label.textContent = '전환 중…';
  }, { signal: events.signal });

  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches && animation) finishFlip(otherModel(animation.from));
  }, { signal: events.signal });

  const resize = new ResizeObserver(() => {
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    const aspect = width / height;
    const halfHeight = 1.42 / Math.min(aspect, 1);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
  });
  resize.observe(stage);
  const intersection = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    previousTime = undefined;
  });
  intersection.observe(stage);

  const loader = new GLTFLoader();
  Promise.all((['smiley', 'flower'] as const).map(async name => {
    const gltf = await loader.loadAsync(assets[name]);
    if (disposed) {
      disposeModel(gltf.scene);
      return;
    }
    // Both silhouettes become nearly the same thin edge at 90 degrees.
    // Center the full depth on the pivot so that edge doesn't jump on swap.
    const center = new THREE.Box3().setFromObject(gltf.scene).getCenter(new THREE.Vector3());
    gltf.scene.position.z -= center.z;
    gltf.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = name === 'flower';
      object.receiveShadow = name === 'flower';
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => {
        if (material instanceof THREE.MeshStandardMaterial) material.envMapIntensity = 0.85;
      });
    });
    gltf.scene.visible = false;
    models[name] = gltf.scene;
    pivot.add(gltf.scene);
  })).then(() => {
    if (disposed) return;
    // Warm both materials and the flower's shadow programs before enabling
    // the button. The first turn should not wait for shader compilation.
    renderer.compile(scene, camera);
    const warmTarget = new THREE.WebGLRenderTarget(1, 1);
    try {
      renderer.setRenderTarget(warmTarget);
      models.flower!.visible = true;
      renderer.shadowMap.needsUpdate = true;
      renderer.render(scene, camera);
      models.flower!.visible = false;
      models.smiley!.visible = true;
      renderer.render(scene, camera);
    } finally {
      renderer.setRenderTarget(null);
      warmTarget.dispose();
    }
    finishFlip('smiley');
    renderer.render(scene, camera);
    ready = true;
    status.hidden = true;
    button.disabled = false;
  }).catch(error => {
    if (disposed) return;
    console.error('Could not prepare the flower and smiley models.', error);
    status.textContent = '모델을 불러오지 못했습니다. 페이지를 새로고침해 주세요.';
    status.classList.add('error');
    stage.setAttribute('aria-busy', 'false');
  });

  renderer.setAnimationLoop((time: number) => {
    if (!ready || document.hidden || !visible) {
      previousTime = undefined;
      return;
    }
    const delta = previousTime === undefined ? 0 : Math.min((time - previousTime) / 1000, 0.05);
    previousTime = time;
    if (animation) {
      animation.elapsed += delta;
      const pose = sampleFlip(animation.from, animation.elapsed / FLIP_DURATION);
      pivot.rotation.x = pose.rotationX;
      showModel(pose.model);
      if (animation.elapsed >= FLIP_DURATION) finishFlip(otherModel(animation.from));
    }
    if (displayed === 'flower' && (animation || shadowsDirty)) {
      renderer.shadowMap.needsUpdate = true;
      shadowsDirty = false;
    }
    renderer.render(scene, camera);
  });

  return () => {
    disposed = true;
    ready = false;
    renderer.setAnimationLoop(null);
    events.abort();
    resize.disconnect();
    intersection.disconnect();
    Object.values(models).forEach(disposeModel);
    keyLights.forEach(light => light.shadow.dispose());
    environment.dispose();
    renderer.dispose();
  };
}

let dispose: (() => void) | undefined;
try {
  dispose = start();
} catch (error) {
  console.error('Could not start the 3D viewer.', error);
  document.querySelector('.status')!.textContent = '3D 화면을 시작하지 못했습니다. WebGL을 사용할 수 있는 브라우저에서 열어 주세요.';
  document.querySelector('.stage')!.setAttribute('aria-busy', 'false');
}
window.addEventListener('pagehide', event => {
  if (!event.persisted) dispose?.();
});
if (import.meta.hot) import.meta.hot.dispose(() => dispose?.());
