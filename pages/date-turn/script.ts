import GUI from 'lil-gui';
import { exposeGuiInDebugMode } from '../../common/debug';
import { Timeline } from './timeline';

type Keyframes = {
  width: number;
  height: number;
  fps: number;
  color: string;
  background: string;
  paths: string[];
};

const artwork = document.querySelector<HTMLElement>('#artwork')!;
const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const status = document.querySelector<HTMLElement>('#status')!;
const context = canvas.getContext('2d')!;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

async function start(): Promise<void> {
  const response = await fetch(new URL('./assets/keyframes.json', import.meta.url));
  if (!response.ok) throw new Error(`Animation request failed (${response.status})`);
  const data: Keyframes = await response.json();
  const paths = data.paths.map(path => new Path2D(path));
  const timeline = new Timeline(paths.length, data.fps);
  timeline.playing = !reducedMotion.matches;
  const settings = { color: data.color, background: data.background, scale: 1 };
  const query = new URLSearchParams(location.search);
  const frameParameter = query.get('frame');
  if (frameParameter !== null && Number.isFinite(Number(frameParameter))) {
    timeline.seek(Math.floor(Number(frameParameter)) / data.fps);
    timeline.playing = false;
  }

  let width = innerWidth;
  let height = innerHeight;
  let pixelRatio = 1;
  let dirty = true;
  let renderedFrame = -1;
  let request = 0;
  let lastTime = performance.now();
  let gesture: { id: number; x: number; y: number; time: number; playing: boolean; moved: boolean } | null = null;

  function draw(): void {
    const scale = Math.min(width / data.width, height / data.height);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.fillStyle = settings.background;
    context.fillRect(0, 0, width, height);
    context.translate(width / 2, height / 2);
    context.scale(scale * settings.scale, scale * settings.scale);
    context.translate(-data.width / 2, -data.height / 2);
    context.fillStyle = settings.color;
    // One compound vector path preserves both the digit counters and thin outline.
    context.fill(paths[timeline.frame], 'evenodd');
    artwork.dataset.frame = String(timeline.frame);
    artwork.dataset.playing = String(timeline.playing);
    renderedFrame = timeline.frame;
    dirty = false;
  }

  function tick(now: number): void {
    request = 0;
    timeline.advance(Math.min((now - lastTime) / 1000, 0.1));
    lastTime = now;
    if (dirty || renderedFrame !== timeline.frame) draw();
    if (timeline.playing && !document.hidden) request = requestAnimationFrame(tick);
  }

  function invalidate(): void {
    dirty = true;
    if (!request && !document.hidden) {
      lastTime = performance.now();
      request = requestAnimationFrame(tick);
    }
  }

  function resize(): void {
    width = artwork.clientWidth;
    height = artwork.clientHeight;
    pixelRatio = Math.min(devicePixelRatio || 1, 3);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    invalidate();
  }

  function setPlaying(value: boolean): void {
    timeline.playing = value;
    status.textContent = value ? '재생' : '일시 정지';
    invalidate();
  }

  artwork.addEventListener('pointerdown', event => {
    if (gesture || (event.pointerType === 'mouse' && event.button !== 0)) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, time: timeline.time, playing: timeline.playing, moved: false };
    artwork.setPointerCapture(event.pointerId);
    artwork.classList.add('dragging');
    artwork.focus({ preventScroll: true });
    timeline.playing = false;
    invalidate();
  });

  artwork.addEventListener('pointermove', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (Math.hypot(dx, dy) > 5) gesture.moved = true;
    if (!gesture.moved) return;
    // Either horizontal or vertical swipes traverse the original three-face turn.
    timeline.seek(gesture.time + (dx - dy) / Math.max(240, Math.min(width, height)) * timeline.duration);
    invalidate();
  });

  function endGesture(event: PointerEvent): void {
    if (!gesture || gesture.id !== event.pointerId) return;
    const previous = gesture;
    gesture = null;
    artwork.classList.remove('dragging');
    if (artwork.hasPointerCapture(event.pointerId)) artwork.releasePointerCapture(event.pointerId);
    setPlaying(event.type === 'pointerup' && !previous.moved ? !previous.playing : previous.playing);
  }
  artwork.addEventListener('pointerup', endGesture);
  artwork.addEventListener('pointercancel', endGesture);
  artwork.addEventListener('lostpointercapture', endGesture);

  artwork.addEventListener('keydown', event => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (!event.repeat) setPlaying(!timeline.playing);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      timeline.seek(timeline.time + (event.key === 'ArrowLeft' ? -1 : 1) / data.fps);
      setPlaying(false);
    } else if (event.key.toLowerCase() === 'r') {
      timeline.seek(0);
      setPlaying(!reducedMotion.matches);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(request);
      request = 0;
    } else invalidate();
  });
  reducedMotion.addEventListener('change', () => setPlaying(!reducedMotion.matches));
  window.addEventListener('resize', resize);

  const gui = exposeGuiInDebugMode(new GUI({ title: 'Date Turn' }));
  gui.add(timeline, 'playing').name('재생').onChange(invalidate);
  gui.add(timeline, 'speed', 0.1, 2, 0.05).name('속도');
  gui.add(settings, 'scale', 0.5, 1.5, 0.01).name('크기').onChange(invalidate);
  gui.addColor(settings, 'color').name('숫자 · 외곽선').onChange(invalidate);
  gui.addColor(settings, 'background').name('배경').onChange(invalidate);
  const playhead = { frame: timeline.frame };
  gui.add(playhead, 'frame', 0, paths.length - 1, 1).name('프레임').onChange((frame: number) => {
    timeline.seek(frame / data.fps);
    setPlaying(false);
  });
  gui.add({ reset: () => { timeline.seek(0); setPlaying(!reducedMotion.matches); } }, 'reset').name('처음부터');

  resize();
  draw();
  artwork.classList.add('ready');
}

start().catch(error => {
  console.error(error);
  status.textContent = '애니메이션을 불러오지 못했습니다. 페이지를 새로고침해 주세요.';
});
