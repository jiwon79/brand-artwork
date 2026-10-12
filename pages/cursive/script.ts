/// <reference types="vite/client" />
import type { Bounds } from './coordinates';
import GUI from 'lil-gui';
import { debugExamples } from './debug-examples';
import { ArtworkView } from './artwork-view';
import { RopeInteraction } from './rope-interaction';
import { composeText, unsupportedCharacters } from './lettering';
import { loadBorel } from './shaper';
import { preparePen, expandPenBounds } from './pen-geometry';
import { createPenPlayback, type PenPlayback } from './pen-playback';
import { letterContexts } from './stroke-order';
import { strokeKindLabels } from './stroke-order-view';
import { teachingReference } from './teaching-model';
import { ExportControls } from './export-controls';

const artwork = document.querySelector<SVGSVGElement>('#artwork')!;
const artworkArea = document.querySelector<HTMLElement>('main')!;
const controls = document.querySelector<HTMLElement>('#text-form')!;
const loadingScreen = document.querySelector<HTMLElement>('#loading-screen')!;
const loadingMessage = document.querySelector<HTMLElement>('#loading-message')!;
const loadingRetry = document.querySelector<HTMLButtonElement>('#loading-retry')!;
loadingRetry.addEventListener('click', () => location.reload());
const pauseButton = document.querySelector<HTMLButtonElement>('#pause')!;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const settings = { duration: 6, weight: 1, guides: false, ink: '#6f4031', paper: '#f3e8de', reference: false, gradient: true };
const view = new ArtworkView(artwork);
let inspecting = false;
let roping = false;
const rope = new RopeInteraction(artwork, () => roping, () => settings.weight, () => { if (!frame) start(); });
let bounds: Bounds = [0, 0, 1100, 530];
let ropeFloor = Infinity;

function updateRopeFloor() {
  const matrix = artwork.getScreenCTM();
  if (!matrix) return;
  const edge = Math.min(artworkArea.getBoundingClientRect().bottom, controls.getBoundingClientRect().top) - 12;
  ropeFloor = new DOMPoint(0, edge).matrixTransform(matrix.inverse()).y;
  rope.setFloor(ropeFloor);
  if (roping) start();
}

function updateViewBox() {
  const [left, top, right, bottom] = bounds, pad = debugState.mode === 'rope' ? Math.max(right - left, bottom - top) * .3 : inspecting ? 180 : 0;
  artwork.setAttribute('viewBox', `${left - pad} ${top - pad} ${right - left + 2 * pad} ${bottom - top + 2 * pad}`);
  updateRopeFloor();
}
let playback: PenPlayback = { strokes: [], duration: 0 };
let totalLength = 0;
let ready = false;
const textInput = document.querySelector<HTMLTextAreaElement>('#text-input')!;
const weightInput = document.querySelector<HTMLInputElement>('#weight-input')!;
const status = document.querySelector<HTMLElement>('#text-status')!;
let loaded: Awaited<ReturnType<typeof loadBorel>>;

function prepareOrderView() {
  view.prepareOrder(playback);
  stepController.options(Object.fromEntries(view.order.steps.map(step => [`${step.index + 1} · ${strokeKindLabels[step.kind]}`, step.index])));
}

