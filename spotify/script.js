/* =========================================================
   Lyrics Rain — Spotify Player
   Physics: Matter.js rigid body simulation
   ========================================================= */

const { Engine, Bodies, Body, World, Events, Composite } = Matter;

// ── Config ──────────────────────────────────────────────
const CANVAS_PAD = 24; // horizontal padding matching bottom section

const CFG = {
  minFont: 7,
  maxFont: 23,
  gravity: 1.0,
  restitution: 0.28,
  friction: 0.65,
  frictionAir: 0.018,
  explosionForce: 0.0275,
  explosionRadius: 190,
  fadeSpeed: 0.04,
  colors: [
    '#1DB954', // Spotify green
    '#FF1744', // vivid red
    '#D500F9', // vivid purple
    '#2979FF', // vivid blue
    '#FF6D00', // vivid orange
    '#76FF03', // vivid lime
    '#FF4081', // vivid pink
    '#651FFF', // vivid indigo
    '#E040FB', // vivid magenta
    '#F4511E', // vivid deep orange
  ],
};

// ── Song data (loaded at runtime) ───────────────────────
let currentSong = null;  // { id, title, artist, audioFile, lyrics: [{start, end, word}] }
let lyricsQueue = [];    // copy of lyrics sorted by start time, consumed as song plays
let lyricsIdx = 0;       // index into lyricsQueue for timing-based spawn
let fallbackWords = [];  // words extracted from lyrics for fallback (no-timing) mode
let fallbackIdx = 0;

let allSongs = [];
let currentSongIndex = 0;

async function switchSong() {
  const wasPlaying = isPlaying;
  if (wasPlaying) {
    pausedAt = 0;
    stopAudio();
    isPlaying = false;
    document.getElementById('play-icon').style.display = '';
    document.getElementById('pause-icon').style.display = 'none';
  }

  // Clear current words
  wordBodies.forEach(wb => World.remove(world, wb.body));
  wordBodies = [];
  particles = [];

  currentSongIndex = (currentSongIndex + 1) % allSongs.length;
  await loadSong(allSongs[currentSongIndex].id);

  if (wasPlaying) {
    setPlaying(true);
  }
}

async function loadSong(songId) {
  const meta = allSongs.find(s => s.id === songId) || allSongs[0];

  // Load lyrics JSON
  const lyricsRes = await fetch(meta.lyricsFile);
  const songData = await lyricsRes.json();

  currentSong = {
    ...meta,
    lyrics: songData.lyrics,
  };

  lyricsQueue = [...currentSong.lyrics];
  lyricsIdx = 0;
  fallbackWords = currentSong.lyrics.map(l => l.word);
  fallbackIdx = 0;

  // Update UI
  document.getElementById('song-title').textContent = currentSong.title;
  document.getElementById('artist-name').textContent = currentSong.artist;

  // Update audio source
  audioEl.src = currentSong.audioFile;
  audioEl.load();
}

// ── State ────────────────────────────────────────────────
let engine, world;
let canvas, ctx, W, H;
let walls = [];

let wordBodies = [];   // { body, word, fontSize, color, bw, bh, spawnTime, fading, opacity }
let particles = [];    // explosion particles
let isPlaying = false;
let liked = false;
let shuffleOn = false;
let repeatOn = false;

// Timing
let simTime = 0;       // simulated playback seconds
let lastRaf = 0;       // last requestAnimationFrame timestamp
let audioDuration = 0;
let pausedAt = 0;

// Last timing-spawn check
let lastTimingSpawnAt = -999;  // last audio time we checked for a word to spawn

// Fallback spawn (when no timing match)
let lastFallbackSpawnAt = 0;
const FALLBACK_SPAWN_MS = 1400;

// Audio
let audioCtx, analyserNode, gainNode, mediaSource;
let audioEl = null;
let volumeLevel = 0.5;

