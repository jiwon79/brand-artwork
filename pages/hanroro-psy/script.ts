type Row = 'row-gangnam' | 'row-fart' | 'row-hanroro';

const SAMPLE_URLS: Record<string, string> = {
  gangnam: new URL('./assets/gangnam.mp3', import.meta.url).href,
  ingan: new URL('./assets/ingan.mp3', import.meta.url).href,
  yeoja: new URL('./assets/yeoja.mp3', import.meta.url).href,
  ssanai: new URL('./assets/ssanai.mp3', import.meta.url).href,
  op: new URL('./assets/op.mp3', import.meta.url).href,
  wanjeon: new URL('./assets/wanjeon.mp3', import.meta.url).href,
  ultungbultung: new URL('./assets/ultungbultung.mp3', import.meta.url).href,
  eo: new URL('./assets/eo.mp3', import.meta.url).href,
  ehy: new URL('./assets/ehy.mp3', import.meta.url).href,
  damngirl: new URL('./assets/damngirl.mp3', import.meta.url).href,
  najeneun: new URL('./assets/najeneun.mp3', import.meta.url).href,
  meori: new URL('./assets/meori.mp3', import.meta.url).href,
};

const ROW_COLORS: Record<Row, string> = {
  'row-gangnam': '#ff2e93',
  'row-fart': '#00f0ff',
  'row-hanroro': '#f4a872',
};
const ROW_PARTICLES: Record<Row, string[]> = {
  'row-gangnam': ['옵', '★', '!'],
  'row-fart': ['💨', '~', '·'],
  'row-hanroro': ['♪', '°', '·'],
};

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let dryGain: GainNode | null = null;
let wetGain: GainNode | null = null;
let filterOn = false;

function initAudio() {
  if (audioCtx) return;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  audioCtx = new Ctor();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.7;
  dryGain = audioCtx.createGain();
  wetGain = audioCtx.createGain();
  wetGain.gain.value = 0;
  const convolver = audioCtx.createConvolver();
  convolver.buffer = makeImpulseResponse(2.0, 2.5);
  dryGain.connect(masterGain);
  wetGain.connect(convolver);
  convolver.connect(masterGain);
  masterGain.connect(audioCtx.destination);
}

function makeImpulseResponse(duration: number, decay: number): AudioBuffer {
  const ctx = audioCtx!;
  const len = ctx.sampleRate * duration;
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return ir;
}

function applyFXChain(srcNode: AudioNode) {
  if (filterOn) {
    const f = audioCtx!.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 600;
    f.Q.value = 4;
    srcNode.connect(f);
    f.connect(dryGain!);
    f.connect(wetGain!);
  } else {
    srcNode.connect(dryGain!);
    srcNode.connect(wetGain!);
  }
}

function setEchoLevel(level: number) {
  if (!wetGain || !audioCtx) return;
  wetGain.gain.cancelScheduledValues(audioCtx.currentTime);
  wetGain.gain.linearRampToValueAtTime(level, audioCtx.currentTime + 0.1);
}

const sampleBuffers = new Map<string, AudioBuffer>();
const samplePending = new Map<string, Promise<AudioBuffer>>();

async function loadSample(name: string): Promise<AudioBuffer> {
  const cached = sampleBuffers.get(name);
  if (cached) return cached;
  const pending = samplePending.get(name);
  if (pending) return pending;
  const p = fetch(SAMPLE_URLS[name])
    .then((r) => r.arrayBuffer())
    .then((buf) => audioCtx!.decodeAudioData(buf))
    .then((decoded) => {
      sampleBuffers.set(name, decoded);
      samplePending.delete(name);
      return decoded;
    });
  samplePending.set(name, p);
  return p;
}

let lastSample: string | null = null;

function playSample(name: string) {
  lastSample = name;
  const buffer = sampleBuffers.get(name);
  if (!buffer) {
    loadSample(name).then(() => playSample(name));
    return;
  }
  const src = audioCtx!.createBufferSource();
  src.buffer = buffer;
  const gain = audioCtx!.createGain();
  src.connect(gain);
  applyFXChain(gain);
  src.start();
}

function playScratchTick() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const dur = 0.06;
  const bufSize = audioCtx.sampleRate * dur;
  const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1500 + Math.random() * 1500;
  filter.Q.value = 5;
  const gain = audioCtx.createGain();
  gain.gain.value = 0.15;
  src.connect(filter);
  filter.connect(gain);
  applyFXChain(gain);
  src.start(t);
  src.stop(t + dur);
}