function writeText(text: string) {
  const missing = unsupportedCharacters(text, loaded.catalog);
  if (missing.length) {
    status.textContent = `지원하지 않는 문자: ${missing.join(' ')}. 영문·숫자·기호를 입력해 주세요.`;
    status.hidden = false;
    textInput.setAttribute('aria-invalid', 'true');
    return;
  }
  textInput.removeAttribute('aria-invalid');
  const lettering = composeText(text, loaded.shaper, loaded.catalog);
  playback = createPenPlayback(lettering.strokes.map(preparePen));
  view.setLettering(lettering, playback);
  totalLength = playback.strokes.reduce((sum, stroke) => sum + stroke.pen.length, 0);
  bounds = expandPenBounds(lettering.bounds, playback.strokes.map(stroke => stroke.pen), 1.5);
  rope.cancelGrab();
  if (inspecting) prepareOrderView();
  updateViewBox();
  artwork.setAttribute('aria-label', text.trim() ? `Cursive 필기체로 써지는 ${text}` : '문장을 입력하면 필기 애니메이션을 볼 수 있습니다.');
  settings.duration = Math.ceil(playback.duration * 60) / 60 || 4;
  progress = debugState.mode === 'rope' || reducedMotion.matches ? 1 : 0;
  playing = debugState.mode !== 'rope' && Boolean(totalLength) && !reducedMotion.matches;
  roping = false;
  status.hidden = true;
  pauseButton.disabled = !totalLength;
  exportControls.resetPhoto();
  debugState.frame = Math.round(progress * settings.duration * 60);
  frameController?.max(Math.round(settings.duration * 60));
  stepController?.options(Object.fromEntries(view.order.steps.map(step => [`${step.index + 1} · ${strokeKindLabels[step.kind]}`, step.index])));
  start();
}
let progress = reducedMotion.matches ? 1 : 0;
let playing = !reducedMotion.matches;
let speed = 2;
let lastTime = 0;
let frame = 0;
function render() {
  exportControls.sync();
  const time = progress * playback.duration;
  const showRope = !inspecting && Boolean(totalLength) && !playing;
  if (showRope !== roping) {
    rope.cancelGrab(); roping = showRope;
    if (roping) resetRope(time);
  }
  document.body.classList.toggle('roping', roping);
  const activeStep = view.render(playback, time, settings, inspecting, roping ? rope.pens : undefined);
  if (activeStep !== undefined) debugState.step = activeStep;
  debugState.frame = Math.round(progress * settings.duration * 60);
  pauseButton.dataset.state = playing ? 'pause' : progress === 1 ? 'restart' : 'play';
  pauseButton.setAttribute('aria-label', playing ? '일시정지' : progress === 1 ? '다시하기' : '재생');
}
function tick(time: number) {
  if (roping && lastTime && !document.hidden) rope.step((time - lastTime) / 1000);
  if (playing && lastTime && !document.hidden) {
    progress = Math.min(1, progress + (time - lastTime) * speed / (settings.duration * 1000));
    if (progress === 1) playing = false;
  }
  lastTime = time;
  render();
  frame = playing || roping && rope.awake ? requestAnimationFrame(tick) : 0;
}
function start() {
  lastTime = 0;
  if (!frame) frame = requestAnimationFrame(tick);
  render();
}
pauseButton.addEventListener('click', () => {
  if (!ready || !totalLength) return;
  if (progress === 1 || debugState.mode === 'rope') {
    progress = 0; debugState.mode = 'ink'; inspecting = false; ropeFolder.hide(); updateViewBox();
  }
  playing = !playing; start();
});
document.addEventListener('visibilitychange', () => { lastTime = 0; });
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) { progress = 1; playing = false; render(); }
});
const colorButtons = [...document.querySelectorAll<HTMLButtonElement>('.swatch')];
function updateColors() {
  for (const button of colorButtons) {
    const selected = button.dataset.ink ? !settings.gradient && button.dataset.ink === settings.ink : settings.gradient;
    button.setAttribute('aria-pressed', String(selected));
  }
}
updateColors();
for (const button of colorButtons) button.addEventListener('click', () => {
  settings.gradient = !button.dataset.ink;
  if (button.dataset.ink) settings.ink = button.dataset.ink;
  updateColors(); render();
});
function submitText() {
  if (ready) writeText(textInput.value);
}
weightInput.addEventListener('input', () => {
  settings.weight = weightInput.valueAsNumber;
  rope.setFloor(ropeFloor);
  exportControls.resetPhoto();
  render();
  if (roping && rope.awake) start();
});
let inputTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleText() {
  clearTimeout(inputTimer);
  if (!textInput.matches(':disabled')) inputTimer = setTimeout(submitText, 250);
}
textInput.addEventListener('input', event => { if (!(event as InputEvent).isComposing) scheduleText(); });
textInput.addEventListener('compositionend', scheduleText);
document.querySelector<HTMLFormElement>('#text-form')!.addEventListener('submit', event => {
  event.preventDefault(); clearTimeout(inputTimer); submitText();
});

function resetRope(time = playback.duration) {
  rope.reset(playback, time);
  view.resetRope(playback);
}

