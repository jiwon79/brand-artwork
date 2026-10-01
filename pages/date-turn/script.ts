/// <reference types="vite/client" />
import GUI from 'lil-gui';
import { loadNumeralFont } from './glyph-texture';
import { dragRotation, followAngle, isValidNumber } from './motion';
import { createRenderer, DEFAULTS } from './renderer';

const artwork = document.querySelector<HTMLElement>('#artwork')!;
const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const status = document.querySelector<HTMLElement>('#status')!;
const toggle = document.querySelector<HTMLButtonElement>('#settings-toggle')!;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const query = new URLSearchParams(location.search);

async function start() {
  await loadNumeralFont();
  const settings = { ...DEFAULTS, playing: !reducedMotion.matches && !query.has('paused') };
  const numberKeys = ['first', 'second', 'third'] as const;
  numberKeys.forEach((key, index) => {
    const value = query.get(`n${index + 1}`);
    if (value && isValidNumber(value)) settings[key] = value;
  });
  const color = query.get('color');
  if (color && /^#[a-f\d]{6}$/i.test(color)) settings.numberColor = settings.lineColor = color;
  const render = createRenderer(canvas, settings);
  const events = new AbortController();
  const options = { signal: events.signal };
  let time = Number(query.get('time')) || 0;
  let pitch = 0;
  let yaw = 0;
  let targetPitch = 0;
  let targetYaw = 0;
  let request = 0;
  let lastTime = performance.now();
  let disposed = false;
  let gesture: { id: number; x: number; y: number; moved: boolean; playing: boolean } | null = null;
  function isSettling() { return Math.abs(targetPitch - pitch) + Math.abs(targetYaw - yaw) > 0.0001; }

  function draw() {
    const pose = render.draw(time, pitch, yaw);
    artwork.dataset.numbers = numberKeys.map(key => settings[key]).join(',');
    artwork.dataset.playing = String(settings.playing);
    artwork.dataset.rotation = `${pose.pitch.toFixed(3)},${pose.yaw.toFixed(3)},${pose.roll.toFixed(3)}`;
    artwork.dataset.dragRotation = `${pitch.toFixed(3)},${yaw.toFixed(3)}`;
    artwork.dataset.settling = String(isSettling());
    artwork.dataset.time = time.toFixed(3);
    artwork.setAttribute('aria-label', `Date Turn, ${settings.first}·${settings.second}·${settings.third} 입체 숫자`);
  }
  function tick(now: number) {
    request = 0;
    const delta = Math.max(0, (now - lastTime) / 1000);
    if (settings.playing && !gesture) time += delta * settings.speed;
    pitch = followAngle(pitch, targetPitch, delta, settings.dragResponse);
    yaw = followAngle(yaw, targetYaw, delta, settings.dragResponse);
    lastTime = now;
    draw();
    if (!document.hidden && (settings.playing || gesture || isSettling())) request = requestAnimationFrame(tick);
  }
  function invalidate() {
    if (!request && !disposed && !document.hidden) {
      lastTime = performance.now();
      request = requestAnimationFrame(tick);
    }
  }
  function resize() { render.resize(artwork.clientWidth, artwork.clientHeight); invalidate(); }
  const gui = new GUI({ title: 'Date Turn · 설정', width: 280 });
  let panelVisible = query.has('debug');
  function showPanel(visible: boolean) {
    panelVisible = visible;
    if (visible) gui.show(); else gui.hide();
    toggle.setAttribute('aria-expanded', String(visible));
  }
  showPanel(panelVisible);
  toggle.addEventListener('click', () => showPanel(!panelVisible), options);
  const numbers = gui.addFolder('숫자');
  const committed = numberKeys.map(key => settings[key]);
  numbers.add(settings, 'font', { 'Arial Black': 'Arial Black', Arial: 'Arial', Pretendard: 'DateTurnNumerals' }).name('글꼴').onChange(() => {
    numberKeys.forEach((key, index) => render.updateNumber(index, settings[key]));
    invalidate();
  });
  numberKeys.forEach((key, index) => {
    const control = numbers.add(settings, key).name(`${index + 1}번째 면`).onFinishChange((value: string) => {
      if (!isValidNumber(value)) {
        settings[key] = committed[index]; control.updateDisplay();
        status.textContent = '각 면에는 숫자 1~6자리를 입력해 주세요.';
        return;
      }
      committed[index] = value;
      render.updateNumber(index, value);
      status.textContent = '숫자 형태를 다시 생성했습니다.';
      invalidate();
    });
  });
  const motion = gui.addFolder('크기 · 움직임');
  motion.add(settings, 'size', 0.4, 1.8, 0.01).name('크기').onChange(invalidate);
  motion.add(settings, 'sensitivity', 0.1, 3, 0.05).name('드래그 감도');
  motion.add(settings, 'dragResponse', 0.02, 0.2, 0.005).name('드래그 부드러움');
  const playback = motion.add(settings, 'playing').name('자동 회전').onChange(invalidate);
  motion.add(settings, 'speed', 0.1, 2.5, 0.05).name('회전 속도');
  motion.add(settings, 'transition', 0.3, 0.9, 0.01).name('전환 시간').onChange(invalidate);
  motion.add(settings, 'sway', 0, 45, 1).name('좌우 회전 각도').onChange(invalidate);
  motion.add(settings, 'tilt', 0, 25, 1).name('기울기 각도').onChange(invalidate);
  motion.add(settings, 'bounce', 0, 1.2, 0.01).name('위아래 움직임').onChange(invalidate);
  const colors = gui.addFolder('색상 · 외곽선');
  colors.addColor(settings, 'numberColor').name('숫자').onChange(invalidate);
  colors.addColor(settings, 'lineColor').name('외곽선').onChange(invalidate);
  colors.addColor(settings, 'sideColor').name('입체 옆면').onChange(invalidate);
  colors.addColor(settings, 'background').name('배경').onChange(invalidate);
  colors.add(settings, 'lineWidth', 0, 5, 0.1).name('선 두께').onChange(invalidate);
  colors.add(settings, 'padding', 0, 0.18, 0.005).name('숫자 둘레 여백').onChange(invalidate);
  const actions = {
    reset() {
      Object.assign(settings, DEFAULTS, { playing: !reducedMotion.matches });
      time = pitch = yaw = targetPitch = targetYaw = 0;
      numberKeys.forEach((key, index) => { committed[index] = settings[key]; render.updateNumber(index, settings[key]); });
      gui.controllersRecursive().forEach(control => control.updateDisplay());
      invalidate();
    },
    save() {
      draw();
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `date-turn-${settings.first}-${settings.second}-${settings.third}.png`;
      link.click();
    },
  };
  gui.add(actions, 'reset').name('기본값으로');
  gui.add(actions, 'save').name('현재 렌더 PNG 저장');

  artwork.addEventListener('pointerdown', event => {
    if (gesture || (event.pointerType === 'mouse' && event.button !== 0)) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, playing: settings.playing };
    artwork.setPointerCapture(event.pointerId);
    artwork.classList.add('dragging');
    artwork.focus({ preventScroll: true });
    invalidate();
  }, options);
  artwork.addEventListener('pointermove', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (!gesture.moved && Math.hypot(dx, dy) < 4) return;
    gesture.moved = true;
    const change = dragRotation(dx, dy, Math.min(artwork.clientWidth, artwork.clientHeight), settings.sensitivity);
    targetPitch += change[0]; targetYaw += change[1];
    gesture.x = event.clientX; gesture.y = event.clientY;
    invalidate();
  }, options);
  function endGesture(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.id) return;
    const previous = gesture; gesture = null;
    if (artwork.hasPointerCapture(event.pointerId)) artwork.releasePointerCapture(event.pointerId);
    artwork.classList.remove('dragging');
    if (!previous.moved && event.type === 'pointerup') settings.playing = !previous.playing;
    gui.controllersRecursive().forEach(control => control.updateDisplay());
    invalidate();
  }
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) artwork.addEventListener(name, event => endGesture(event as PointerEvent), options);
  artwork.addEventListener('keydown', event => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (!event.repeat) { settings.playing = !settings.playing; playback.updateDisplay(); invalidate(); }
    } else if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      if (event.key === 'ArrowLeft') targetYaw -= 0.08 * settings.sensitivity;
      if (event.key === 'ArrowRight') targetYaw += 0.08 * settings.sensitivity;
      if (event.key === 'ArrowUp') targetPitch -= 0.08 * settings.sensitivity;
      if (event.key === 'ArrowDown') targetPitch += 0.08 * settings.sensitivity;
      settings.playing = false;
      playback.updateDisplay();
      invalidate();
    } else if (event.key.toLowerCase() === 'r') actions.reset();
  }, options);
  window.addEventListener('keydown', event => {
    if (event.key.toLowerCase() !== 'd' || event.repeat || (event.target as HTMLElement).closest('input,textarea,[contenteditable]')) return;
    showPanel(!panelVisible);
  }, options);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(request); request = 0; } else invalidate();
  }, options);
  reducedMotion.addEventListener('change', () => { settings.playing = !reducedMotion.matches; playback.updateDisplay(); invalidate(); }, options);
  window.addEventListener('resize', resize, options);
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); status.textContent = '그래픽 연결을 복구하는 중입니다.'; }, options);
  canvas.addEventListener('webglcontextrestored', invalidate, options);
  if (import.meta.hot) import.meta.hot.dispose(() => {
    disposed = true; cancelAnimationFrame(request); events.abort(); gui.destroy(); render.dispose();
  });
  resize(); draw();
  artwork.classList.add('ready');
  artwork.dataset.renderer = 'webgl-volume';
}
start().catch(error => {
  console.error(error);
  status.classList.remove('sr-only');
  status.textContent = '입체 렌더러를 시작하지 못했습니다. WebGL을 지원하는 브라우저에서 새로고침해 주세요.';
});
