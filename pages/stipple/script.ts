import * as THREE from 'three';
import { fragmentShader, vertexShader } from './shader';

const WIDTH = 1200;
const HEIGHT = 1500;
const canvas = document.querySelector<HTMLCanvasElement>('#artwork')!;
const paper = document.querySelector<HTMLDivElement>('#paper')!;
const cursor = document.querySelector<HTMLDivElement>('#brush')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const upload = document.querySelector<HTMLInputElement>('#upload')!;
const sampleButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-sample]')];
const samples = {
  umbreon: { url: new URL('./assets/umbreon.png', import.meta.url).href, label: 'NO. 197 / 블래키' },
  gengar: { url: new URL('./assets/gengar.png', import.meta.url).href, label: 'NO. 094 / 팬텀' },
  pikachu: { url: new URL('./assets/pikachu.png', import.meta.url).href, label: 'NO. 025 / 피카츄' },
};

function surface() {
  const surface = document.createElement('canvas');
  surface.width = WIDTH;
  surface.height = HEIGHT;
  return surface;
}

async function initialize() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const screenTexture = await new THREE.TextureLoader().loadAsync(new URL('./assets/ink-screen.png', import.meta.url).href);
  screenTexture.wrapS = screenTexture.wrapT = THREE.RepeatWrapping;
  screenTexture.minFilter = screenTexture.magFilter = THREE.LinearFilter;
  screenTexture.generateMipmaps = false;
  const image = surface();
  const imageContext = image.getContext('2d')!;
  const mask = surface();
  const maskContext = mask.getContext('2d')!;
  const imageTexture = new THREE.CanvasTexture(image);
  const maskTexture = new THREE.CanvasTexture(mask);
  imageTexture.minFilter = THREE.LinearFilter;
  maskTexture.minFilter = THREE.LinearFilter;
  imageTexture.generateMipmaps = false;
  maskTexture.generateMipmaps = false;
  const uniforms = {
    uImage: { value: imageTexture },
    uScreen: { value: screenTexture },
    uMask: { value: maskTexture },
    uSize: { value: 0.85 },
    uDensity: { value: 1 },
    uResolution: { value: new THREE.Vector2() },
  };
  const scene = new THREE.Scene();
  const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  const camera = new THREE.Camera();
  let frame = 0;
  let loaded = false;
  let requestId = 0;
  let brushRadius = 100;
  let lastPoint: { x: number; y: number } | null = null;

  // Render only when something changes; the ink and paper never animate or flicker.
  function render() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      renderer.render(scene, camera);
    });
  }
  function reset() {
    maskContext.fillStyle = '#000';
    maskContext.fillRect(0, 0, WIDTH, HEIGHT);
    maskTexture.needsUpdate = true;
    lastPoint = null;
    render();
  }
  function resize() {
    renderer.setSize(paper.clientWidth, paper.clientHeight, false);
    renderer.getDrawingBufferSize(uniforms.uResolution.value);
    render();
  }
  new ResizeObserver(resize).observe(paper);

  async function loadImage(url: string, label: string, selected?: string) {
    const id = ++requestId;
    status.textContent = '이미지를 점으로 바꾸는 중…';
    try {
      const source = new Image();
      source.src = url;
      await source.decode();
      if (id !== requestId) return;
      imageContext.fillStyle = '#fff';
      imageContext.fillRect(0, 0, WIDTH, HEIGHT);
      const scale = Math.min(WIDTH * 0.83 / source.naturalWidth, HEIGHT * 0.8 / source.naturalHeight);
      const w = source.naturalWidth * scale;
      const h = source.naturalHeight * scale;
      imageContext.filter = 'blur(1.2px)';
      imageContext.drawImage(source, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
      imageContext.filter = 'none';
      imageTexture.needsUpdate = true;
      loaded = true;
      reset();
      document.querySelector('#art-label')!.textContent = label;
      sampleButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.sample === selected)));
      status.textContent = '종이 위를 움직여 보세요. 터치는 누른 채 문질러 주세요.';
    } catch {
      if (id === requestId) status.textContent = '이미지를 열지 못했어요. JPG, PNG 또는 WebP 파일로 다시 시도해 주세요.';
    }
  }

  function stamp(x: number, y: number) {
    const gradient = maskContext.createRadialGradient(x, y, 0, x, y, brushRadius);
    gradient.addColorStop(0, 'rgba(255,255,255,0.42)');
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.28)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    maskContext.fillStyle = gradient;
    maskContext.fillRect(x - brushRadius, y - brushRadius, brushRadius * 2, brushRadius * 2);
  }
  function paint(event: PointerEvent) {
    if (!loaded || (event.pointerType !== 'mouse' && !event.buttons && event.type !== 'pointerdown')) return;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * WIDTH;
    const y = (event.clientY - rect.top) / rect.height * HEIGHT;
    cursor.style.display = event.pointerType === 'mouse' ? 'block' : 'none';
    cursor.style.left = `${event.clientX - rect.left}px`;
    cursor.style.top = `${event.clientY - rect.top}px`;
    cursor.style.width = cursor.style.height = `${brushRadius * 2 / WIDTH * rect.width}px`;
    const from = lastPoint || { x, y };
    const distance = Math.hypot(x - from.x, y - from.y);
    const steps = Math.max(1, Math.ceil(distance / (brushRadius * 0.12)));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      stamp(from.x + (x - from.x) * t, from.y + (y - from.y) * t);
    }
    lastPoint = { x, y };
    maskTexture.needsUpdate = true;
    render();
  }
  canvas.addEventListener('pointerdown', event => {
    lastPoint = null;
    canvas.setPointerCapture(event.pointerId);
    paint(event);
  });
  canvas.addEventListener('pointermove', paint);
  function endStroke() { lastPoint = null; cursor.style.display = 'none'; }
  canvas.addEventListener('pointerleave', endStroke);
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);

  for (const button of sampleButtons) {
    button.addEventListener('click', () => {
      const key = button.dataset.sample as keyof typeof samples;
      const sample = samples[key];
      void loadImage(sample.url, sample.label, key);
    });
  }
  upload.addEventListener('change', async () => {
    const file = upload.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      status.textContent = '이미지 파일을 선택해 주세요.';
      upload.value = '';
      return;
    }
    const url = URL.createObjectURL(file);
    await loadImage(url, file.name);
    URL.revokeObjectURL(url);
    upload.value = '';
  });
  document.querySelector<HTMLInputElement>('#size')!.addEventListener('input', event => {
    const value = Number((event.target as HTMLInputElement).value);
    uniforms.uSize.value = value;
    document.querySelector('#size-value')!.textContent = value.toFixed(2);
    render();
  });
  document.querySelector<HTMLInputElement>('#density')!.addEventListener('input', event => {
    const value = Number((event.target as HTMLInputElement).value);
    uniforms.uDensity.value = value / 100;
    document.querySelector('#density-value')!.textContent = `${value}%`;
    render();
  });
  document.querySelector<HTMLInputElement>('#brush-size')!.addEventListener('input', event => {
    brushRadius = Number((event.target as HTMLInputElement).value);
    document.querySelector('#brush-value')!.textContent = String(brushRadius);
  });
  document.querySelector('#reset')!.addEventListener('click', () => {
    reset();
    status.textContent = '새 종이를 펼쳤어요. 다시 문질러 보세요.';
  });
  document.querySelector('#reveal')!.addEventListener('click', () => {
    maskContext.fillStyle = '#fff';
    maskContext.fillRect(0, 0, WIDTH, HEIGHT);
    maskTexture.needsUpdate = true;
    render();
    status.textContent = '모든 점을 드러냈어요.';
  });
  document.querySelector<HTMLButtonElement>('#save')!.addEventListener('click', () => {
    if (!loaded) return;
    // Export the current reveal state at a fixed resolution, independent of viewport/DPR.
    renderer.setSize(WIDTH / renderer.getPixelRatio(), HEIGHT / renderer.getPixelRatio(), false);
    renderer.getDrawingBufferSize(uniforms.uResolution.value);
    renderer.render(scene, camera);
    const url = canvas.toDataURL('image/png');
    resize();
    const link = document.createElement('a');
    link.download = 'stipple.png';
    link.href = url;
    link.click();
    status.textContent = '현재 보이는 점묘화를 1200 × 1500 PNG로 저장했어요.';
  });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    status.textContent = '그리기 연결이 끊어졌어요. 페이지를 새로고침해 주세요.';
  });
  reset();
  resize();
  void loadImage(samples.umbreon.url, samples.umbreon.label, 'umbreon');
}
void initialize().catch(() => {
  status.textContent = '그리기를 시작하지 못했어요. 새로고침하거나 하드웨어 가속을 켠 Chrome에서 열어 주세요.';
});
