import GUI from 'lil-gui';
import { exposeGuiInDebugMode } from '../../common/debug';
import { Rope, config, type Bounds } from './rope';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const bounds: Bounds = { width: 0, height: 0 };
let guiHeight = 0;

function resize() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const scale = Math.min(vw / 9, (vh - guiHeight) / 16);
  bounds.width = Math.floor(9 * scale);
  bounds.height = Math.floor(16 * scale);

  canvas.width = bounds.width;
  canvas.height = bounds.height;
  canvas.style.width = bounds.width + 'px';
  canvas.style.height = bounds.height + 'px';
  canvas.style.left = Math.floor((vw - bounds.width) / 2) + 'px';
  canvas.style.top = Math.floor(guiHeight + (vh - guiHeight - bounds.height) / 2) + 'px';
}

let ropes: Rope[] = [];

function initRopes() {
  ropes = [];
  const cols = config.cols;
  const rows = config.rows;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const t = cols > 1 ? col / (cols - 1) : 0.5;
      const x = bounds.width * 0.03 + t * bounds.width * 0.94;
      const rt = rows > 1 ? row / (rows - 1) : 0;
      const pinY = rt * bounds.height * 0.7;
      const lw = config.uniform ? 9.5 : 7 + Math.random() * 5;
      const len = config.uniform ? bounds.height * config.ropeLength : bounds.height * (config.ropeLength - 0.06 + Math.random() * 0.12);
      const segs = config.uniform ? 20 : 16 + Math.floor(Math.random() * 8);
      ropes.push(new Rope(x, pinY, len, segs, lw));
    }
  }
}

// ── Pointer state ─────────────────────────────────────────
const mouse = { x: -999, y: -999, px: -999, py: -999, down: false };

function canvasCoords(clientX: number, clientY: number): [number, number] {
  const rect = canvas.getBoundingClientRect();
  return [clientX - rect.left, clientY - rect.top];
}

function setPointer(clientX: number, clientY: number) {
  mouse.px = mouse.x;
  mouse.py = mouse.y;
  [mouse.x, mouse.y] = canvasCoords(clientX, clientY);
}

function beginPointer(clientX: number, clientY: number) {
  mouse.down = true;
  const [x, y] = canvasCoords(clientX, clientY);
  mouse.px = x;
  mouse.py = y;
  mouse.x = x;
  mouse.y = y;
}

function endPointer() {
  mouse.down = false;
}

function applySweep() {
  if (!mouse.down) return;
  const dvx = mouse.x - mouse.px;
  const dvy = mouse.y - mouse.py;
  for (const r of ropes) r.applySweep(mouse.x, mouse.y, dvx, dvy);
}

canvas.addEventListener('mousemove', (e) => {
  setPointer(e.clientX, e.clientY);
  applySweep();
});
canvas.addEventListener('mousedown', (e) => beginPointer(e.clientX, e.clientY));
canvas.addEventListener('mouseup', endPointer);

canvas.addEventListener(
  'touchmove',
  (e) => {
    e.preventDefault();
    const t = e.touches[0];
    setPointer(t.clientX, t.clientY);
    applySweep();
  },
  { passive: false },
);
canvas.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  beginPointer(t.clientX, t.clientY);
});
canvas.addEventListener('touchend', endPointer);

// ── Render ────────────────────────────────────────────────
function loop() {
  ctx.fillStyle = 'rgba(10,10,10,0.88)';
  ctx.fillRect(0, 0, bounds.width, bounds.height);

  for (const r of ropes) r.update(bounds);
  for (let i = ropes.length - 1; i >= 0; i--) ropes[i].draw(ctx);

  requestAnimationFrame(loop);
}

// ── GUI ───────────────────────────────────────────────────
const gui = exposeGuiInDebugMode(new GUI({ title: 'debug' }));
gui.domElement.style.setProperty('--widget-height', '20px');
gui.close();

const gridFolder = gui.addFolder('grid');
gridFolder.add(config, 'cols', 1, 40, 1).name('columns').onChange(() => initRopes());
gridFolder.add(config, 'rows', 1, 12, 1).name('rows').onChange(() => initRopes());
gridFolder.add(config, 'ropeLength', 0.05, 0.8, 0.01).name('rope length').onChange(() => initRopes());

const ropeFolder = gui.addFolder('rope');
ropeFolder.add(config, 'gravity', 0.0, 5.0, 0.1).name('gravity');
ropeFolder.add(config, 'damping', 0.9, 1.0, 0.001).name('damping');
ropeFolder.add(config, 'stiffness', 0.1, 1.0, 0.05).name('stiffness');
ropeFolder.add(config, 'iterations', 1, 80, 1).name('iterations');

gui.add(config, 'uniform').name('uniform').onChange(() => initRopes());
gui.add(config, 'blueprint').name('blueprint');

// Measure collapsed GUI height and use as top padding
guiHeight = gui.domElement.offsetHeight;

// ── Start ─────────────────────────────────────────────────
window.addEventListener('resize', () => {
  resize();
  initRopes();
});

resize();
initRopes();
loop();
