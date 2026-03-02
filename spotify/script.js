/* =========================================================
   Lyrics Rain — Spotify Player
   Physics: Matter.js rigid body simulation
   ========================================================= */

const { Engine, Bodies, Body, World, Events, Composite } = Matter;

// ── Config ──────────────────────────────────────────────
const CFG = {
  minFont: 13,
  maxFont: 46,
  spawnMs: 1400,        // base interval between word spawns (ms)
  gravity: 1.0,
  restitution: 0.28,
  friction: 0.65,
  frictionAir: 0.018,
  explosionForce: 0.055,
  explosionRadius: 190,
  cleanupRatio: 0.5,    // pile height threshold (fraction of canvas)
  fadeSpeed: 0.04,
  colors: [
    '#1DB954', // Spotify green
    '#E91E63', // pink
    '#9C27B0', // purple
    '#2196F3', // blue
    '#FF9800', // orange
    '#FF5722', // deep orange
    '#00BCD4', // cyan
    '#F44336', // red
    '#8BC34A', // light green
    '#673AB7', // deep purple
  ],
};

// ── Mock lyrics — Still D.R.E. (Dr. Dre ft. Snoop Dogg) ──
const SAMPLE_LYRICS = [
  'Still', 'D.R.E.', 'still', 'blazin\'',
  'It\'s still', 'Dre day', 'yeah', 'uh',
  'representing', 'gangsters', 'worldwide',
  'Compton', 'low-lows', 'corners', 'girl',
  'still got', 'love', 'for the', 'streets',
  'dedicated', 'to all', 'the people',
  'ridin\'', 'wit me', 'back then',
  'Slim', 'Hittman', 'Mel-Man',
  'still', 'number', 'one', 'now',
  'platinum', 'every', 'album', 'shelf',
  'West Coast', 'G-Funk', 'bass', 'treble',
  'Snoop', 'Dogg', 'LBC', 'in', 'the house',
  'microphone', 'style', 'never', 'gets', 'old',
  'can\'t', 'stop', 'won\'t', 'stop',
  'Dr.', 'Dre', 'still', 'here',
  'hit \'em', 'hard', 'yeah', 'uh-huh',
  'the game', 'don\'t', 'stop', 'for nobody',
  'ride', 'or', 'die', 'homie',
  'still', 'got it', 'like', 'that',
];

// ── State ────────────────────────────────────────────────
let engine, world;
let canvas, ctx, W, H;
let walls = [];

let wordBodies = [];   // { body, word, fontSize, color, bw, bh, spawnTime, fading, opacity }
let particles = [];    // explosion particles
let lyricsIdx = 0;
let isPlaying = false;
let liked = false;
let shuffleOn = false;
let repeatOn = false;

// Timing
let simTime = 0;       // simulated playback seconds
let lastSpawnAt = 0;   // timestamp of last word spawn
let lastRaf = 0;       // last requestAnimationFrame timestamp
let audioDuration = 0;
let audioStartTime = 0; // when audio was started (audioCtx.currentTime)
let pausedAt = 0;

// Audio
let audioCtx, analyserNode, gainNode, audioSrc, audioBuffer;
let rawAudioData = null; // ArrayBuffer preloaded from repo
let volumeLevel = 0.5;   // 0‥1 current

// ── Init ─────────────────────────────────────────────────
function init() {
  canvas = document.getElementById('physics-canvas');
  ctx = canvas.getContext('2d');

  setupCanvas();
  setupPhysics();
  setupEvents();
  preloadAudio(); // 백그라운드에서 음원 미리 로드

  requestAnimationFrame(tick);
}

function setupCanvas() {
  const wrap = document.getElementById('canvas-wrap');
  W = canvas.width = wrap.clientWidth;
  H = canvas.height = wrap.clientHeight;
}

function setupPhysics() {
  engine = Engine.create({ gravity: { y: CFG.gravity } });
  world = engine.world;
  rebuildWalls();
}

function rebuildWalls() {
  walls.forEach(w => World.remove(world, w));
  const t = 60;
  walls = [
    Bodies.rectangle(W / 2, H + t / 2, W + t * 2, t, { isStatic: true, label: 'wall', friction: 0.6 }),
    Bodies.rectangle(-t / 2, H / 2, t, H * 3, { isStatic: true, label: 'wall' }),
    Bodies.rectangle(W + t / 2, H / 2, t, H * 3, { isStatic: true, label: 'wall' }),
  ];
  World.add(world, walls);
}

