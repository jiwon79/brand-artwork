type Row = 'row-gangnam' | 'row-fart' | 'row-hanroro';

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let convolver: ConvolverNode | null = null;
let dryGain: GainNode | null = null;
let wetGain: GainNode | null = null;

function initAudio() {
  if (audioCtx) return;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  audioCtx = new Ctor();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.7;
  dryGain = audioCtx.createGain();
  wetGain = audioCtx.createGain();
  wetGain.gain.value = 0;
  convolver = audioCtx.createConvolver();
  convolver.buffer = makeImpulseResponse(2.0, 2.5);
  dryGain.connect(masterGain);
  wetGain.connect(convolver);
  convolver.connect(masterGain);
  masterGain.connect(audioCtx.destination);
}

function makeImpulseResponse(duration: number, decay: number): AudioBuffer {
  const ctx = audioCtx!;
  const rate = ctx.sampleRate;
  const len = rate * duration;
  const ir = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return ir;
}

const fx = { filter: false, echo: false, reverse: false, loop: false };

function applyFXChain(srcNode: AudioNode) {
  if (fx.filter) {
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

const SAMPLE_URLS: Record<string, string> = {
  gangnam: new URL('./assets/gangnam.mp3', import.meta.url).href,
  ingan: new URL('./assets/ingan.mp3', import.meta.url).href,
  yeoja: new URL('./assets/yeoja.mp3', import.meta.url).href,
  ssanai: new URL('./assets/ssanai.mp3', import.meta.url).href,
  op: new URL('./assets/op.mp3', import.meta.url).href,
  wanjeon: new URL('./assets/wanjeon.mp3', import.meta.url).href,
};
const sampleBuffers = new Map<string, AudioBuffer>();
const samplePending = new Map<string, Promise<AudioBuffer>>();

async function loadSample(name: string): Promise<AudioBuffer> {
  const cached = sampleBuffers.get(name);
  if (cached) return cached;
  const pending = samplePending.get(name);
  if (pending) return pending;
  const url = SAMPLE_URLS[name];
  const p = fetch(url)
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

function playSample(name: string) {
  const buffer = sampleBuffers.get(name);
  if (!buffer) {
    loadSample(name).then(() => playSample(name));
    return;
  }
  const src = audioCtx!.createBufferSource();
  src.buffer = buffer;
  const gain = audioCtx!.createGain();
  gain.gain.value = 1;
  src.connect(gain);
  applyFXChain(gain);
  src.start();
}

function playEhy() {
  const t = audioCtx!.currentTime;
  const osc = audioCtx!.createOscillator();
  const gain = audioCtx!.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(220, t);
  osc.frequency.linearRampToValueAtTime(330, t + 0.4);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.35, t + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
  osc.connect(gain);
  applyFXChain(gain);
  osc.start(t);
  osc.stop(t + 0.55);
}

function playSexy() {
  const t = audioCtx!.currentTime;
  [0, 0.12, 0.24].forEach((d, i) => {
    const osc = audioCtx!.createOscillator();
    const gain = audioCtx!.createGain();
    osc.type = 'triangle';
    osc.frequency.value = [440, 392, 349][i];
    gain.gain.setValueAtTime(0, t + d);
    gain.gain.linearRampToValueAtTime(0.3, t + d + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.01, t + d + 0.1);
    osc.connect(gain);
    applyFXChain(gain);
    osc.start(t + d);
    osc.stop(t + d + 0.12);
  });
}

function playDamn() {
  const t = audioCtx!.currentTime;
  const osc = audioCtx!.createOscillator();
  const gain = audioCtx!.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, t);
  osc.frequency.exponentialRampToValueAtTime(60, t + 0.15);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.7, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.01, t + 0.25);
  osc.connect(gain);
  applyFXChain(gain);
  osc.start(t);
  osc.stop(t + 0.3);
}

function playFart(long = false) {
  const t = audioCtx!.currentTime;
  const dur = long ? 0.6 : 0.25;
  const bufferSize = audioCtx!.sampleRate * dur;
  const buffer = audioCtx!.createBuffer(1, bufferSize, audioCtx!.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const src = audioCtx!.createBufferSource();
  src.buffer = buffer;
  const filter = audioCtx!.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(400, t);
  filter.frequency.linearRampToValueAtTime(80, t + dur);
  filter.Q.value = 8;
  const gain = audioCtx!.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.5, t + 0.02);
  gain.gain.linearRampToValueAtTime(long ? 0.6 : 0.4, t + dur * 0.5);
  gain.gain.exponentialRampToValueAtTime(0.01, t + dur);
  const lfo = audioCtx!.createOscillator();
  const lfoGain = audioCtx!.createGain();
  lfo.frequency.value = long ? 8 : 18;
  lfoGain.gain.value = 80;
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);
  src.connect(filter);
  filter.connect(gain);
  applyFXChain(gain);
  src.start(t);
  src.stop(t + dur);
  lfo.start(t);
  lfo.stop(t + dur);
}

