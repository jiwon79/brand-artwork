/// <reference types="vite/client" />
import GUI from 'lil-gui';
import { debugExamples } from './debug-examples';
import { FloorRope } from './rope';
import { visibleRopePens } from './rope-playback';
import { composeText, unsupportedCharacters, type Bounds } from './lettering';
import { loadBorel } from './shaper';
import { preparePen, penGeometry, expandPenBounds } from './pen-geometry';
import { createPenPlayback, strokeState, type PenPlayback } from './pen-playback';
import { letterContexts } from './stroke-order';
import { StrokeOrderView, stepName } from './stroke-order-view';
import { GradientInkView } from './gradient-ink-view';
import { teachingReference } from './teaching-model';
import { downloadArtworkPhoto } from './image-export';

const NS = 'http://www.w3.org/2000/svg';
function svgElement<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string>) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}
const artwork = document.querySelector<SVGSVGElement>('#artwork')!;
const pauseButton = document.querySelector<HTMLButtonElement>('#pause')!;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const settings = { duration: 6, weight: 1, guides: false, ink: '#6f4031', paper: '#f3e8de', reference: false };
let gradientEnabled = true;
const gradientView = new GradientInkView();
const inkShape = svgElement('g', { id: 'borel-ink-shape' });
const definitions = svgElement('defs', {});
definitions.append(inkShape);
const inkLayer = svgElement('g', {});
const solidInk = svgElement('use', { href: '#borel-ink-shape' });
inkLayer.append(solidInk, gradientView.layer);
const reference = svgElement('g', { fill: 'currentColor', opacity: '.13', 'pointer-events': 'none' });
const guides = svgElement('g', { fill: 'none', stroke: '#dc7962', 'stroke-width': '5', opacity: '.65', 'pointer-events': 'none' });
const orderView = new StrokeOrderView();
let orderPrepared = false;
artwork.append(definitions, gradientView.definitions, reference, inkLayer, guides, orderView.layer);
let inspecting = false;
let roping = false;
let rope = new FloorRope([]);
const ropeLayer = svgElement('g', { fill: 'currentColor', 'pointer-events': 'none' });
const ropeGradientView = new GradientInkView('borel-rope');
const ropeShape = svgElement('g', { id: 'borel-rope-ink-shape' });
definitions.append(ropeShape);
const solidRope = svgElement('use', { href: '#borel-rope-ink-shape' });
ropeLayer.append(solidRope, ropeGradientView.layer);
artwork.append(ropeGradientView.definitions, ropeLayer);
let ropePaths: SVGPathElement[] = [];
let ropePlayback: PenPlayback | undefined;
let renderedRopePens: ReturnType<typeof preparePen>[] = [];
let ropeWeight = 0;
let ropePointer: number | undefined;
let bounds: Bounds = [0, 0, 1100, 530];

function updateViewBox() {
  const [left, top, right, bottom] = bounds, pad = debugState.mode === 'rope' ? Math.max(right - left, bottom - top) * .3 : inspecting ? 180 : 0;
  artwork.setAttribute('viewBox', `${left - pad} ${top - pad} ${right - left + 2 * pad} ${bottom - top + 2 * pad}`);
}
let strokes: { path: SVGPathElement; written?: number; pressure?: number; weight?: number }[] = [];
let playback: PenPlayback = { strokes: [], duration: 0 };
let totalLength = 0;
let ready = false;
const textInput = document.querySelector<HTMLTextAreaElement>('#text-input')!;
const status = document.querySelector<HTMLElement>('#text-status')!;
let loaded: Awaited<ReturnType<typeof loadBorel>>;

