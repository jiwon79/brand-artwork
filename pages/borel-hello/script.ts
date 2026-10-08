import GUI from 'lil-gui';
import { composeText, unsupportedCharacters, supportedCharacter, type Lettering } from './lettering';
import { loadBorel } from './shaper';
import { paintFontFrame, prepareFontRaster, type FontRaster } from './renderer';

const artwork = document.querySelector<HTMLCanvasElement>('#artwork')!;
const context = artwork.getContext('2d')!;
const slider = document.querySelector<HTMLInputElement>('#progress')!;
const frameNumber = document.querySelector<HTMLInputElement>('#frame-number')!;
const pauseButton = document.querySelector<HTMLButtonElement>('#pause')!;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const settings = { duration: 6, guides: false, ink: '#6f4031', paper: '#f3e8de', reference: false };
let raster: FontRaster | undefined;
let output: ImageData;
let lettering: Lettering;
let lastProgress = -1;
let totalLength = 0;
let ready = false;
const textInput = document.querySelector<HTMLTextAreaElement>('#text-input')!;
const status = document.querySelector<HTMLElement>('#text-status')!;
let loaded: Awaited<ReturnType<typeof loadBorel>>;

function writeText(text: string) {
  const missing = unsupportedCharacters(text, loaded.catalog);
  if (missing.length) {
    status.textContent = `지원하지 않는 문자: ${missing.join(' ')}. 악센트 문자는 제외했습니다.`;
    textInput.setAttribute('aria-invalid', 'true');
    return;
  }
  textInput.removeAttribute('aria-invalid');
  lettering = composeText(text, loaded.shaper, loaded.catalog);
  rebuildRaster();
  artwork.setAttribute('aria-label', text.trim() ? `Borel 필기체로 써지는 ${text}` : '문장을 입력하면 필기 애니메이션을 볼 수 있습니다.');
  settings.duration = Math.max(4, Math.min(60, Math.round(totalLength / 1750 * 2) / 2));
  progress = reducedMotion.matches ? 1 : 0;
  playing = Boolean(totalLength) && !reducedMotion.matches;
  status.textContent = text.trim() ? `${[...text].length}자 · ${lettering.lines.length}줄` : '위 입력창에 문장을 적어 주세요.';
  start();
}
function rebuildRaster() {
  if (!lettering) return;
  const { width, height } = artwork.getBoundingClientRect();
  raster = prepareFontRaster(lettering, loaded.catalog, width, height, window.devicePixelRatio, settings.ink);
  artwork.width = raster.source.width; artwork.height = raster.source.height;
  output = context.createImageData(artwork.width, artwork.height);
  totalLength = raster.totalLength; lastProgress = -1;
}
new ResizeObserver(() => { if (ready) { rebuildRaster(); render(); } }).observe(artwork);
let progress = reducedMotion.matches ? 1 : 0;
let playing = !reducedMotion.matches;
let speed = 1;
let lastTime = 0;
let frame = 0;
function render() {
  if (raster && progress !== lastProgress) {
    paintFontFrame(context, raster, progress, output);
    if (settings.reference && progress < 1) {
      const original = document.createElement('canvas'); original.width = artwork.width; original.height = artwork.height;
      original.getContext('2d')!.putImageData(raster.source, 0, 0);
      context.globalAlpha = .13; context.drawImage(original, 0, 0); context.globalAlpha = 1;
    }
    if (settings.guides) {
      context.strokeStyle = '#dc7962'; context.lineWidth = 1; context.beginPath();
      for (const path of raster.traces) { context.moveTo(...path[0]); for (const point of path.slice(1)) context.lineTo(...point); }
      context.stroke();
    }
    lastProgress = progress;
  }
  const frameCount = Math.round(settings.duration * 60);
  slider.max = String(frameCount);
  slider.step = '1';
  slider.value = String(Math.round(progress * frameCount));
  if (document.activeElement !== frameNumber) frameNumber.value = String(Math.round(progress * frameCount));
  frameNumber.max = String(frameCount);
  document.querySelector('#frame-count')!.textContent = `/ ${frameCount}`;
  pauseButton.textContent = playing ? '일시정지' : progress === 1 ? '재생' : '계속 쓰기';
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
gui.add(settings, 'guides').name('필기 경로').onChange(() => { lastProgress = -1; render(); });
gui.add(settings, 'reference').name('완성된 원본 보기').onChange(() => { lastProgress = -1; render(); });
gui.addColor(settings, 'ink').name('글씨').onChange(() => { rebuildRaster(); render(); });
gui.addColor(settings, 'paper').name('배경').onChange(render);
gui.close();
render();

const presets: Record<string, string> = {
  hello: 'hello',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  numbers: '0123456789 !? & @ # $ % + =',
};
document.querySelector<HTMLFormElement>('#text-form')!.addEventListener('submit', event => { event.preventDefault(); if (ready) writeText(textInput.value); });
textInput.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); if (ready) writeText(textInput.value); } });
document.querySelector<HTMLSelectElement>('#example')!.addEventListener('change', event => {
  const selected = (event.target as HTMLSelectElement).value;
  if (presets[selected] !== undefined && ready) { textInput.value = presets[selected]; writeText(textInput.value); }
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
    button.type = 'button'; button.textContent = character;
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
