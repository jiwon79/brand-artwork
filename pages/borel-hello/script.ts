import GUI from 'lil-gui';
import { composeText, unsupportedCharacters, supportedCharacter } from './lettering';
import { loadBorel } from './shaper';
import { preparePen, penGeometry } from './pen-geometry';
import { createPenPlayback, strokeState, type PenPlayback } from './pen-playback';
import { activeOrderStep, letterContexts } from './stroke-order';
import { StrokeOrderView, stepName } from './stroke-order-view';
import { GradientInkView } from './gradient-ink-view';

const NS = 'http://www.w3.org/2000/svg';
function svgElement<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string>) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}
const artwork = document.querySelector<SVGSVGElement>('#artwork')!;
const slider = document.querySelector<HTMLInputElement>('#progress')!;
const frameNumber = document.querySelector<HTMLInputElement>('#frame-number')!;
const pauseButton = document.querySelector<HTMLButtonElement>('#pause')!;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const settings = { duration: 6, guides: false, ink: '#6f4031', paper: '#f3e8de', reference: false };
let gradientEnabled = false;
const gradientView = new GradientInkView();
const inkShape = svgElement('g', { id: 'borel-ink-shape' });
const inkMask = svgElement('mask', { id: 'borel-ink-mask', maskUnits: 'userSpaceOnUse', 'mask-type': 'alpha' });
inkMask.append(svgElement('use', { href: '#borel-ink-shape' }));
const definitions = svgElement('defs', {});
definitions.append(inkShape, inkMask);
const inkLayer = svgElement('g', {});
const solidInk = svgElement('use', { href: '#borel-ink-shape' });
inkLayer.append(solidInk, gradientView.layer);
const reference = svgElement('g', { fill: 'currentColor', opacity: '.13', 'pointer-events': 'none' });
const guides = svgElement('g', { fill: 'none', stroke: '#dc7962', 'stroke-width': '5', opacity: '.65', 'pointer-events': 'none' });
const orderView = new StrokeOrderView();
artwork.append(definitions, gradientView.definitions, reference, inkLayer, guides, orderView.layer);
const orderPanel = document.querySelector<HTMLElement>('#order-panel')!;
const inspectLetter = document.querySelector<HTMLSelectElement>('#inspect-letter')!;
const inspectContext = document.querySelector<HTMLSelectElement>('#inspect-context')!;
const inspectStep = document.querySelector<HTMLSelectElement>('#inspect-step')!;
const orderStatus = document.querySelector<HTMLElement>('#order-status')!;
const inspectSource = document.querySelector<HTMLAnchorElement>('#inspect-source')!;
let inspecting = false;
let bounds: readonly number[] = [0, 0, 1100, 530];
let lastOrderStep = -2;
function updateViewBox() {
  const [left, top, right, bottom] = bounds, pad = inspecting ? 180 : 0;
  artwork.setAttribute('viewBox', `${left - pad} ${top - pad} ${right - left + 2 * pad} ${bottom - top + 2 * pad}`);
}
let strokes: { path: SVGPathElement; written?: number; pressure?: number }[] = [];
let playback: PenPlayback = { strokes: [], duration: 0 };
let totalLength = 0;
let ready = false;
const textInput = document.querySelector<HTMLTextAreaElement>('#text-input')!;
const status = document.querySelector<HTMLElement>('#text-status')!;
let loaded: Awaited<ReturnType<typeof loadBorel>>;

