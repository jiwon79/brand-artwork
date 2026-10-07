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
const pauseButton = document.querySelector<HTMLButtonElement>('#pause')!;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const settings = { duration: 6, guides: false, ink: '#6f4031', paper: '#f3e8de' };
const defs = svgElement('defs', {});
artwork.append(defs);
const strokes: { path: SVGPathElement; length: number; start: number }[] = [];
let totalLength = 0;

for (const [index, glyph] of lettering.entries()) {
  const mask = svgElement('mask', { id: `letter-${index}`, maskUnits: 'userSpaceOnUse', x: '0', y: '0', width: '1100', height: '530', 'mask-type': 'luminance' });
  defs.append(mask);
  for (const d of glyph.strokes) {
    const path = svgElement('path', { d, fill: 'none', stroke: 'white', 'stroke-width': '54', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    mask.append(path);
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length} ${length}`;
    strokes.push({ path, length, start: totalLength });
    totalLength += length;
  }
  // Masks are per glyph: the brush cannot expose the next letter at a join.
  const group = svgElement('g', { mask: `url(#letter-${index})` });
  group.append(svgElement('path', { d: glyph.outline, transform: 'translate(0 80)', fill: 'currentColor' }));
  artwork.append(group);
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
  slider.value = String(progress);
  pauseButton.textContent = playing ? '일시정지' : progress === 1 ? '재생' : '계속 쓰기';
  guides.style.display = settings.guides ? '' : 'none';
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
document.querySelector<HTMLSelectElement>('#speed')!.addEventListener('change', event => { speed = Number((event.target as HTMLSelectElement).value); });
document.addEventListener('visibilitychange', () => { lastTime = 0; });
reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) { progress = 1; playing = false; render(); } });
const gui = new GUI({ title: 'Borel Hello' });
gui.add(settings, 'duration', 2, 12, .5).name('필기 시간 (초)');
gui.add(settings, 'guides').name('필기 경로').onChange(render);
gui.addColor(settings, 'ink').name('글씨').onChange(render);
gui.addColor(settings, 'paper').name('배경').onChange(render);
gui.close();
start();