function setView(mode: 'ink' | 'order' | 'rope') {
  inspecting = mode === 'order';
  if (inspecting) prepareOrderView();
  rope.cancelGrab();
  if (mode === 'rope') { progress = 1; playing = false; }
  pauseButton.disabled = !totalLength;
  orderFolder.show(inspecting); ropeFolder.show(mode === 'rope');
  updateViewBox(); render();
  if (roping && rope.awake) start();
}
function seekFrame(value: number) {
  progress = Math.max(0, Math.min(1, value / (settings.duration * 60)));
  playing = false; render();
}
const debugState = { mode: 'ink', example: 'hello', character: '', context: '', frame: 0, step: 0, speed: 2 };
const gui = new GUI({ title: 'Cursive · Debug' });
gui.hide();
const exportControls = new ExportControls(gui, status, () => ({
  ready, hasInk: Boolean(totalLength), artwork, text: textInput.value, playback,
  bounds, style: settings, speed, get ropePens() { return roping ? rope.pens : undefined; },
}), render);
gui.add(debugState, 'mode', { '필기': 'ink', '획순 경로': 'order', '로프': 'rope' }).name('보기').onChange(setView);
gui.add(debugState, 'example', debugExamples).name('테스트 문장').onChange((text: string) => { textInput.value = text; submitText(); });
const frameController = gui.add(debugState, 'frame', 0, 360, 1).name('프레임').onChange(seekFrame);
gui.add(debugState, 'speed', .25, 5, .25).name('재생 속도').onChange((value: number) => { speed = value; });
gui.add(settings, 'guides').name('중심 경로').onChange(render);
gui.add(settings, 'reference').name('원본 폰트').onChange(render);
gui.addColor(settings, 'ink').name('사용자 색상').onChange(() => { settings.gradient = false; updateColors(); render(); });
gui.addColor(settings, 'paper').name('배경').onChange(render);
const orderFolder = gui.addFolder('획순 검사');
const contextController = orderFolder.add(debugState, 'context', ['']).name('연결 문맥').onChange((text: string) => {
  if (text && ready) { textInput.value = text; writeText(text); }
});
orderFolder.add(debugState, 'character', ['', ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789']).name('문자').onChange((character: string) => {
  if (!ready || !character) return;
  const contexts = letterContexts(character, loaded.shaper, loaded.catalog);
  contextController.options(contexts.map(context => context.text));
  debugState.context = contexts[0]?.text ?? character;
  contextController.updateDisplay();
  textInput.value = debugState.context; writeText(textInput.value);
});
const stepController = orderFolder.add(debugState, 'step', { '문장을 입력하세요': 0 }).name('검사 구간').onChange((index: number) => {
  const step = view.order.steps[index];
  if (!step || !playback.duration) return;
  progress = (step.start + Math.min(.001, (step.end - step.start) / 2)) / playback.duration;
  playing = false; render();
});
orderFolder.add({ reference: () => window.open(teachingReference(debugState.character).href, '_blank', 'noopener') }, 'reference').name('프랑스 교본 보기');
orderFolder.hide();
const ropeFolder = gui.addFolder('로프 · 글씨를 드래그');
ropeFolder.add({ reset: () => { resetRope(); render(); } }, 'reset').name('로프 초기화');
ropeFolder.hide();
let debugVisible = new URLSearchParams(location.search).has('debug');
const ropeLayout = new ResizeObserver(updateRopeFloor);
ropeLayout.observe(artwork); ropeLayout.observe(controls);
window.addEventListener('resize', updateRopeFloor);
function toggleDebug(visible: boolean) {
  debugVisible = visible; gui.show(visible);
  frameController.listen(visible); stepController.listen(visible);
  if (!visible) { debugState.mode = 'ink'; setView('ink'); settings.guides = settings.reference = false; render(); }
}
toggleDebug(debugVisible);
const debugKeys = (event: KeyboardEvent) => {
  if (event.key === 'Escape') { toggleDebug(false); return; }
  if ((event.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]') || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key.toLowerCase() === 'd') toggleDebug(!debugVisible);
};
window.addEventListener('keydown', debugKeys);
import.meta.hot?.dispose(() => {
  cancelAnimationFrame(frame); clearTimeout(inputTimer); rope.destroy(); gui.destroy();
  window.removeEventListener('keydown', debugKeys);
  ropeLayout.disconnect(); window.removeEventListener('resize', updateRopeFloor);
});
loadBorel().then(value => {
  loaded = value; ready = true; textInput.disabled = weightInput.disabled = false;
  writeText(textInput.value);
  // Include shaping and the initial SVG render, not just fetch completion.
  artworkArea.setAttribute('aria-busy', 'false');
  loadingScreen.hidden = true;
  delete document.body.dataset.loadState;
}).catch(() => {
  ready = false; playing = false;
  textInput.disabled = weightInput.disabled = pauseButton.disabled = true;
  cancelAnimationFrame(frame); frame = 0;
  artworkArea.setAttribute('aria-busy', 'false');
  document.body.dataset.loadState = 'error';
  loadingMessage.textContent = '필기 자료를 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.';
  loadingRetry.hidden = false;
});
