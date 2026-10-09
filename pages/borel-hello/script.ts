import GUI from 'lil-gui';
import { composeText, unsupportedCharacters, supportedCharacter } from './lettering';
import { loadBorel } from './shaper';
import { preparePen, penGeometry } from './pen-geometry';
import { createPenPlayback, strokeState, type PenPlayback } from './pen-playback';

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
const inkLayer = svgElement('g', {});
const reference = svgElement('g', { fill: 'currentColor', opacity: '.13', 'pointer-events': 'none' });
const guides = svgElement('g', { fill: 'none', stroke: '#dc7962', 'stroke-width': '5', opacity: '.65', 'pointer-events': 'none' });
artwork.append(reference, inkLayer, guides);
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
  inkLayer.replaceChildren(); reference.replaceChildren(); guides.replaceChildren();
  strokes = []; totalLength = 0;
  for (const [index, stroke] of lettering.strokes.entries()) {
    const { d } = stroke;
    const path = svgElement('path', { d: '', fill: 'currentColor' });
    inkLayer.append(path);
    strokes.push({ path });
    totalLength += playback.strokes[index].pen.length;
    guides.append(svgElement('path', { d }));
  }
  for (const d of lettering.outlines) if (d) reference.append(svgElement('path', { d }));
  const [left, top, right, bottom] = lettering.bounds;
  artwork.setAttribute('viewBox', `${left} ${top} ${right - left} ${bottom - top}`);
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
  }
  const frameCount = Math.round(settings.duration * 60);
  slider.max = String(frameCount);
  slider.step = '1';
  slider.value = String(Math.round(progress * frameCount));
  if (document.activeElement !== frameNumber) frameNumber.value = String(Math.round(progress * frameCount));
  frameNumber.max = String(frameCount);
  document.querySelector('#frame-count')!.textContent = `/ ${frameCount}`;
  pauseButton.textContent = playing ? '일시정지' : progress === 1 ? '재생' : '계속 쓰기';
  guides.style.display = settings.guides ? '' : 'none';
  reference.style.display = settings.reference ? '' : 'none';
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
const gui = new GUI({ title: 'Borel Handwriting' });
gui.add(settings, 'duration', 2, 60, .5).listen().name('필기 시간 (초)').onChange(render);
gui.add(settings, 'guides').name('필기 경로').onChange(render);
gui.add(settings, 'reference').name('Borel 원형 비교').onChange(render);
gui.addColor(settings, 'ink').name('글씨').onChange(render);
gui.addColor(settings, 'paper').name('배경').onChange(render);
gui.close();
render();

document.querySelector<HTMLFormElement>('#text-form')!.addEventListener('submit', event => { event.preventDefault(); if (ready) writeText(textInput.value); });
textInput.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); if (ready) writeText(textInput.value); } });
document.querySelector<HTMLSelectElement>('#example')!.addEventListener('change', event => {
  const selected = (event.target as HTMLSelectElement).value;
  if (ready) { textInput.value = selected; writeText(textInput.value); }
});

loadBorel().then(value => {
  loaded = value; ready = true;
  document.querySelector<HTMLButtonElement>('#write')!.disabled = false;
  document.querySelector<HTMLSelectElement>('#example')!.disabled = false;
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