// ── Events ───────────────────────────────────────────────
function setupEvents() {
  // Canvas click → explosion
  canvas.addEventListener('click', handleCanvasClick);
  canvas.addEventListener('touchend', e => {
    e.preventDefault();
    const t = e.changedTouches[0];
    const r = canvas.getBoundingClientRect();
    handleCanvasClick({ clientX: t.clientX, clientY: t.clientY, rect: r });
  });

  // Progress bar seek
  document.getElementById('progress-wrap').addEventListener('click', e => {
    if (!audioDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    seekTo(pct * audioDuration);
  });

  // Resize
  window.addEventListener('resize', () => {
    setupCanvas();
    rebuildWalls();
  });
}

// ── Audio ─────────────────────────────────────────────────
function ensureAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

// 레포에 번들된 음원을 백그라운드에서 ArrayBuffer로 미리 로드
async function preloadAudio() {
  try {
    const res = await fetch('assets/still-dre.mp3');
    if (!res.ok) throw new Error(res.status);
    rawAudioData = await res.arrayBuffer();
  } catch (e) {
    console.warn('Audio preload failed — simulation mode only:', e);
  }
}

function startAudio(fromTime = 0) {
  if (!audioBuffer) return;
  stopAudio();
  ensureAudioCtx();

  analyserNode = audioCtx.createAnalyser();
  analyserNode.fftSize = 512;
  analyserNode.smoothingTimeConstant = 0.75;

  gainNode = audioCtx.createGain();
  gainNode.gain.value = 1.0; // 기본 최대 볼륨

  audioSrc = audioCtx.createBufferSource();
  audioSrc.buffer = audioBuffer;
  audioSrc.connect(analyserNode);
  analyserNode.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  audioSrc.start(0, fromTime);

  audioStartTime = audioCtx.currentTime - fromTime;

  audioSrc.onended = () => {
    if (isPlaying) {
      if (repeatOn) {
        seekTo(0);
      } else {
        setPlaying(false);
      }
    }
  };
}

function stopAudio() {
  if (audioSrc) {
    try { audioSrc.stop(); } catch (_) {}
    audioSrc = null;
  }
}

function seekTo(sec) {
  pausedAt = sec;
  if (isPlaying) startAudio(sec);
  updateProgressUI(sec);
}

function getAudioTime() {
  if (!audioBuffer) return simTime;
  if (!audioCtx) return 0;
  return audioCtx.currentTime - audioStartTime;
}

// ── Volume reading ────────────────────────────────────────
function readVolume() {
  if (analyserNode) {
    const data = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteFrequencyData(data);
    const avg = data.slice(0, data.length / 2).reduce((s, v) => s + v, 0) / (data.length / 2);
    volumeLevel = avg / 200;
  } else {
    // Simulated volume: layered sine waves
    const t = simTime;
    const v = 0.35
      + 0.25 * Math.abs(Math.sin(t * 1.3))
      + 0.15 * Math.abs(Math.sin(t * 3.1))
      + 0.08 * Math.abs(Math.sin(t * 7.7))
      + 0.05 * (Math.random() - 0.5);
    volumeLevel = Math.max(0.08, Math.min(1, v));
  }
}

// ── Word spawning ─────────────────────────────────────────
function spawnWord(now) {
  const word = SAMPLE_LYRICS[lyricsIdx % SAMPLE_LYRICS.length];
  lyricsIdx++;

  const vol = volumeLevel;
  const fontSize = Math.round(CFG.minFont + vol * (CFG.maxFont - CFG.minFont));
  const color = CFG.colors[Math.floor(Math.random() * CFG.colors.length)];

  // Measure text
  ctx.font = `bold ${fontSize}px -apple-system, sans-serif`;
  const tw = ctx.measureText(word).width;
  const bw = tw + fontSize * 0.9;
  const bh = fontSize + 10;

  const x = Math.random() * (W - bw) + bw / 2;
  const y = -bh / 2 - 10;

  const body = Bodies.rectangle(x, y, bw, bh, {
    restitution: CFG.restitution,
    friction: CFG.friction,
    frictionAir: CFG.frictionAir,
    label: 'word',
    angle: (Math.random() - 0.5) * 0.3, // slight initial tilt
  });

  World.add(world, body);
  wordBodies.push({ body, word, fontSize, color, bw, bh, spawnTime: now, fading: false, opacity: 1 });
}

// ── Cleanup ───────────────────────────────────────────────
// 캔버스 안에 완전히 들어온 단어만 기준으로 파일 높이 측정
let lastCleanupAt = 0;

function checkCleanup(ts) {
  if (ts - lastCleanupAt < 600) return; // 600ms 간격으로만 체크
  lastCleanupAt = ts;

  // bounds.min.y > 0 → 단어 상단이 캔버스 안에 있는 것만 집계
  const inCanvas = wordBodies.filter(wb => !wb.fading && wb.body.bounds.min.y > 0);
  if (inCanvas.length < 4) return; // 충분히 쌓이기 전엔 정리하지 않음

  const pileTop = Math.min(...inCanvas.map(wb => wb.body.bounds.min.y));
  if (pileTop < H * CFG.cleanupRatio) {
    // 가장 오래된 단어(아직 fading 아닌 것)를 페이드 처리
    const oldest = wordBodies.find(wb => !wb.fading);
    if (oldest) oldest.fading = true;
  }
}

// ── Click explosion ───────────────────────────────────────
function handleCanvasClick(e) {
  const rect = e.rect || canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  // Find topmost body under cursor (check in reverse = top drawn last)
  let hit = -1;
  for (let i = wordBodies.length - 1; i >= 0; i--) {
    const { body } = wordBodies[i];
    if (pointInBody(mx, my, body)) {
      hit = i;
      break;
    }
  }

  if (hit < 0) return;

  const { body, color } = wordBodies[hit];
  const { x, y } = body.position;

  // Particle burst
  spawnParticles(x, y, color);

  // Apply radial impulse to neighbours
  wordBodies.forEach(({ body: b }, i) => {
    if (i === hit) return;
    const dx = b.position.x - x;
    const dy = b.position.y - y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < CFG.explosionRadius && dist > 1) {
      const str = CFG.explosionForce * (1 - dist / CFG.explosionRadius);
      Body.applyForce(b, b.position, {
        x: (dx / dist) * str,
        y: (dy / dist) * str - str * 0.4, // slight upward bias
      });
    }
  });

  // Remove clicked word immediately
  World.remove(world, body);
  wordBodies.splice(hit, 1);
}

