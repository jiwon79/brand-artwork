import GUI from 'lil-gui';
import { lettering } from './lettering';

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
const reference = svgElement('g', { fill: 'currentColor', opacity: '.13', 'pointer-events': 'none' });
for (const glyph of lettering) reference.append(svgElement('path', { d: glyph.outline, transform: 'translate(0 80)' }));
artwork.append(reference);
const strokes: { path: SVGPathElement; length: number; start: number }[] = [];
let totalLength = 0;

// Draw the pen's actual trajectory. Clipping a wide brush to a completed font
// outline exposes future branches at self-crossings and creates jagged tips.
// These round strokes are a Borel-based interpretation, not exact font outlines.
for (const glyph of lettering) {
  for (const d of glyph.strokes) {
    const path = svgElement('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': '36', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    artwork.append(path);
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length} ${length}`;
    strokes.push({ path, length, start: totalLength });
    totalLength += length;
  }
}
const guides = svgElement('g', { fill: 'none', stroke: '#dc7962', 'stroke-width': '2', opacity: '.65', 'pointer-events': 'none' });
for (const glyph of lettering) for (const d of glyph.strokes) guides.append(svgElement('path', { d }));
artwork.append(guides);
let progress = reducedMotion.matches ? 1 : 0;
let playing = !reducedMotion.matches;
let speed = 1;
let lastTime = 0;
let frame = 0;
function render() {
  const distance = progress * totalLength;
  for (const stroke of strokes) {
    const written = Math.max(0, Math.min(stroke.length, distance - stroke.start));
    stroke.path.style.strokeDashoffset = String(stroke.length - written);
    // Hide the round cap entirely before a stroke starts.
    stroke.path.style.visibility = written > 0 ? 'visible' : 'hidden';
  }
  const frameCount = Math.round(settings.duration * 60);
  slider.step = String(1 / frameCount);
  slider.value = String(progress);
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
document.querySelector('#replay')!.addEventListener('click', () => { progress = 0; playing = true; start(); });
pauseButton.addEventListener('click', () => { if (progress === 1) progress = 0; playing = !playing; start(); });
slider.addEventListener('input', () => { progress = Number(slider.value); playing = false; render(); });
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
const gui = new GUI({ title: 'Borel Hello' });
gui.add(settings, 'duration', 2, 12, .5).name('필기 시간 (초)').onChange(render);
gui.add(settings, 'guides').name('필기 경로').onChange(render);
gui.add(settings, 'reference').name('Borel 원형 비교').onChange(render);
gui.addColor(settings, 'ink').name('글씨').onChange(render);
gui.addColor(settings, 'paper').name('배경').onChange(render);
gui.close();
start();