function writeText(text: string) {
  const missing = unsupportedCharacters(text, loaded.catalog);
  if (missing.length) {
    status.textContent = `지원하지 않는 문자: ${missing.join(' ')}. 지원 문자 목록에서 확인할 수 있습니다.`;
    textInput.setAttribute('aria-invalid', 'true');
    return;
  }
  textInput.removeAttribute('aria-invalid');
  const lettering = composeText(text, loaded.shaper, loaded.catalog);
  playback = createPenPlayback(lettering.strokes.map(preparePen));
  orderView.setPlayback(playback);
  inspectStep.replaceChildren(...orderView.steps.map(step => new Option(`${step.index + 1} · ${stepName[step.kind]}`, String(step.index))));
  inspectStep.disabled = !orderView.steps.length;
  lastOrderStep = -2;
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
  bounds = lettering.bounds;
  const [left, top, right, bottom] = bounds;
  for (const [name, value] of Object.entries({ x: left, y: top, width: right - left, height: bottom - top })) inkMask.setAttribute(name, String(value));
  gradientView.setPens(playback.strokes.map(stroke => stroke.pen), lettering.bounds);
  updateViewBox();
  artwork.setAttribute('aria-label', text.trim() ? `Borel 필기체로 써지는 ${text}` : '문장을 입력하면 필기 애니메이션을 볼 수 있습니다.');
  settings.duration = Math.ceil(playback.duration * 60) / 60 || 4;
  progress = reducedMotion.matches ? 1 : 0;
  playing = Boolean(totalLength) && !reducedMotion.matches;
  status.textContent = text.trim() ? `${[...text].length}자 · ${lettering.lines.length}줄` : '위 입력창에 문장을 적어 주세요.';
  start();
}
let progress = reducedMotion.matches ? 1 : 0;
let playing = !reducedMotion.matches;
let speed = 1;
let lastTime = 0;
let frame = 0;
function render() {
  const time = progress * playback.duration;
  for (const [index, stroke] of strokes.entries()) {
    const timed = playback.strokes[index];
    const { written, pressure } = strokeState(timed, time);
    if (written !== stroke.written || pressure !== stroke.pressure) {
      stroke.path.setAttribute('d', penGeometry(timed.pen, written, pressure));
      stroke.written = written;
      stroke.pressure = pressure;
    }
    // Hide the round cap entirely before a stroke starts.
    stroke.path.style.visibility = written > 0 ? 'visible' : 'hidden';
    if (gradientEnabled && !inspecting) gradientView.renderStroke(index, written, pressure);
  }
  const frameCount = Math.round(settings.duration * 60);
  slider.max = String(frameCount);
  slider.step = '1';
  slider.value = String(Math.round(progress * frameCount));
  if (document.activeElement !== frameNumber) frameNumber.value = String(Math.round(progress * frameCount));
  frameNumber.max = String(frameCount);
  document.querySelector('#frame-count')!.textContent = `/ ${frameCount}`;
  pauseButton.textContent = playing ? '일시정지' : progress === 1 ? '재생' : '계속 쓰기';
  guides.style.display = settings.guides && !inspecting ? '' : 'none';
  reference.style.display = settings.reference || inspecting ? '' : 'none';
  inkLayer.style.opacity = inspecting ? '.12' : '1';
  solidInk.style.display = gradientEnabled && !inspecting ? 'none' : '';
  gradientView.layer.style.display = gradientEnabled && !inspecting ? '' : 'none';
  orderView.layer.style.display = inspecting ? '' : 'none';
  if (inspecting) {
    const active = orderView.render(playback, time);
    if (active !== lastOrderStep) {
      inspectStep.value = String(active);
      orderStatus.textContent = active < 0 ? '문장을 입력하세요.' : `${active + 1} / ${orderView.steps.length} · ${stepName[orderView.steps[active].kind]}`;
      document.querySelector<HTMLButtonElement>('#previous-step')!.disabled = active <= 0;
      document.querySelector<HTMLButtonElement>('#next-step')!.disabled = active < 0 || active >= orderView.steps.length - 1;
      lastOrderStep = active;
    }
  }
  artwork.style.color = settings.ink;
  document.documentElement.style.background = settings.paper;
}
function tick(time: number) {
  if (playing && lastTime && !document.hidden) {
    progress = Math.min(1, progress + (time - lastTime) * speed / (settings.duration * 1000));
    if (progress === 1) playing = false;
  }
  lastTime = time;
  render();
  frame = playing ? requestAnimationFrame(tick) : 0;
}
function start() {
  lastTime = 0;
  if (!frame) frame = requestAnimationFrame(tick);
  render();
}
document.querySelector('#replay')!.addEventListener('click', () => { if (!ready || !totalLength) return; progress = 0; playing = true; start(); });
pauseButton.addEventListener('click', () => { if (!ready || !totalLength) return; if (progress === 1) progress = 0; playing = !playing; start(); });
slider.addEventListener('input', () => { progress = Number(slider.value) / (settings.duration * 60); playing = false; render(); });
frameNumber.addEventListener('focus', () => { playing = false; render(); });
frameNumber.addEventListener('blur', render);
frameNumber.addEventListener('input', () => {
  if (frameNumber.value === '') return;
  const requested = Number(frameNumber.value);
  if (!Number.isFinite(requested)) return;
  progress = Math.max(0, Math.min(1, requested / (settings.duration * 60)));
  playing = false;
  render();
});
function stepFrame(direction: number) {
  progress = Math.max(0, Math.min(1, (Math.round(progress * settings.duration * 60) + direction) / (settings.duration * 60)));
  playing = false;
  render();
}
document.querySelector('#previous-frame')!.addEventListener('click', () => stepFrame(-1));
document.querySelector('#next-frame')!.addEventListener('click', () => stepFrame(1));
document.querySelector<HTMLSelectElement>('#speed')!.addEventListener('change', event => { speed = Number((event.target as HTMLSelectElement).value); });
document.addEventListener('visibilitychange', () => { lastTime = 0; });
reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) { progress = 1; playing = false; render(); } });
for (const [id, enabled] of [['solid-color', false], ['gradient-color', true]] as const) {
  document.querySelector(`#${id}`)!.addEventListener('click', () => {
    gradientEnabled = enabled;
    document.querySelector('#solid-color')!.setAttribute('aria-pressed', String(!enabled));
    document.querySelector('#gradient-color')!.setAttribute('aria-pressed', String(enabled));
    render();
  });
}
const gui = new GUI({ title: 'Borel Handwriting' });
gui.add(settings, 'duration', 2, 60, .5).listen().name('필기 시간 (초)').onChange(render);
gui.add(settings, 'guides').name('필기 경로').onChange(render);
gui.add(settings, 'reference').name('Borel 원형 비교').onChange(render);
gui.addColor(settings, 'ink').name('글씨').onChange(render);
gui.addColor(settings, 'paper').name('배경').onChange(render);
gui.close();
render();