function playSanae() {
  const t = audioCtx!.currentTime;
  const notes = [392, 440, 523];
  notes.forEach((f, i) => {
    const osc = audioCtx!.createOscillator();
    const gain = audioCtx!.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    const d = i * 0.08;
    gain.gain.setValueAtTime(0, t + d);
    gain.gain.linearRampToValueAtTime(0.25, t + d + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.01, t + d + 0.15);
    osc.connect(gain);
    applyFXChain(gain);
    osc.start(t + d);
    osc.stop(t + d + 0.18);
  });
}

function playOppa() {
  const t = audioCtx!.currentTime;
  for (let i = 0; i < 4; i++) {
    const osc = audioCtx!.createOscillator();
    const gain = audioCtx!.createGain();
    osc.type = 'square';
    osc.frequency.value = 200 + i * 40;
    const d = i * 0.06;
    gain.gain.setValueAtTime(0, t + d);
    gain.gain.linearRampToValueAtTime(0.3, t + d + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.01, t + d + 0.06);
    osc.connect(gain);
    applyFXChain(gain);
    osc.start(t + d);
    osc.stop(t + d + 0.07);
  }
}

function playZero() {
  const t = audioCtx!.currentTime;
  const notes = [261.63, 329.63, 392.0, 523.25];
  notes.forEach((f) => {
    const osc = audioCtx!.createOscillator();
    const gain = audioCtx!.createGain();
    osc.type = 'triangle';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.15, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 1.2);
    osc.connect(gain);
    applyFXChain(gain);
    osc.start(t);
    osc.stop(t + 1.3);
  });
}

function playGuitar() {
  const t = audioCtx!.currentTime;
  const notes = [196, 246.94, 293.66, 392, 493.88];
  notes.forEach((f, i) => {
    const d = i * 0.025;
    const bufferSize = audioCtx!.sampleRate * 0.05;
    const buffer = audioCtx!.createBuffer(1, bufferSize, audioCtx!.sampleRate);
    const data = buffer.getChannelData(0);
    for (let j = 0; j < bufferSize; j++) data[j] = Math.random() * 2 - 1;
    const src = audioCtx!.createBufferSource();
    src.buffer = buffer;
    const filter = audioCtx!.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = f;
    filter.Q.value = 30;
    const gain = audioCtx!.createGain();
    gain.gain.setValueAtTime(0, t + d);
    gain.gain.linearRampToValueAtTime(0.5, t + d + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.01, t + d + 1.5);
    src.connect(filter);
    filter.connect(gain);
    applyFXChain(gain);
    src.start(t + d);
    src.stop(t + d + 1.6);
  });
}

