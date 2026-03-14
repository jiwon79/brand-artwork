const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const GOOGLE_COLORS = ['#4285F4', '#EA4335', '#FBBC05', '#4285F4', '#34A853', '#EA4335'];
const GOOGLE_LETTERS = ['G', 'o', 'o', 'g', 'l', 'e'];

const NODE_RADIUS = 38;
const FONT_SIZE = 42;
const REPEL_DIST = 180;
const ATTRACT_DIST = 260;
const DAMPING = 0.88;
const EDGE_PAIRS = [[0,1],[1,2],[2,3],[3,4],[4,5],[0,3],[1,4],[2,5],[0,5],[1,3]];

let nodes = [];
let dragging = null;
let dragOffX = 0, dragOffY = 0;
let W, H;

function resize() {
  W = canvas.width = canvas.offsetWidth * devicePixelRatio;
  H = canvas.height = canvas.offsetHeight * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  W /= devicePixelRatio;
  H /= devicePixelRatio;
}

function initNodes() {
  nodes = GOOGLE_LETTERS.map((letter, i) => {
    const angle = (i / GOOGLE_LETTERS.length) * Math.PI * 2 - Math.PI / 2;
    const r = Math.min(W, H) * 0.28;
    return {
      x: W / 2 + Math.cos(angle) * r,
      y: H / 2 + Math.sin(angle) * r,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      letter,
      color: GOOGLE_COLORS[i],
      pulsePhase: i * (Math.PI / 3),
      glowIntensity: 0,
    };
  });
}

function applyForces() {
  // Repulsion between all nodes
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      if (dist < REPEL_DIST) {
        const force = (REPEL_DIST - dist) / REPEL_DIST * 0.6;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }
  }

  // Attraction along edges
  for (const [i, j] of EDGE_PAIRS) {
    const a = nodes[i], b = nodes[j];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
    if (dist > ATTRACT_DIST) {
      const force = (dist - ATTRACT_DIST) / ATTRACT_DIST * 0.15;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }
  }

  // Center gravity
  for (const n of nodes) {
    n.vx += (W / 2 - n.x) * 0.0008;
    n.vy += (H / 2 - n.y) * 0.0008;
  }
}

function updateNodes(t) {
  for (const n of nodes) {
    if (n === dragging) continue;
    n.vx *= DAMPING;
    n.vy *= DAMPING;
    n.x += n.vx;
    n.y += n.vy;

    // Boundary bounce
    const margin = NODE_RADIUS + 10;
    if (n.x < margin) { n.x = margin; n.vx *= -0.5; }
    if (n.x > W - margin) { n.x = W - margin; n.vx *= -0.5; }
    if (n.y < margin) { n.y = margin; n.vy *= -0.5; }
    if (n.y > H - margin) { n.y = H - margin; n.vy *= -0.5; }

    n.glowIntensity = 0.5 + 0.5 * Math.sin(t * 0.0015 + n.pulsePhase);
  }
}

function edgeAlpha(i, j, t) {
  const phase = (i + j) * 0.8;
  return 0.12 + 0.22 * Math.abs(Math.sin(t * 0.001 + phase));
}

function drawEdges(t) {
  for (const [i, j] of EDGE_PAIRS) {
    const a = nodes[i], b = nodes[j];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const alpha = edgeAlpha(i, j, t) * (1 - Math.min(dist / 500, 1) * 0.6);

    const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    grad.addColorStop(0, hexAlpha(a.color, alpha));
    grad.addColorStop(1, hexAlpha(b.color, alpha));

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Animated particle on edge
    const prog = ((t * 0.0004 + (i + j) * 0.15) % 1);
    const px = a.x + dx * prog;
    const py = a.y + dy * prog;
    ctx.beginPath();
    ctx.arc(px, py, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = hexAlpha(a.color, 0.7);
    ctx.fill();
  }
}

function drawNodes(t) {
  for (const n of nodes) {
    const glow = n.glowIntensity;
    const r = NODE_RADIUS;

    // Outer glow
    const outerGrad = ctx.createRadialGradient(n.x, n.y, r * 0.5, n.x, n.y, r * 2.2);
    outerGrad.addColorStop(0, hexAlpha(n.color, 0.18 * glow));
    outerGrad.addColorStop(1, hexAlpha(n.color, 0));
    ctx.beginPath();
    ctx.arc(n.x, n.y, r * 2.2, 0, Math.PI * 2);
    ctx.fillStyle = outerGrad;
    ctx.fill();

    // Node circle
    const nodeGrad = ctx.createRadialGradient(n.x - r * 0.25, n.y - r * 0.25, r * 0.1, n.x, n.y, r);
    nodeGrad.addColorStop(0, hexAlpha(n.color, 0.95));
    nodeGrad.addColorStop(1, hexAlpha(n.color, 0.7));

    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fillStyle = nodeGrad;
    ctx.shadowColor = n.color;
    ctx.shadowBlur = 18 + 14 * glow;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Border ring
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = hexAlpha('#ffffff', 0.15 + 0.1 * glow);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Letter
    ctx.font = `bold ${FONT_SIZE}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 4;
    ctx.fillText(n.letter, n.x, n.y + 2);
    ctx.shadowBlur = 0;
  }
}

function hexAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawBackground() {
  ctx.clearRect(0, 0, W, H);
  // Subtle radial gradient background
  const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
  bg.addColorStop(0, '#111318');
  bg.addColorStop(1, '#060608');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
}

let animId;
function animate(t) {
  animId = requestAnimationFrame(animate);
  drawBackground();
  applyForces();
  updateNodes(t);
  drawEdges(t);
  drawNodes(t);
}

// Interaction
function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const src = e.touches ? e.touches[0] : e;
  return { x: src.clientX - rect.left, y: src.clientY - rect.top };
}

function hitNode(x, y) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const dx = x - n.x, dy = y - n.y;
    if (dx * dx + dy * dy < NODE_RADIUS * NODE_RADIUS * 1.5) return n;
  }
  return null;
}

function onDown(e) {
  const { x, y } = getPos(e);
  const hit = hitNode(x, y);
  if (hit) {
    dragging = hit;
    dragOffX = hit.x - x;
    dragOffY = hit.y - y;
    e.preventDefault();
  }
  document.getElementById('hint').classList.add('hidden');
}

function onMove(e) {
  if (!dragging) return;
  const { x, y } = getPos(e);
  dragging.x = x + dragOffX;
  dragging.y = y + dragOffY;
  dragging.vx = 0;
  dragging.vy = 0;
  e.preventDefault();
}

function onUp() {
  dragging = null;
}

canvas.addEventListener('mousedown', onDown);
canvas.addEventListener('mousemove', onMove);
canvas.addEventListener('mouseup', onUp);
canvas.addEventListener('touchstart', onDown, { passive: false });
canvas.addEventListener('touchmove', onMove, { passive: false });
canvas.addEventListener('touchend', onUp);

window.addEventListener('resize', () => {
  resize();
  initNodes();
});

resize();
initNodes();
animate(0);

// Hide hint after 4s
setTimeout(() => document.getElementById('hint').classList.add('hidden'), 4000);