// ── Init ─────────────────────────────────────────────────
async function init() {
  canvas = document.getElementById('physics-canvas');
  ctx = canvas.getContext('2d');

  setupCanvas();
  setupPhysics();
  setupAudio();
  setupEvents();

  // Load songs list then default song
  const songsRes = await fetch('assets/songs.json');
  allSongs = await songsRes.json();
  currentSongIndex = 0;
  await loadSong(allSongs[0].id);

  requestAnimationFrame(tick);
}

function setupCanvas() {
  const wrap = document.getElementById('canvas-wrap');
  const dpr = window.devicePixelRatio || 1;
  W = wrap.clientWidth;
  H = wrap.clientHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    Bodies.rectangle(CANVAS_PAD - t / 2, H / 2, t, H * 3, { isStatic: true, label: 'wall' }),
    Bodies.rectangle(W - CANVAS_PAD + t / 2, H / 2, t, H * 3, { isStatic: true, label: 'wall' }),
  ];
  World.add(world, walls);
}

// ── Events ───────────────────────────────────────────────
function setupEvents() {
  canvas.addEventListener('click', handleCanvasClick);
  canvas.addEventListener('touchend', e => {
    e.preventDefault();
    const t = e.changedTouches[0];
    const r = canvas.getBoundingClientRect();
    handleCanvasClick({ clientX: t.clientX, clientY: t.clientY, rect: r });
  });

  document.getElementById('progress-wrap').addEventListener('click', e => {
    if (!audioDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    seekTo(pct * audioDuration);
  });

  window.addEventListener('resize', () => {
    setupCanvas();
    rebuildWalls();
  });
}

// ── Audio ─────────────────────────────────────────────────
function setupAudio() {
  audioEl = document.getElementById('audio-player');

  audioEl.addEventListener('loadedmetadata', () => {
    audioDuration = audioEl.duration;
    updateProgressUI(0);
  });

  audioEl.addEventListener('ended', () => {
    if (repeatOn) {
      seekTo(0);
      audioEl.play();
    } else {
      setPlaying(false);
    }
  });
}

function ensureAudioCtx() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  mediaSource = audioCtx.createMediaElementSource(audioEl);
  analyserNode = audioCtx.createAnalyser();
  analyserNode.fftSize = 512;
  analyserNode.smoothingTimeConstant = 0.75;
  gainNode = audioCtx.createGain();
  gainNode.gain.value = 1.0;
  mediaSource.connect(analyserNode);
  analyserNode.connect(gainNode);
  gainNode.connect(audioCtx.destination);
}

function startAudio(fromTime = 0) {
  if (!audioEl) return;
  audioEl.currentTime = fromTime;
  audioEl.play().catch(e => console.warn('play() failed:', e));
}

function stopAudio() {
  if (audioEl) audioEl.pause();
}

function seekTo(sec) {
  pausedAt = sec;
  if (audioEl) audioEl.currentTime = sec;
  if (isPlaying && audioEl) audioEl.play().catch(() => {});

  // Reset lyrics index to match new position
  if (currentSong) {
    lyricsIdx = currentSong.lyrics.findIndex(l => l.start >= sec);
    if (lyricsIdx < 0) lyricsIdx = currentSong.lyrics.length;
    lastTimingSpawnAt = sec - 0.1;
  }

  updateProgressUI(sec);
}

function getAudioTime() {
  if (audioEl && !isNaN(audioEl.duration)) return audioEl.currentTime;
  return simTime;
}