function playSigh() {
  const t = audioCtx!.currentTime;
  const dur = 0.8;
  const bufferSize = audioCtx!.sampleRate * dur;
  const buffer = audioCtx!.createBuffer(1, bufferSize, audioCtx!.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const src = audioCtx!.createBufferSource();
  src.buffer = buffer;
  const filter = audioCtx!.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(800, t);
  filter.frequency.linearRampToValueAtTime(300, t + dur);
  filter.Q.value = 2;
  const gain = audioCtx!.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.15, t + 0.1);
  gain.gain.linearRampToValueAtTime(0.08, t + 0.4);
  gain.gain.exponentialRampToValueAtTime(0.01, t + dur);
  src.connect(filter);
  filter.connect(gain);
  applyFXChain(gain);
  src.start(t);
  src.stop(t + dur);
}

function playLove() {
  const t = audioCtx!.currentTime;
  const notes = [440, 523.25, 587.33, 523.25];
  notes.forEach((f, i) => {
    const osc = audioCtx!.createOscillator();
    const gain = audioCtx!.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    const d = i * 0.15;
    gain.gain.setValueAtTime(0, t + d);
    gain.gain.linearRampToValueAtTime(0.2, t + d + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, t + d + 0.4);
    osc.connect(gain);
    applyFXChain(gain);
    osc.start(t + d);
    osc.stop(t + d + 0.45);
  });
}

const SOUND_MAP: Record<string, () => void> = {
  gangnam: () => playSample('gangnam'),
  ingan: () => playSample('ingan'),
  yeoja: () => playSample('yeoja'),
  ssanai: () => playSample('ssanai'),
  op: () => playSample('op'),
  wanjeon: () => playSample('wanjeon'),
  sanae: playSanae,
  oppa: playOppa,
  zero: playZero,
  guitar: playGuitar,
  sigh: playSigh,
  love: playLove,
};

const lp = document.getElementById('lp') as HTMLDivElement;
const labelText = document.getElementById('labelText') as HTMLDivElement;
const tonearm = document.getElementById('tonearm') as HTMLDivElement;
const scratchCanvas = document.getElementById('scratchCanvas') as HTMLCanvasElement;

let glitchLevel = 0;
function updateLP() {
  const g = glitchLevel;
  lp.style.animationDuration = `${3.6 - g * 2.4}s`;
  if (g > 0.3) lp.classList.add('glitch');
  else lp.classList.remove('glitch');
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
  setTimeout(() => fadeScratch(), 50);
}
let fadeTimer: number | null = null;
function fadeScratch() {
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
  Object.keys(SAMPLE_URLS).forEach((name) => loadSample(name));
  setupScratchCanvas();
  tonearm.classList.add('playing');
  setTimeout(() => playZero(), 300);
}

document.querySelectorAll<HTMLButtonElement>('.pad').forEach((pad) => {
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!started) {
      startApp();
      return;
    }
    const sound = pad.dataset.sound;
    const fn = sound ? SOUND_MAP[sound] : undefined;
    if (fn) fn();
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
    if (row === 'row-gangnam' || row === 'row-fart') shiftGlitch(0.08);
    else shiftGlitch(-0.05);
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
    if (f === 'echo') {
      fx.echo = true;
      setEchoLevel(0.55);
    } else if (f === 'filter') {
      fx.filter = true;
    } else if (f === 'reverse') {
      fx.reverse = true;
      lp.style.animationDirection = 'reverse';
      tonearm.style.transform = 'rotate(28deg)';
    } else if (f === 'loop') {
      fx.loop = true;
      loopInterval = window.setInterval(() => playZero(), 1300);
    }
  };
  const onUp = (e: PointerEvent) => {
    e.preventDefault();
    const f = btn.dataset.fx;
    btn.classList.remove('held');
    if (f === 'echo') {
      fx.echo = false;
      setEchoLevel(0);
    } else if (f === 'filter') {
      fx.filter = false;
    } else if (f === 'reverse') {
      fx.reverse = false;
      lp.style.animationDirection = 'normal';
      if (started) tonearm.style.transform = '';
    } else if (f === 'loop') {
      fx.loop = false;
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
  if (audioCtx) {
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
