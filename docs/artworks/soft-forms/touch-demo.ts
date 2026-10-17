import * as THREE from 'three';

/** The same camera-to-mesh picking operation used by the artwork. */
export function findSurface(camera: THREE.Camera, body: THREE.Object3D, x: number, y: number) {
  camera.updateMatrixWorld(true);
  body.updateMatrixWorld(true);
  const picker = new THREE.Raycaster();
  picker.setFromCamera(new THREE.Vector2(x, y), camera);
  return { ray: picker.ray.clone(), hit: picker.intersectObject(body)[0] };
}

export function createTouchDemo(): HTMLElement {
  const element = document.createElement('section');
  element.id = 'touch-demo'; element.className = 'interactive-demo';
  element.setAttribute('aria-labelledby', 'touch-demo-title');
  element.innerHTML = `<div class="demo-heading"><p class="eyebrow">TOUCH · 직접 조작하기</p>
    <h3 id="touch-demo-title">누른 화면에서 몸체까지 광선 보내기</h3>
    <p>왼쪽을 누르면 오른쪽에서 광선과 접촉점을 볼 수 있습니다.</p></div>
    <div class="touch-views">
      <div class="demo-figure"><h4>① 화면을 누르기</h4><div class="touch-front"></div><p class="figure-caption">손가락·마우스로 누르거나 끌어 보세요.</p></div>
      <div class="demo-figure"><h4>② 옆에서 경로 보기</h4><div class="touch-side"></div><p class="figure-caption">네모는 화면 · 파란 선은 광선 · 붉은 점은 접촉점</p></div>
    </div>
    <div class="touch-presets"><button type="button" data-point="center">가운데 누르기</button><button type="button" data-point="edge">옆면 누르기</button><button type="button" data-point="miss">몸체 밖 누르기</button></div>
    <p class="demo-note touch-result" aria-live="polite"></p>
    <p class="demo-note">설명용으로 단순화한 몸체입니다. 작품과 같은 정사영 카메라와 레이캐스팅을 사용합니다. 화면 위치마다 평행한 광선을 보내고, 몸체와 가장 먼저 만난 점을 선택합니다.</p>`;
  const hosts = [element.querySelector<HTMLElement>('.touch-front')!, element.querySelector<HTMLElement>('.touch-side')!];
  const renderers: THREE.WebGLRenderer[] = [];
  try {
    for (const host of hosts) {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.domElement.setAttribute('role', 'img');
      renderer.domElement.setAttribute('aria-label', renderers.length === 0 ? '누를 수 있는 몸체 화면' : '옆에서 본 화면과 광선의 접촉점');
      host.append(renderer.domElement); renderers.push(renderer);
    }
  } catch {
    renderers.forEach(renderer => renderer.dispose());
    element.querySelector('.touch-views')!.textContent = '3D 데모를 표시하려면 WebGL을 지원하는 브라우저가 필요합니다.';
    element.querySelector('.touch-presets')!.remove();
    return element;
  }
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1.8, 1.8, 1.8, -1.8, 0.1, 20);
  camera.position.set(0, 0, 6); camera.lookAt(0, 0, 0);
  const observer = new THREE.OrthographicCamera(-2.9, 2.9, 2.9, -2.9, 0.1, 30);
  observer.position.set(6, 3.2, 7); observer.lookAt(0, 0, 1); observer.layers.enable(1);
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), new THREE.MeshStandardMaterial({ color: '#deaa99', roughness: 0.9 }));
  body.scale.set(1.2, 1, 0.75);
  const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(-3, 4, 6);
  scene.add(body, new THREE.AmbientLight(0xffffff, 2), light);
  const contact = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), new THREE.MeshBasicMaterial({ color: '#b64e3c', depthTest: false }));
  contact.renderOrder = 3; scene.add(contact);
  const screen = new THREE.Group();
  const plane = new THREE.PlaneGeometry(3.6, 3.6);
  screen.add(new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ color: '#a9bdc5', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })),
    new THREE.LineSegments(new THREE.EdgesGeometry(plane), new THREE.LineBasicMaterial({ color: '#899ba1' })));
  screen.position.z = 2.5; screen.traverse(object => object.layers.set(1)); scene.add(screen);
  const selection = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), new THREE.MeshBasicMaterial({ color: '#3b687a', depthTest: false }));
  selection.layers.set(1); scene.add(selection);
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const rayLine = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#3b687a', depthTest: false }));
  rayLine.layers.set(1); rayLine.renderOrder = 2; scene.add(rayLine);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 12), new THREE.MeshBasicMaterial({ color: '#3b687a', depthTest: false }));
  arrow.layers.set(1); arrow.renderOrder = 2; scene.add(arrow);
  const render = () => { renderers[0].render(scene, camera); renderers[1].render(scene, observer); };
  let selected = { x: 0.25, y: 0.15 };
  const pick = (x: number, y: number) => {
    selected = { x, y };
    const result = findSurface(camera, body, x, y);
    // Display the part of the actual ray starting at the illustrated screen.
    const origin = result.ray.at(3.5, new THREE.Vector3());
    const end = result.hit?.point ?? result.ray.at(7.5, new THREE.Vector3());
    selection.position.copy(origin);
    arrow.position.copy(end).addScaledVector(result.ray.direction, -0.08);
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), result.ray.direction);
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    positions.setXYZ(0, origin.x, origin.y, origin.z); positions.setXYZ(1, end.x, end.y, end.z);
    positions.needsUpdate = true; geometry.computeBoundingSphere();
    contact.visible = Boolean(result.hit);
    if (result.hit) contact.position.copy(result.hit.point);
    element.querySelector('.touch-result')!.textContent = result.hit
      ? '광선이 몸체의 앞쪽 표면에 닿았습니다. 붉은 점이 눌림 반응을 시작할 3D 위치입니다.'
      : '광선이 몸체와 만나지 않았습니다. 화면을 눌렀지만 몸체를 누른 것으로 처리하지 않습니다.';
    render();
  };
  new ResizeObserver(() => {
    hosts.forEach((host, index) => renderers[index].setSize(host.clientWidth, host.clientWidth, false));
    pick(selected.x, selected.y);
  }).observe(element);
  const canvas = renderers[0].domElement;
  const pointer = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    pick((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
  };
  let pointerId: number | null = null;
  canvas.addEventListener('pointerdown', event => {
    if (pointerId !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    pointerId = event.pointerId; canvas.setPointerCapture(event.pointerId); pointer(event);
  });
  canvas.addEventListener('pointermove', event => { if (event.pointerId === pointerId) pointer(event); });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(event, () => { pointerId = null; });
  element.querySelectorAll<HTMLButtonElement>('[data-point]').forEach(button => button.addEventListener('click', () => {
    pick(button.dataset.point === 'edge' ? 0.55 : button.dataset.point === 'miss' ? 0.85 : 0, button.dataset.point === 'miss' ? 0.7 : 0);
  }));
  pick(selected.x, selected.y);
  return element;
}