// Precise rotated-rect point test
function pointInBody(px, py, body) {
  const { x, y } = body.position;
  const ang = body.angle;
  const dx = px - x;
  const dy = py - y;
  // Rotate point into body local space
  const lx = dx * Math.cos(-ang) - dy * Math.sin(-ang);
  const ly = dx * Math.sin(-ang) + dy * Math.cos(-ang);
  // Check against half-extents stored in bounds
  const hw = (body.bounds.max.x - body.bounds.min.x) / 2;
  const hh = (body.bounds.max.y - body.bounds.min.y) / 2;
  return Math.abs(lx) <= hw && Math.abs(ly) <= hh;
}

// ── Particles ─────────────────────────────────────────────
function spawnParticles(x, y, color) {
  for (let i = 0; i < 22; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 1.5 + Math.random() * 7;
    particles.push({
      x, y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 2,
      life: 1,
      color,
      size: 1.5 + Math.random() * 3.5,
    });
  }
}

function updateParticles() {
  particles = particles.filter(p => p.life > 0);
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.18;
    p.vx *= 0.96;
    p.vy *= 0.96;
    p.life -= CFG.fadeSpeed + 0.01;
  }
}

// ── Controls ──────────────────────────────────────────────
function togglePlay() {
  setPlaying(!isPlaying);
}

async function setPlaying(val) {
  isPlaying = val;
  document.getElementById('play-icon').style.display = val ? 'none' : '';
  document.getElementById('pause-icon').style.display = val ? '' : 'none';

  if (val) {
    document.getElementById('canvas-hint').classList.add('hidden');
    ensureAudioCtx();
    // AudioContext 생성 후 처음 재생 시 디코딩 (사용자 제스처 필요)
    if (!audioBuffer && rawAudioData) {
      try {
        audioBuffer = await audioCtx.decodeAudioData(rawAudioData.slice(0));
        audioDuration = audioBuffer.duration;
      } catch (e) {
        console.warn('Audio decode failed:', e);
      }
    }
    if (audioBuffer) startAudio(pausedAt);
  } else {
    if (audioCtx && audioBuffer) {
      pausedAt = getAudioTime();
      stopAudio();
    }
  }
}