function prepareOrderView() {
  if (orderPrepared) return;
  orderView.setPlayback(playback); orderPrepared = true;
  stepController.options(Object.fromEntries(orderView.steps.map(step => [`${step.index + 1} · ${stepName[step.kind]}`, step.index])));
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
  orderPrepared = false;
  orderView.layer.replaceChildren();
  orderView.steps = [];
  inkShape.replaceChildren(); reference.replaceChildren(); guides.replaceChildren();
  strokes = []; totalLength = 0;
  for (const [index, stroke] of lettering.strokes.entries()) {
    const { d } = stroke;
    const path = svgElement('path', { d: '', fill: 'currentColor' });
    inkShape.append(path);
    strokes.push({ path });
    totalLength += playback.strokes[index].pen.length;
    guides.append(svgElement('path', { d }));
  }
  for (const d of lettering.outlines) if (d) reference.append(svgElement('path', { d }));
  bounds = expandPenBounds(lettering.bounds, playback.strokes.map(stroke => stroke.pen), 1.5);
  cancelRopeGrab();
  ropeGradientView.setPens([]); ropePaths = []; ropeShape.replaceChildren();
  gradientView.setPens(playback.strokes.map(stroke => stroke.pen));
  if (inspecting) prepareOrderView();
  updateViewBox();
  artwork.setAttribute('aria-label', text.trim() ? `Borel 필기체로 써지는 ${text}` : '문장을 입력하면 필기 애니메이션을 볼 수 있습니다.');
  settings.duration = Math.ceil(playback.duration * 60) / 60 || 4;
  progress = debugState.mode === 'rope' || reducedMotion.matches ? 1 : 0;
  playing = debugState.mode !== 'rope' && Boolean(totalLength) && !reducedMotion.matches;
  roping = false;
  status.hidden = true;
  pauseButton.disabled = !totalLength;
  photoController.disable(!totalLength || savingPhoto);
  debugState.frame = Math.round(progress * settings.duration * 60);
  frameController?.max(Math.round(settings.duration * 60));
  stepController?.options(Object.fromEntries(orderView.steps.map(step => [`${step.index + 1} · ${stepName[step.kind]}`, step.index])));
  start();
}
let progress = reducedMotion.matches ? 1 : 0;
let playing = !reducedMotion.matches;
let speed = 2;
let lastTime = 0;
let frame = 0;
function render() {
  const time = progress * playback.duration;
  const showRope = !inspecting && Boolean(totalLength) && !playing;
  if (showRope !== roping) {
    cancelRopeGrab(); roping = showRope;
    if (roping) resetRope(time);
  }
  document.body.classList.toggle('roping', roping);
  if (!roping) for (const [index, stroke] of strokes.entries()) {
    const timed = playback.strokes[index];
    const { written, pressure } = strokeState(timed, time);
    if ((!gradientEnabled || inspecting) && (written !== stroke.written || pressure !== stroke.pressure || settings.weight !== stroke.weight)) {
      stroke.path.setAttribute('d', penGeometry(timed.pen, written, pressure, settings.weight));
      stroke.written = written;
      stroke.pressure = pressure;
      stroke.weight = settings.weight;
    }
    // Hide the round cap entirely before a stroke starts.
    stroke.path.style.visibility = written > 0 ? 'visible' : 'hidden';
    if (gradientEnabled && !inspecting) gradientView.renderStroke(index, written, pressure, settings.weight);
  }
  ropeLayer.style.display = roping ? '' : 'none';
  inkLayer.style.display = roping ? 'none' : '';
  if (roping) {
    const pens = ropePaths.map((_, index) => rope.deformed(index));
    for (const [index, path] of ropePaths.entries()) {
      if (!gradientEnabled && (pens[index] !== renderedRopePens[index] || settings.weight !== ropeWeight)) {
        path.setAttribute('d', penGeometry(pens[index], undefined, 1, settings.weight));
        renderedRopePens[index] = pens[index];
      }
      if (gradientEnabled) ropeGradientView.renderDeformedStroke(index, pens[index], settings.weight);
    }
    if (!gradientEnabled) ropeWeight = settings.weight;
    solidRope.style.display = gradientEnabled ? 'none' : '';
    ropeGradientView.layer.style.display = gradientEnabled ? '' : 'none';
  }
  debugState.frame = Math.round(progress * settings.duration * 60);
  pauseButton.dataset.state = playing ? 'pause' : progress === 1 ? 'restart' : 'play';
  pauseButton.setAttribute('aria-label', playing ? '일시정지' : progress === 1 ? '다시하기' : '재생');
  guides.style.display = settings.guides && !inspecting && !roping ? '' : 'none';
  reference.style.display = !roping && (settings.reference || inspecting) ? '' : 'none';
  inkLayer.style.opacity = inspecting ? '.12' : '1';
  solidInk.style.display = gradientEnabled && !inspecting ? 'none' : '';
  gradientView.layer.style.display = gradientEnabled && !inspecting ? '' : 'none';
  orderView.layer.style.display = inspecting ? '' : 'none';
  if (inspecting) debugState.step = orderView.render(playback, time);
  artwork.style.color = settings.ink;
  document.documentElement.style.background = settings.paper;
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
    const selected = button.dataset.ink ? !gradientEnabled && button.dataset.ink === settings.ink : gradientEnabled;
    button.setAttribute('aria-pressed', String(selected));
  }
}
updateColors();
for (const button of colorButtons) button.addEventListener('click', () => {
  gradientEnabled = !button.dataset.ink;
  if (button.dataset.ink) settings.ink = button.dataset.ink;
  updateColors(); render();
});
function submitText() {
  if (ready) writeText(textInput.value);
}
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

