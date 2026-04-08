import { Rope, type Bounds } from './rope';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const bounds: Bounds = { width: 0, height: 0 };

function resize() {
  bounds.width = canvas.width = window.innerWidth;
  bounds.height = canvas.height = window.innerHeight;
}

let ropes: Rope[] = [];

function initRopes() {
  ropes = [];
  const cols = 22;
  const rows = 6;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const t = col / (cols - 1);
      const x = bounds.width * 0.03 + t * bounds.width * 0.94;
      const pinY = row * bounds.height * 0.14 - 30;
      const lw = 7 + Math.random() * 5;
      const len = bounds.height * (0.18 + Math.random() * 0.12);
      const segs = 16 + Math.floor(Math.random() * 8);
      ropes.push(new Rope(x, pinY, len, segs, lw));
    }
  }
}

// ── Pointer state ─────────────────────────────────────────
const mouse = { x: -999, y: -999, px: -999, py: -999, down: false };

function setPointer(x: number, y: number) {
  mouse.px = mouse.x;
  mouse.py = mouse.y;
  mouse.x = x;
  mouse.y = y;
}

function beginPointer(x: number, y: number) {
  mouse.down = true;
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

window.addEventListener('resize', () => {
  resize();
  initRopes();
});

resize();
initRopes();
loop();