function skipBack() {
  seekTo(0);
  if (!isPlaying) setPlaying(true);
}

function skipForward() {
  if (audioDuration) seekTo(Math.min(audioDuration, getAudioTime() + 10));
}

function toggleLike() {
  liked = !liked;
  const btn = document.getElementById('like-btn');
  btn.classList.toggle('liked', liked);
}

function toggleShuffle() {
  shuffleOn = !shuffleOn;
  document.getElementById('shuffle-btn').classList.toggle('active', shuffleOn);
}

function toggleRepeat() {
  repeatOn = !repeatOn;
  document.getElementById('repeat-btn').classList.toggle('active', repeatOn);
}

// ── Progress UI ───────────────────────────────────────────
function updateProgressUI(sec) {
  const dur = audioDuration;
  const pct = dur > 0 ? Math.min(1, Math.max(0, sec / dur)) * 100 : 0;
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-thumb').style.left = pct + '%';
  document.getElementById('current-time').textContent = formatTime(sec);
  document.getElementById('total-time').textContent =
    dur > 0 ? '-' + formatTime(Math.max(0, dur - sec)) : '-∞';
}

function formatTime(s) {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

function updateStatusTime() {
  const el = document.getElementById('status-time');
  if (!el) return;
  const now = new Date();
  el.textContent = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0');
}

// ── Rendering ─────────────────────────────────────────────

function renderWords() {
  for (let i = wordBodies.length - 1; i >= 0; i--) {
    const wb = wordBodies[i];
    const { body, word, fontSize, color, bw, bh, fading } = wb;

    // Fade out
    if (fading) {
      wb.opacity -= CFG.fadeSpeed;
      if (wb.opacity <= 0) {
        World.remove(world, body);
        wordBodies.splice(i, 1);
        continue;
      }
    }

    ctx.save();
    ctx.globalAlpha = wb.opacity;
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);

    // Pill background
    const r = bh * 0.38;
    ctx.beginPath();
    roundRectPath(ctx, -bw / 2, -bh / 2, bw, bh, r);
    ctx.fillStyle = color;
    ctx.fill();

    // Subtle inner glow
    ctx.beginPath();
    roundRectPath(ctx, -bw / 2, -bh / 2, bw, bh, r);
    const glow = ctx.createLinearGradient(0, -bh / 2, 0, bh / 2);
    glow.addColorStop(0, 'rgba(255,255,255,0.18)');
    glow.addColorStop(1, 'rgba(0,0,0,0.15)');
    ctx.fillStyle = glow;
    ctx.fill();

    // Text
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${fontSize}px -apple-system, "Helvetica Neue", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 3;
    ctx.fillText(word, 0, 1);
    ctx.shadowBlur = 0;

    ctx.restore();
  }
}

function renderParticles() {
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = p.life * 0.9;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = p.size * 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Main Loop ─────────────────────────────────────────────
function tick(ts) {
  const dt = Math.min(ts - lastRaf, 50);
  lastRaf = ts;

  if (isPlaying) {
    simTime += dt / 1000;
    readVolume();

    // Spawn words
    const spawnInterval = CFG.spawnMs * (0.6 + 0.8 * (1 - volumeLevel));
    if (ts - lastSpawnAt > spawnInterval) {
      spawnWord(ts);
      lastSpawnAt = ts;
    }

    // Cleanup check (pile height)
    checkCleanup(ts);

    // Physics step
    Engine.update(engine, dt);

    // Progress bar
    const t = audioBuffer ? getAudioTime() : simTime;
    updateProgressUI(t);
  }

  // Clear
  ctx.clearRect(0, 0, W, H);

  // Update & draw particles
  updateParticles();
  renderParticles();

  // Draw words (updates fading too)
  renderWords();

  requestAnimationFrame(tick);
}

// ── Start ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', init);

// Expose controls to HTML onclick
window.togglePlay = togglePlay;
window.toggleLike = toggleLike;
window.toggleShuffle = toggleShuffle;
window.toggleRepeat = toggleRepeat;
window.skipBack = skipBack;
window.skipForward = skipForward;