function cancelRopeGrab() {
  const pointer = ropePointer;
  ropePointer = undefined;
  rope.release();
  if (pointer !== undefined && artwork.hasPointerCapture(pointer)) artwork.releasePointerCapture(pointer);
  artwork.classList.remove('dragging');
}
function resetRope(time = playback.duration) {
  cancelRopeGrab();
  rope = new FloorRope(visibleRopePens(playback, time));
  renderedRopePens = []; ropeWeight = 0;
  ropePaths = playback.strokes.map(() => svgElement('path', {}));
  ropeShape.replaceChildren(...ropePaths);
  if (ropePlayback !== playback) {
    ropeGradientView.setPens(playback.strokes.map(stroke => stroke.pen));
    ropePlayback = playback;
  }
}
function ropePoint(event: PointerEvent) {
  const matrix = artwork.getScreenCTM();
  return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : undefined;
}
artwork.addEventListener('pointerdown', event => {
  if (!roping || ropePointer !== undefined || event.button !== 0) return;
  const point = ropePoint(event);
  if (!point || !rope.pick(point.x, point.y, 85 * settings.weight)) return;
  event.preventDefault(); ropePointer = event.pointerId;
  artwork.setPointerCapture(event.pointerId); artwork.classList.add('dragging');
  start();
});
artwork.addEventListener('pointermove', event => {
  if (event.pointerId !== ropePointer) return;
  const point = ropePoint(event);
  if (point) rope.move(point.x, point.y);
  if (!frame) start();
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) artwork.addEventListener(name, event => {
  if ((event as PointerEvent).pointerId === ropePointer) { cancelRopeGrab(); start(); }
});

function setView(mode: 'ink' | 'order' | 'rope') {
  inspecting = mode === 'order';
  if (inspecting) prepareOrderView();
  cancelRopeGrab();
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
const gui = new GUI({ title: 'Borel · Debug' });
gui.hide();
let savingPhoto = false;
const photoController = gui.add({ photo: async () => {
  if (!ready || !totalLength || savingPhoto) return;
  savingPhoto = true; photoController.disable();
  try {
    render();
    // Dragged rope can extend outside the original lettering frame. Keep the
    // visible frame and expand it only when needed to include all painted ink.
    const photoBounds = roping ? expandPenBounds(bounds, ropePaths.map((_, i) => rope.deformed(i)), settings.weight) : undefined;
    await downloadArtworkPhoto(artwork, { paper: settings.paper, ink: settings.ink, text: textInput.value, bounds: photoBounds });
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : '사진을 저장하지 못했습니다.';
    status.hidden = false;
  } finally {
    savingPhoto = false; photoController.disable(!totalLength);
  }
} }, 'photo').name('사진 다운로드').disable();
gui.add(debugState, 'mode', { '필기': 'ink', '획순 경로': 'order', '로프': 'rope' }).name('보기').onChange(setView);
gui.add(debugState, 'example', debugExamples).name('테스트 문장').onChange((text: string) => { textInput.value = text; submitText(); });
const frameController = gui.add(debugState, 'frame', 0, 360, 1).name('프레임').onChange(seekFrame);
gui.add(debugState, 'speed', .25, 5, .25).name('재생 속도').onChange((value: number) => { speed = value; });
gui.add(settings, 'weight', .5, 1.5, .05).name('획 두께').onChange(render);
gui.add(settings, 'guides').name('중심 경로').onChange(render);
gui.add(settings, 'reference').name('원본 폰트').onChange(render);
gui.addColor(settings, 'ink').name('사용자 색상').onChange(() => { gradientEnabled = false; updateColors(); render(); });
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
  const step = orderView.steps[index];
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
  cancelAnimationFrame(frame); clearTimeout(inputTimer); cancelRopeGrab(); gui.destroy();
  window.removeEventListener('keydown', debugKeys);
});
loadBorel().then(value => {
  loaded = value; ready = true; textInput.disabled = false;
  writeText(textInput.value);
}).catch(error => {
  status.hidden = false;
  status.textContent = error instanceof Error ? error.message : '필기 자료를 불러오지 못했습니다.';
  playing = false; render();
});