const lp = document.getElementById('lp') as HTMLDivElement;
const labelText = document.getElementById('labelText') as HTMLDivElement;
const tonearm = document.getElementById('tonearm') as HTMLDivElement;
const scratchCanvas = document.getElementById('scratchCanvas') as HTMLCanvasElement;

let glitchLevel = 0;
function updateLP() {
  const g = glitchLevel;
  lp.style.animationDuration = `${3.6 - g * 2.4}s`;
  lp.classList.toggle('glitch', g > 0.3);
  lp.style.setProperty('--glitch-hue', `${g * 320}deg`);
  lp.style.setProperty('--glitch-sat', `${1 + g * 0.8}`);
  if (g < 0.25) labelText.textContent = '0+0';
  else if (g < 0.5) labelText.textContent = '옵+옵';
  else if (g < 0.75) labelText.textContent = '∞+∞';
  else labelText.textContent = 'OP+OP';
}
function shiftGlitch(delta: number) {
  glitchLevel = Math.max(0, Math.min(1, glitchLevel + delta));
  updateLP();
}

let ctx2d: CanvasRenderingContext2D | null = null;
let fadeTimer: number | null = null;

function setupScratchCanvas() {
  const r = lp.getBoundingClientRect();
  scratchCanvas.width = r.width * 2;
  scratchCanvas.height = r.height * 2;
  ctx2d = scratchCanvas.getContext('2d');
  ctx2d?.scale(2, 2);
}
function addScratch(x: number, y: number, color: string) {
  if (!ctx2d) return;
  const r = scratchCanvas.getBoundingClientRect();
  const cx = r.width / 2;
  const cy = r.height / 2;
  const localX = x - r.left;
  const localY = y - r.top;
  const angle = Math.atan2(localY - cy, localX - cx);
  ctx2d.save();
  ctx2d.strokeStyle = color;
  ctx2d.lineWidth = 1.2;
  ctx2d.globalAlpha = 0.6;
  ctx2d.beginPath();
  ctx2d.arc(cx, cy, Math.hypot(localX - cx, localY - cy), angle - 0.1, angle + 0.1);
  ctx2d.stroke();
  ctx2d.restore();
  startScratchFade();
}
function startScratchFade() {
  if (fadeTimer !== null) return;
  fadeTimer = window.setInterval(() => {
    if (!ctx2d) return;
    ctx2d.globalCompositeOperation = 'destination-out';
    ctx2d.fillStyle = 'rgba(0,0,0,0.02)';
    ctx2d.fillRect(0, 0, scratchCanvas.width, scratchCanvas.height);
    ctx2d.globalCompositeOperation = 'source-over';
  }, 100);
}

function emitRay(fromX: number, fromY: number, color: string) {
  const lpRect = lp.getBoundingClientRect();
  const toX = lpRect.left + lpRect.width / 2;
  const toY = lpRect.top + lpRect.height / 2;
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const ray = document.createElement('div');
  ray.className = 'ray';
  ray.style.left = `${fromX}px`;
  ray.style.top = `${fromY}px`;
  ray.style.width = `${len}px`;
  ray.style.transform = `rotate(${angle}deg)`;
  ray.style.background = `linear-gradient(90deg, ${color}, transparent)`;
  ray.style.boxShadow = `0 0 8px ${color}`;
  document.body.appendChild(ray);
  setTimeout(() => ray.remove(), 600);
  addScratch(
    toX + (Math.random() - 0.5) * lpRect.width * 0.6,
    toY + (Math.random() - 0.5) * lpRect.height * 0.6,
    color
  );
}

function emitParticle(x: number, y: number, text: string, color: string) {
  const p = document.createElement('div');
  p.className = 'particle';
  p.textContent = text;
  p.style.left = `${x}px`;
  p.style.top = `${y}px`;
  p.style.color = color;
  document.body.appendChild(p);
  const angle = Math.random() * Math.PI * 2;
  const dist = 40 + Math.random() * 60;
  const dx = Math.cos(angle) * dist;
  const dy = Math.sin(angle) * dist - 30;
  p.animate(
    [
      { transform: 'translate(0,0) rotate(0) scale(1)', opacity: 1 },
      {
        transform: `translate(${dx}px, ${dy}px) rotate(${(Math.random() - 0.5) * 180}deg) scale(0.5)`,
        opacity: 0,
      },
    ],
    { duration: 800, easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)' }
  );
  setTimeout(() => p.remove(), 800);
}