function submitText() {
  if (!ready) return;
  inspectLetter.value = '';
  inspectContext.replaceChildren(new Option('글자를 선택하세요', ''));
  inspectContext.disabled = true;
  inspectSource.href = 'https://eduscol.education.fr/document/15805/download';
  writeText(textInput.value);
}
document.querySelector<HTMLFormElement>('#text-form')!.addEventListener('submit', event => { event.preventDefault(); submitText(); });
textInput.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); submitText(); } });
document.querySelector<HTMLSelectElement>('#example')!.addEventListener('change', event => {
  const selected = (event.target as HTMLSelectElement).value;
  if (ready) { textInput.value = selected; submitText(); }
});

for (const [id, enabled] of [['ink-view', false], ['order-view', true]] as const) {
  document.querySelector(`#${id}`)!.addEventListener('click', () => {
    inspecting = enabled; orderPanel.hidden = !enabled;
    document.body.classList.toggle('inspecting', enabled);
    document.querySelector('#ink-view')!.setAttribute('aria-pressed', String(!enabled));
    document.querySelector('#order-view')!.setAttribute('aria-pressed', String(enabled));
    updateViewBox(); render();
  });
}
function jumpToStep(index: number) {
  const step = orderView.steps[index];
  if (!step || !playback.duration) return;
  progress = (step.start + Math.min(.001, (step.end - step.start) / 2)) / playback.duration;
  playing = false; render();
}
inspectStep.addEventListener('change', () => jumpToStep(Number(inspectStep.value)));
for (const [id, direction] of [['previous-step', -1], ['next-step', 1]] as const) {
  document.querySelector(`#${id}`)!.addEventListener('click', () => jumpToStep(activeOrderStep(orderView.steps, progress * playback.duration) + direction));
}
inspectLetter.addEventListener('change', () => {
  if (!inspectLetter.value || !ready) {
    inspectContext.replaceChildren(new Option('글자를 선택하세요', ''));
    inspectContext.disabled = true;
    inspectSource.href = 'https://eduscol.education.fr/document/15805/download';
    return;
  }
  const letter = inspectLetter.value;
  inspectSource.href = letter === letter.toLowerCase()
    ? `https://l-education.com/ecrire-la-lettre-${letter}-minuscule-cursive`
    : `https://l-education.com/apprendre-a-ecrire-la-lettre-${letter.toLowerCase()}-majuscule-cursive`;
  const contexts = letterContexts(inspectLetter.value, loaded.shaper, loaded.catalog);
  inspectContext.replaceChildren(...contexts.map(context => {
    const glyphs = loaded.shaper.shape(context.text), index = glyphs.findIndex(glyph => glyph.id === context.id);
    const position = glyphs.length === 1 ? '단독' : index === 0 ? '처음' : index === glyphs.length - 1 ? '끝' : '중간';
    return new Option(`${position} · ${context.text}`, context.text);
  }));
  inspectContext.disabled = contexts.length < 2;
  textInput.value = contexts[0]?.text ?? inspectLetter.value;
  writeText(textInput.value);
});
inspectContext.addEventListener('change', () => { textInput.value = inspectContext.value; writeText(textInput.value); });

loadBorel().then(value => {
  loaded = value; ready = true;
  document.querySelector<HTMLButtonElement>('#write')!.disabled = false;
  document.querySelector<HTMLSelectElement>('#example')!.disabled = false;
  for (const [label, letters] of [['소문자', 'abcdefghijklmnopqrstuvwxyz'], ['대문자', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ']]) {
    const group = document.createElement('optgroup'); group.label = label;
    group.append(...[...letters].map(letter => new Option(letter, letter))); inspectLetter.append(group);
  }
  inspectLetter.disabled = false;
  const characterList = document.querySelector('#character-list')!;
  for (const codepoint of Object.keys(loaded.catalog.cmap)) {
    const character = String.fromCodePoint(Number(codepoint));
    if (!supportedCharacter(character, loaded.catalog) || /\p{Z}/u.test(character)) continue;
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = /\p{M}/u.test(character) ? `◌${character}` : character;
    button.title = `U+${Number(codepoint).toString(16).toUpperCase().padStart(4, '0')}`;
    button.setAttribute('aria-label', `${character} 삽입`);
    button.addEventListener('click', () => {
      const start = textInput.selectionStart, end = textInput.selectionEnd;
      if (textInput.value.length - (end - start) + character.length > textInput.maxLength) return;
      textInput.setRangeText(character, start, end, 'end');
      textInput.focus();
    });
    characterList.append(button);
  }
  writeText(textInput.value);
}).catch(error => {
  status.textContent = error instanceof Error ? error.message : '필기 자료를 불러오지 못했습니다.';
  playing = false; render();
});
