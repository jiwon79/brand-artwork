import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { foregroundGlassShape, glassBodyWidthAt } from '../../../pages/rose-glass/deformation';

/** Undeformed foreground values from glassBody() in the actual shader. */
export function reliefSample(x: number, y: number) {
  const field = Math.abs(x) ** foregroundGlassShape.exponent + Math.abs(y) ** foregroundGlassShape.exponent;
  const depth = Math.sqrt(Math.max(0, 1 - field));
  const normal = new THREE.Vector3(Math.sign(x) * Math.abs(x) ** 1.45, Math.sign(y) * Math.abs(y) ** 1.45 * 0.62, depth * 0.7 + 0.03).normalize();
  return { field, depth, height: 100 + depth * 125, normal };
}

function position(x: number, y: number) {
  const materialY = y * foregroundGlassShape.height;
  return new THREE.Vector3((x * glassBodyWidthAt(2, y) + materialY * foregroundGlassShape.shear) / 250,
    reliefSample(x, y).depth * 0.5, -materialY / 250);
}

export function createReliefDemo() {
  const element = document.createElement('section');
  element.id = 'relief-demo'; element.className = 'interactive-demo';
  element.setAttribute('aria-labelledby', 'relief-demo-title');
  element.innerHTML = `<div class="demo-heading"><p class="eyebrow">가상 높이 · 직접 조작하기</p>
    <h3 id="relief-demo-title">계산한 높이를 3D 표면으로 펼쳐 보기</h3>
    <p>표면을 드래그해 돌려 보세요. 가운데가 솟고 가장자리로 갈수록 낮아지는 모양입니다. 아래에서 점의 위치를 바꾸면 높이와 조명용 법선도 함께 바뀝니다.</p></div>
    <div class="relief-scene"></div>
    <div class="touch-presets" role="group" aria-label="표면 시점"><button type="button" data-view="diagonal">비스듬히</button><button type="button" data-view="side">옆에서</button><button type="button" data-view="top">위에서</button></div>
    <label class="slider-label" for="relief-point"><span>중앙에서 가장자리까지</span><output id="relief-point-value" for="relief-point"></output></label>
    <input id="relief-point" type="range" min="0" max="1" step="0.01" value="0.45" />
    <div class="relief-values" aria-live="polite"><span>외곽 판별값 f <strong id="relief-field"></strong></span><span>상대 높이 depth <strong id="relief-depth"></strong></span><span>가상 높이 <strong id="relief-height"></strong></span></div>
    <p class="demo-note relief-calculation"></p>
    <p class="demo-note">붉은 점은 선택한 위치, 파란 화살표는 실제 셰이더의 조명용 법선입니다. 높이는 실제 계산값을 3D로 시각화한 것이며, 원래 작품이 이 3D 메시를 그리는 것은 아닙니다. 서리·눌림·드래그가 없는 기본 표면입니다.</p>`;
  const host = element.querySelector<HTMLElement>('.relief-scene')!;
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
  catch { host.textContent = '3D 표면을 보려면 WebGL을 지원하는 브라우저가 필요합니다.'; return element; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', '중앙이 높고 가장자리가 낮은 유리의 가상 표면. 드래그로 회전할 수 있습니다.');
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 30);
  camera.position.set(3, 2.5, 4);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.15, 0); controls.enablePan = false; controls.enableZoom = false;
  controls.minPolarAngle = 0.01; controls.maxPolarAngle = Math.PI / 2;
  controls.update();
  const vertices: number[] = [], indices: number[] = [];
  const rings = 40, sectors = 80;
  for (let ring = 0; ring <= rings; ring++) {
    for (let sector = 0; sector <= sectors; sector++) {
      const angle = sector / sectors * Math.PI * 2;
      const cx = Math.cos(angle), cy = Math.sin(angle);
      const radius = (Math.abs(cx) ** foregroundGlassShape.exponent + Math.abs(cy) ** foregroundGlassShape.exponent) ** (-1 / foregroundGlassShape.exponent) * ring / rings;
      vertices.push(...position(cx * radius, cy * radius).toArray());
      if (ring < rings && sector < sectors) {
        const a = ring * (sectors + 1) + sector, b = a + sectors + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
  scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#deaa99', roughness: 0.9, side: THREE.DoubleSide })),
    new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#9a7466', wireframe: true, transparent: true, opacity: 0.13 })), new THREE.AmbientLight(0xffffff, 2));
  const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(-2, 5, 3); scene.add(light);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 3.7), new THREE.MeshBasicMaterial({ color: '#e8e0d3', transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; scene.add(floor);
  const point = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshBasicMaterial({ color: '#b64e3c', depthTest: false }));
  point.renderOrder = 2; scene.add(point);
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 0.5, 0x3b687a, 0.12, 0.06);
  scene.add(arrow);
  const draw = () => renderer.render(scene, camera);
  const update = () => {
    const x = Number(element.querySelector<HTMLInputElement>('#relief-point')!.value);
    const sample = reliefSample(x, 0);
    point.position.copy(position(x, 0)); arrow.position.copy(point.position);
    arrow.setDirection(new THREE.Vector3(sample.normal.x, sample.normal.z, -sample.normal.y));
    element.querySelector('#relief-point-value')!.textContent = `x=${x.toFixed(2)}, y=0`;
    element.querySelector('#relief-field')!.textContent = sample.field.toFixed(3);
    element.querySelector('#relief-depth')!.textContent = sample.depth.toFixed(3);
    element.querySelector('#relief-height')!.textContent = sample.height.toFixed(1);
    element.querySelector('.relief-calculation')!.textContent = `f = |${x.toFixed(2)}|^2.45 + |0|^2.45 → depth = √(1−${sample.field.toFixed(3)}) = ${sample.depth.toFixed(3)} → 높이 = 100 + 125 × depth = ${sample.height.toFixed(1)} (작품 좌표의 단위)`;
    draw();
  };
  controls.addEventListener('change', draw);
  element.querySelector('#relief-point')!.addEventListener('input', update);
  element.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.view === 'top') camera.position.set(0, 5, 0.01);
    else if (button.dataset.view === 'side') camera.position.set(4.5, 0.45, 0);
    else camera.position.set(3, 2.5, 4);
    controls.update(); draw();
  }));
  new ResizeObserver(() => {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false); camera.aspect = width / height;
    camera.zoom = Math.min(0.9, camera.aspect / 1.4);
    camera.updateProjectionMatrix(); draw();
  }).observe(host);
  update();
  return element;
}