function getRow(pad: Element): Row {
  for (const r of Object.keys(ROW_COLORS) as Row[]) {
    if (pad.classList.contains(r)) return r;
  }
  return 'row-hanroro';
}

let started = false;
function startApp() {
  if (started) return;
  started = true;
  initAudio();
  if (audioCtx!.state === 'suspended') audioCtx!.resume();
  Object.keys(SAMPLE_URLS).forEach(loadSample);
  setupScratchCanvas();
  tonearm.classList.add('playing');
}

document.querySelectorAll<HTMLButtonElement>('.pad').forEach((pad) => {
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!started) {
      startApp();
      return;
    }
    const sound = pad.dataset.sound;
    if (sound && SAMPLE_URLS[sound]) playSample(sound);
    pad.classList.add('active');
    setTimeout(() => pad.classList.remove('active'), 120);

    const row = getRow(pad);
    const rect = pad.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const color = ROW_COLORS[row];
    emitRay(cx, cy, color);
    const pTexts = ROW_PARTICLES[row];
    for (let i = 0; i < 3; i++) {
      emitParticle(cx, cy, pTexts[Math.floor(Math.random() * pTexts.length)], color);
    }
    shiftGlitch(row === 'row-hanroro' ? -0.05 : 0.08);
  });
});

let loopInterval: number | null = null;
document.querySelectorAll<HTMLButtonElement>('.fx-btn').forEach((btn) => {
  const onDown = (e: PointerEvent) => {
    e.preventDefault();
    if (!started) {
      startApp();
      return;
    }
    const f = btn.dataset.fx;
    btn.classList.add('held');
    if (f === 'echo') setEchoLevel(0.55);
    else if (f === 'filter') filterOn = true;
    else if (f === 'reverse') {
      lp.style.animationDirection = 'reverse';
      tonearm.style.transform = 'rotate(28deg)';
    } else if (f === 'loop') {
      const replay = () => {
        if (lastSample) playSample(lastSample);
      };
      replay();
      loopInterval = window.setInterval(replay, 1300);
    }
  };
  const onUp = (e: PointerEvent) => {
    e.preventDefault();
    const f = btn.dataset.fx;
    btn.classList.remove('held');
    if (f === 'echo') setEchoLevel(0);
    else if (f === 'filter') filterOn = false;
    else if (f === 'reverse') {
      lp.style.animationDirection = 'normal';
      tonearm.style.transform = '';
    } else if (f === 'loop') {
      if (loopInterval !== null) {
        clearInterval(loopInterval);
        loopInterval = null;
      }
    }
  };
  btn.addEventListener('pointerdown', onDown);
  btn.addEventListener('pointerup', onUp);
  btn.addEventListener('pointerleave', onUp);
  btn.addEventListener('pointercancel', onUp);
});

let lpPressTimer: number | null = null;
let lpDragging = false;
let lastDragTime = 0;
lp.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (!started) {
    startApp();
    return;
  }
  lpDragging = true;
  lpPressTimer = window.setTimeout(() => {
    glitchLevel = 0;
    updateLP();
    if (ctx2d) ctx2d.clearRect(0, 0, scratchCanvas.width, scratchCanvas.height);
  }, 700);
});
lp.addEventListener('pointermove', (e) => {
  if (!lpDragging) return;
  if (lpPressTimer !== null) {
    clearTimeout(lpPressTimer);
    lpPressTimer = null;
  }
  const now = performance.now();
  if (now - lastDragTime < 60) return;
  lastDragTime = now;
  playScratchTick();
  addScratch(e.clientX, e.clientY, '#ffffff');
});
const releaseLp = () => {
  lpDragging = false;
  if (lpPressTimer !== null) {
    clearTimeout(lpPressTimer);
    lpPressTimer = null;
  }
};
lp.addEventListener('pointerup', releaseLp);
lp.addEventListener('pointerleave', releaseLp);
lp.addEventListener('pointercancel', releaseLp);

window.addEventListener('resize', () => {
  if (started) setupScratchCanvas();
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
