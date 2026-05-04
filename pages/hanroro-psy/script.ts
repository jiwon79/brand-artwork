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

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;

function initAudio() {
  if (audioCtx) return;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  audioCtx = new Ctor();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.8;
  masterGain.connect(audioCtx.destination);
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

const tonearm = document.getElementById('tonearm') as HTMLDivElement;
const tonearm2 = document.getElementById('tonearm2') as HTMLDivElement;

let started = false;
function startApp() {
  if (started) return;
  started = true;
  initAudio();
  if (audioCtx!.state === 'suspended') audioCtx!.resume();
  Object.keys(SAMPLE_URLS).forEach(loadSample);
  tonearm.classList.add('playing');
  tonearm2.classList.add('playing');
}

document.querySelectorAll<HTMLButtonElement>('.pad').forEach((pad) => {
  const onDown = (e: PointerEvent) => {
    e.preventDefault();
    if (!started) {
      startApp();
      return;
    }
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

document.querySelectorAll<HTMLDivElement>('.lp').forEach((lpEl) => {
  lpEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!started) startApp();
  });
});

document.addEventListener('contextmenu', (e) => e.preventDefault());