// ── Volume reading ────────────────────────────────────────
function readVolume() {
  if (analyserNode) {
    const data = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteFrequencyData(data);
    const avg = data.slice(0, data.length / 2).reduce((s, v) => s + v, 0) / (data.length / 2);
    volumeLevel = avg / 200;
  } else {
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
function spawnWordText(word) {
  const vol = volumeLevel;
  const fontSize = Math.round(CFG.minFont + vol * (CFG.maxFont - CFG.minFont));
  const color = CFG.colors[Math.floor(Math.random() * CFG.colors.length)];

  ctx.font = `bold ${fontSize}px "Malgun Gothic", "Apple Gothic", "NanumGothic", sans-serif`;
  const tw = ctx.measureText(word).width;
  const bw = tw + fontSize * 0.9;
  const bh = fontSize + 10;

  const minX = CANVAS_PAD + bw / 2;
  const maxX = W - CANVAS_PAD - bw / 2;
  const x = minX + Math.random() * Math.max(0, maxX - minX);
  const y = bh / 2 + Math.random() * bh;

  const body = Bodies.rectangle(x, y, bw, bh, {
    restitution: CFG.restitution,
    friction: CFG.friction,
    frictionAir: CFG.frictionAir,
    label: 'word',
    angle: (Math.random() - 0.5) * 0.3,
  });

  World.add(world, body);
  wordBodies.push({ body, word, fontSize, color, bw, bh, fading: false, opacity: 1 });
}

// Timing-based: spawn all words whose start time has passed
function spawnTimingWords(now, audioTime) {
  if (!currentSong || lyricsIdx >= currentSong.lyrics.length) return;

  while (lyricsIdx < currentSong.lyrics.length) {
    const entry = currentSong.lyrics[lyricsIdx];
    if (audioTime >= entry.start) {
      spawnWordText(entry.word);
      lyricsIdx++;
    } else {
      break;
    }
  }
}

// Fallback: spawn words at fixed intervals (for silent periods or when song not loaded)
function spawnFallbackWord(now) {
  if (!fallbackWords.length) return;
  const word = fallbackWords[fallbackIdx % fallbackWords.length];
  fallbackIdx++;
  spawnWordText(word);
}

// ── Cleanup ───────────────────────────────────────────────
let lastCleanupAt = 0;

function checkCleanup(ts) {
  if (ts - lastCleanupAt < 300) return;
  lastCleanupAt = ts;

  const active = wordBodies.filter(wb => !wb.fading);
  const totalArea = active.reduce((sum, wb) => sum + wb.bw * wb.bh, 0);
  if (totalArea > W * H / 3 && active.length > 0) {
    active[0].fading = true;
  }
}

// ── Click explosion ───────────────────────────────────────
function handleCanvasClick(e) {
  const rect = e.rect || canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

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

  spawnParticles(x, y, color);

  wordBodies.forEach(({ body: b }, i) => {
    if (i === hit) return;
    const dx = b.position.x - x;
    const dy = b.position.y - y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < CFG.explosionRadius && dist > 1) {
      const str = CFG.explosionForce * (1 - dist / CFG.explosionRadius);
      Body.applyForce(b, b.position, {
        x: (dx / dist) * str,
        y: (dy / dist) * str - str * 0.4,
      });
    }
  });

  World.remove(world, body);
  wordBodies.splice(hit, 1);
}

function pointInBody(px, py, body) {
  const { x, y } = body.position;
  const ang = body.angle;
  const dx = px - x;
  const dy = py - y;
  const lx = dx * Math.cos(-ang) - dy * Math.sin(-ang);
  const ly = dx * Math.sin(-ang) + dy * Math.cos(-ang);
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
    await audioCtx.resume();
    startAudio(pausedAt);
  } else {
    pausedAt = getAudioTime();
    stopAudio();
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
    dur > 0 ? '-' + formatTime(Math.max(0, dur - sec)) : '--:--';
}

function formatTime(s) {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

// ── Rendering ─────────────────────────────────────────────
function renderWords() {
  for (let i = wordBodies.length - 1; i >= 0; i--) {
    const wb = wordBodies[i];
    const { body, word, fontSize, color, bw, bh, fading } = wb;

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

    ctx.beginPath();
    ctx.rect(-bw / 2, -bh / 2, bw, bh);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = `bold ${fontSize}px "Malgun Gothic", "Apple Gothic", "NanumGothic", sans-serif`;
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

    const audioTime = getAudioTime();

    // Timing-based spawn: spawn words that match current audio time
    spawnTimingWords(ts, audioTime);

    // Cleanup check
    checkCleanup(ts);

    // Physics step
    Engine.update(engine, dt);

    // Progress bar
    updateProgressUI(audioTime);
  }

  ctx.clearRect(0, 0, W, H);

  updateParticles();
  renderParticles();
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
window.switchSong = switchSong;
