/// <reference types="vite/client" />
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const assets = {
  flower: new URL('./assets/flower.glb', import.meta.url).href,
  smiley: new URL('./assets/smiley.glb', import.meta.url).href,
};
type ModelName = keyof typeof assets;

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

async function createStudy(section: HTMLElement) {
  const name = section.dataset.model as ModelName;
  const stage = section.querySelector<HTMLElement>('.stage')!;
  const canvas = section.querySelector<HTMLCanvasElement>('canvas')!;
  const status = section.querySelector<HTMLElement>('.status')!;
  const rotate = section.querySelector<HTMLButtonElement>('[data-action="rotate"]')!;
  const reset = section.querySelector<HTMLButtonElement>('[data-action="reset"]')!;
  const listeners = new AbortController();
  let disposed = false;
  let failed = false;
  let visible = true;
  let model: THREE.Group | undefined;
  let renderer: THREE.WebGLRenderer;

  function showError(message: string) {
    failed = true;
    status.hidden = false;
    status.classList.add('error');
    status.textContent = message;
    stage.setAttribute('aria-busy', 'false');
    rotate.disabled = reset.disabled = true;
  }

  try {
    renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance',
      // Preserve displayed pixels for stable canvas captures.
      preserveDrawingBuffer: true,
    });
  } catch (error) {
    console.error(`${name}: WebGL initialization failed`, error);
    showError('3D 화면을 열지 못했습니다. 브라우저의 하드웨어 가속 설정을 확인한 뒤 새로고침해주세요.');
    return () => listeners.abort();
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.shadowMap.enabled = name === 'flower';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Geometry and lights stay fixed while the camera orbits. Cache the shadow
  // maps after the asset arrives instead of redrawing them on every orbit frame.
  renderer.shadowMap.autoUpdate = false;
  const scene = new THREE.Scene();
  const environment = studioEnvironment(renderer);
  scene.environment = environment.texture;

  // Sample a broad key light to soften the petal contact shadows. A single
  // variance shadow map leaks light through the thin overlapping shells.
  const keys: THREE.DirectionalLight[] = [];
  const sampleCount = name === 'flower' ? 12 : 1;
  const keyPosition = new THREE.Vector3(-3, 5, 6);
  const right = new THREE.Vector3().crossVectors(keyPosition, THREE.Object3D.DEFAULT_UP).normalize();
  const up = new THREE.Vector3().crossVectors(right, keyPosition).normalize();
  for (let index = 0; index < sampleCount; index++) {
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    const radius = sampleCount === 1 ? 0 : 1.8 * Math.sqrt((index + 0.5) / sampleCount);
    const key = new THREE.DirectionalLight(0xffedf7, 3 / sampleCount);
    key.position.copy(keyPosition)
      .addScaledVector(right, Math.cos(angle) * radius)
      .addScaledVector(up, Math.sin(angle) * radius);
    key.castShadow = name === 'flower';
    key.shadow.mapSize.set(512, 512);
    key.shadow.camera.left = key.shadow.camera.bottom = -1.5;
    key.shadow.camera.right = key.shadow.camera.top = 1.5;
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 15;
    key.shadow.bias = -0.000015;
    key.shadow.normalBias = 0.003;
    keys.push(key);
    scene.add(key);
  }
  const fill = new THREE.DirectionalLight(0xd6e4ff, 0.65);
  fill.position.set(4, 1, 3);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffd3e9, 1.8);
  rim.position.set(1, 3, -4);
  scene.add(rim);

  const camera = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 30);
  camera.position.set(0, 0.75, 7);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minZoom = 0.65;
  controls.maxZoom = 2.4;
  controls.rotateSpeed = 0.65;
  controls.zoomSpeed = 0.6;
  controls.autoRotateSpeed = 0.8;
  controls.update();
  controls.saveState();

  function stopRotation() {
    controls.autoRotate = false;
    rotate.setAttribute('aria-pressed', 'false');
  }
  function resetView() {
    stopRotation();
    controls.reset();
    // Clear the damping tail so a reset during a drag lands exactly at home.
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = damping;
    controls.reset();
  }
  controls.addEventListener('start', stopRotation);
  rotate.addEventListener('click', () => {
    controls.autoRotate = !controls.autoRotate;
    rotate.setAttribute('aria-pressed', String(controls.autoRotate));
  }, { signal: listeners.signal });
  reset.addEventListener('click', resetView, { signal: listeners.signal });
  canvas.addEventListener('keydown', event => {
    if (failed) return;
    const supported = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', '+', '=', '-', '_'];
    if (!supported.includes(event.key)) return;
    event.preventDefault();
    stopRotation();
    if (event.key === 'Home') return resetView();
    const offset = camera.position.clone().sub(controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    if (event.key === 'ArrowLeft') spherical.theta -= 0.12;
    if (event.key === 'ArrowRight') spherical.theta += 0.12;
    if (event.key === 'ArrowUp') spherical.phi -= 0.12;
    if (event.key === 'ArrowDown') spherical.phi += 0.12;
    spherical.makeSafe();
    camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
    if (['+', '=', '-', '_'].includes(event.key)) {
      camera.zoom = THREE.MathUtils.clamp(camera.zoom * (['+', '='].includes(event.key) ? 1.1 : 1 / 1.1), controls.minZoom, controls.maxZoom);
      camera.updateProjectionMatrix();
    }
    controls.update();
  }, { signal: listeners.signal });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    showError('3D 연결이 끊어졌습니다. 페이지를 새로고침하면 다시 볼 수 있습니다.');
  }, { signal: listeners.signal });

  const resize = new ResizeObserver(() => {
    const { width, height } = stage.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    const aspect = width / height;
    // Keep the whole silhouette inside the shorter dimension, including phones.
    const halfHeight = 1.42 / Math.min(aspect, 1);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
  });
  resize.observe(stage);
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
  });
  intersection.observe(stage);

  let previousTime = 0;
  renderer.setAnimationLoop(time => {
    const delta = Math.min((time - previousTime) / 1000, 0.05);
    previousTime = time;
    if (document.hidden || !visible || failed) return;
    controls.update(delta);
    // Present both visible canvases together, including the idle model while
    // its neighbor is being manipulated or the browser redraws the page.
    renderer.render(scene, camera);
  });

  // Do not await loading before returning cleanup: Vite can replace this module
  // while a GLB request is pending, and the late result must be disposed too.
  new GLTFLoader().load(assets[name], gltf => {
    if (disposed) return disposeModel(gltf.scene);
    model = gltf.scene;
    model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      // The puck's sub-millimeter cut lips are lit by their actual normals.
      // A shadow-map texel is wider than these lips and produces false speckles.
      object.receiveShadow = name === 'flower';
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => {
        if (material instanceof THREE.MeshStandardMaterial) material.envMapIntensity = 0.85;
      });
    });
    scene.add(model);
    renderer.shadowMap.needsUpdate = true;
    if (!failed) {
      status.hidden = true;
      stage.setAttribute('aria-busy', 'false');
      rotate.disabled = reset.disabled = false;
    }
  }, undefined, error => {
    if (disposed) return;
    console.error(`${name}: model loading failed`, error);
    showError('모델을 불러오지 못했습니다. 연결을 확인한 뒤 새로고침해주세요.');
  });

  return () => {
    disposed = true;
    listeners.abort();
    resize.disconnect();
    intersection.disconnect();
    controls.dispose();
    renderer.setAnimationLoop(null);
    if (model) disposeModel(model);
    keys.forEach(key => key.shadow.dispose());
    environment.dispose();
    renderer.dispose();
  };
}

const studies = [...document.querySelectorAll<HTMLElement>('.study')].map(createStudy);
function dispose() { studies.forEach(study => { void study.then(cleanup => cleanup()); }); }
window.addEventListener('pagehide', event => { if (!event.persisted) dispose(); }, { once: true });
if (import.meta.hot) import.meta.hot.dispose(dispose);
