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

const BGM_URL = new URL('./assets/bgm.mp3', import.meta.url).href;

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;

function initAudio() {
  if (audioCtx) return;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  audioCtx = new Ctor();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 1.7;
  const limiter = audioCtx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.08;
  masterGain.connect(limiter);
  limiter.connect(audioCtx.destination);
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

function playSample(name: string) {
  const buffer = sampleBuffers.get(name);
  if (!buffer) {
    loadSample(name).then(() => playSample(name));
    return;
  }
  const src = audioCtx!.createBufferSource();
  src.buffer = buffer;
  src.connect(masterGain!);
  src.start();
}

const lp = document.getElementById('lp') as HTMLDivElement;
const lp2 = document.getElementById('lp2') as HTMLDivElement;
const tonearm = document.getElementById('tonearm') as HTMLDivElement;
const tonearm2 = document.getElementById('tonearm2') as HTMLDivElement;
const playBtn = document.getElementById('playPause') as HTMLButtonElement;
const seekbar = document.getElementById('seekbar') as HTMLInputElement;
const bgm = document.getElementById('bgm') as HTMLAudioElement;
bgm.src = BGM_URL;
bgm.volume = 0.66;

let started = false;
function startApp() {
  if (started) return;
  started = true;
  initAudio();
  if (audioCtx!.state === 'suspended') audioCtx!.resume();
  Object.keys(SAMPLE_URLS).forEach(loadSample);
}

/* === LP 회전 + 좌측 LP 스크럽 === */
const lpAngles = [0, 0]; // [left, right] degrees
const SPIN_DPS = 100; // deg/sec (≈3.6s/rev)
const SCRUB_SEC_PER_DEG = 12 / 360; // 한 바퀴 ≈ 12초 이동
let leftScrubbing = false;
let prevPointerAngle = 0;
let lastT = performance.now();

function tick(now: number) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  const playing = !bgm.paused && !bgm.ended;
  if (playing && !leftScrubbing) lpAngles[0] += dt * SPIN_DPS;
  if (playing) lpAngles[1] += dt * SPIN_DPS;
  lp.style.setProperty('--lp-angle', `${lpAngles[0]}deg`);
  lp2.style.setProperty('--lp-angle', `${lpAngles[1]}deg`);
  if (!leftScrubbing && bgm.duration && !seekbarDragging) {
    seekbar.value = String((bgm.currentTime / bgm.duration) * 1000);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function pointerAngleOnLP(e: PointerEvent): number {
  const r = lp.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  return (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI;
}

lp.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (!started) startApp();
  leftScrubbing = true;
  lp.classList.add('scrubbing');
  lp.setPointerCapture(e.pointerId);
  prevPointerAngle = pointerAngleOnLP(e);
});
lp.addEventListener('pointermove', (e) => {
  if (!leftScrubbing) return;
  const a = pointerAngleOnLP(e);
  let delta = a - prevPointerAngle;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  prevPointerAngle = a;
  lpAngles[0] += delta;
  if (bgm.duration && isFinite(bgm.duration)) {
    const next = bgm.currentTime + delta * SCRUB_SEC_PER_DEG;
    bgm.currentTime = Math.max(0, Math.min(bgm.duration, next));
  }
});
const releaseLp = (e: PointerEvent) => {
  if (!leftScrubbing) return;
  leftScrubbing = false;
  lp.classList.remove('scrubbing');
  try {
    lp.releasePointerCapture(e.pointerId);
  } catch {}
};
lp.addEventListener('pointerup', releaseLp);
lp.addEventListener('pointercancel', releaseLp);

/* === 패드 (hold to keep pressed) === */
document.querySelectorAll<HTMLButtonElement>('.pad').forEach((pad) => {
  const onDown = (e: PointerEvent) => {
    e.preventDefault();
    if (!started) startApp();
    if (pad.classList.contains('held')) return;
    pad.classList.add('held');
    const sound = pad.dataset.sound;
    if (sound && SAMPLE_URLS[sound]) playSample(sound);
  };
  const onUp = (e: PointerEvent) => {
    e.preventDefault();
    pad.classList.remove('held');
  };
  pad.addEventListener('pointerdown', onDown);
  pad.addEventListener('pointerup', onUp);
  pad.addEventListener('pointerleave', onUp);
  pad.addEventListener('pointercancel', onUp);
});

/* === 플레이어 === */
function syncPlayingUI() {
  const playing = !bgm.paused && !bgm.ended;
  playBtn.classList.toggle('playing', playing);
  tonearm.classList.toggle('playing', playing);
  tonearm2.classList.toggle('playing', playing);
}
bgm.addEventListener('play', syncPlayingUI);
bgm.addEventListener('pause', syncPlayingUI);
bgm.addEventListener('ended', syncPlayingUI);

playBtn.addEventListener('click', async () => {
  if (!started) startApp();
  if (bgm.paused) {
    try {
      await bgm.play();
    } catch {}
  } else {
    bgm.pause();
  }
});

let seekbarDragging = false;
seekbar.addEventListener('pointerdown', () => {
  seekbarDragging = true;
});
seekbar.addEventListener('pointerup', () => {
  seekbarDragging = false;
});
seekbar.addEventListener('input', () => {
  if (!bgm.duration) return;
  bgm.currentTime = (Number(seekbar.value) / 1000) * bgm.duration;
});

document.addEventListener('contextmenu', (e) => e.preventDefault());
