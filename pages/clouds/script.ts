import { CloudRenderer } from './renderer';
import { decodeVolume, DEFAULT_SEED, DEFAULT_SUN, type Formation } from './volume';
import './style.css';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('cloud-canvas');
let renderer: CloudRenderer;
let generation = 0, worker: Worker | undefined, generating = false, saving = false;
let seed = DEFAULT_SEED, formation: Formation = 'cumulus', selection = 'cumulus';
const started = performance.now();
const volumes = {
  cumulus: new URL('./assets/cumulus.cloud', import.meta.url),
  tower: new URL('./assets/tower.cloud', import.meta.url),
  bank: new URL('./assets/bank.cloud', import.meta.url),
};
const cache = new Map<Formation, Promise<ReturnType<typeof decodeVolume>>>();
const presets: Record<string, { name: string; description: string; geometry: Formation; number: string }> = {
  cumulus: { name: 'Fair weather', description: 'Cumulus humilis · daylight', geometry: 'cumulus', number: '01' },
  tower: { name: 'Towering cumulus', description: 'Cumulus congestus · rising columns', geometry: 'tower', number: '02' },
  sunset: { name: 'Evening light', description: 'Cumulus humilis · golden hour', geometry: 'cumulus', number: '03' },
  bank: { name: 'Cloud sea', description: 'Stratocumulus · cloud sea', geometry: 'bank', number: '04' },
  storm: { name: 'Thunderstorm', description: 'Towering cloud · moonlight & lightning', geometry: 'tower', number: '05' },
};
function fail(message: string) {
  $('loading').hidden = true; $('error-message').textContent = message; $('error').hidden = false;
  $<HTMLButtonElement>('save').disabled = true;
}
function showControls(visible: boolean) {
  $('controls').hidden = !visible; $('controls').inert = !visible;
  $('toggle').setAttribute('aria-expanded', String(visible)); $('toggle').setAttribute('aria-label', visible ? '설정 닫기' : '설정 열기');
}
showControls(!matchMedia('(max-width: 760px)').matches);
$('toggle').addEventListener('click', () => showControls($('controls').hidden));
$('reload').addEventListener('click', () => location.reload());

function loadVolume(kind: Formation) {
  let promise = cache.get(kind);
  if (!promise) {
    promise = fetch(volumes[kind]).then(response => {
      if (!response.ok) throw new Error(`구름 데이터를 불러오지 못했습니다 (${response.status}).`);
      if (!response.body) throw new Error('구름 데이터가 비어 있습니다.');
      return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }).then(decodeVolume).catch(error => { cache.delete(kind); throw error; });
    cache.set(kind, promise);
  }
  return promise;
}
async function selectPreset() {
  const id = ++generation; worker?.terminate(); worker = undefined;
  generating = true; $<HTMLButtonElement>('save').disabled = true; $<HTMLButtonElement>('new-cloud').disabled = false;
  selection = $<HTMLSelectElement>('formation').value;
  const preset = presets[selection]; formation = preset.geometry;
  seed = DEFAULT_SEED; $('seed').textContent = `SEED ${seed}`;
  $('scene-name').textContent = preset.name; $('scene-description').textContent = preset.description; $('number').textContent = `${preset.number} / 05`;
  $('storm-controls').hidden = selection !== 'storm';
  renderer.update({ night: selection === 'storm', exposure: selection === 'sunset' ? 0.2 : 0 });
  setRange('exposure', renderer.settings.exposure);
  const sun = DEFAULT_SUN, length = Math.hypot(...sun);
  setRange('elevation', selection === 'sunset' ? 9 : Math.asin(sun[1] / length) * 180 / Math.PI);
  setRange('azimuth', Math.atan2(sun[0], sun[2]) * 180 / Math.PI);
  updateSun(); renderer.resetCamera(formation === 'tower', formation === 'bank');
  $('status').textContent = '구름을 불러오는 중';
  try {
    const volume = await loadVolume(formation);
    if (id !== generation) return;
    renderer.setVolume(volume.density, volume.shadow); generating = false;
    $('loading').hidden = true;
    canvas.dataset.loadMs = String(Math.round(performance.now() - started));
  } catch (error) { if (id === generation) { generating = false; fail(error instanceof Error ? error.message : String(error)); } }
}
function newCloud() {
  const id = ++generation; worker?.terminate(); worker = new Worker(new URL('./cloud-worker.ts', import.meta.url), { type: 'module' });
  seed = crypto.getRandomValues(new Uint32Array(1))[0]; generating = true; $<HTMLButtonElement>('save').disabled = true;
  $('seed').textContent = `SEED ${seed}`; $('status').textContent = '새 구름을 만드는 중';
  worker.onmessage = ({ data }: MessageEvent<{ id: number; density: Uint8Array; milliseconds: number; error?: string }>) => {
    if (data.id !== generation) return;
    generating = false;
    if (data.error) fail(data.error);
    else { renderer.setVolume(data.density); canvas.dataset.generationMs = data.milliseconds.toFixed(1); }
    worker?.terminate(); worker = undefined;
  };
  worker.onerror = () => { if (id === generation) { generating = false; fail('새 구름을 만들지 못했습니다. 다시 불러오기를 눌러주세요.'); worker?.terminate(); worker = undefined; } };
  worker.postMessage({ id, formation, seed });
}
const formats: Record<string, (n: number) => string> = {
  elevation: n => `${Math.round(n)}°`, azimuth: n => `${Math.round(n)}°`, density: n => n.toFixed(2),
  exposure: n => `${n > 0 ? '+' : ''}${n.toFixed(2)} EV`, glare: n => `${Math.round(n * 100)}%`,
};
function setRange(name: string, value: number) {
  const input = $<HTMLInputElement>(name); input.value = String(value);
  input.style.setProperty('--fill', `${(value - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100}%`);
  $(`${name}-value`).textContent = formats[name](Number(input.value));
}
function updateSun() { renderer.setSun(Number($<HTMLInputElement>('elevation').value), Number($<HTMLInputElement>('azimuth').value)); }
for (const name of Object.keys(formats)) {
  const input = $<HTMLInputElement>(name); setRange(name, Number(input.value));
  input.addEventListener('input', () => {
    const value = Number(input.value); setRange(name, value);
    if (name === 'elevation' || name === 'azimuth') updateSun(); else renderer.update({ [name]: value });
  });
}
$('formation').addEventListener('change', () => void selectPreset());
$('new-cloud').addEventListener('click', newCloud);
$('orbit').addEventListener('click', () => {
  const orbit = $('orbit').getAttribute('aria-pressed') !== 'true'; $('orbit').setAttribute('aria-pressed', String(orbit)); renderer.setOrbit(orbit);
});
$('reset').addEventListener('click', () => renderer.resetCamera(formation === 'tower', formation === 'bank'));
$('zoom-in').addEventListener('click', () => renderer.zoom(-0.12)); $('zoom-out').addEventListener('click', () => renderer.zoom(0.12));
$('detail').addEventListener('change', () => renderer.update({ detail: $<HTMLSelectElement>('detail').value as 'balanced' | 'high' }));
$('flash').addEventListener('click', () => renderer.flash());
$('lightning').addEventListener('click', () => {
  const lightning = !renderer.settings.lightning; renderer.update({ lightning });
  $('lightning').setAttribute('aria-pressed', String(lightning)); $('lightning').textContent = `자동 번개 ${lightning ? '켜짐' : '꺼짐'}`;
});
$('save').addEventListener('click', () => {
  if (saving || generating) return;
  saving = true; canvas.toBlob(blob => {
    saving = false;
    if (!blob) { $('status').textContent = '이미지를 저장하지 못했습니다'; return; }
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `clouds-${selection}-${seed}.png`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
});
try {
  renderer = new CloudRenderer(canvas); renderer.onError = fail;
  renderer.onStats = stats => {
    if (!canvas.dataset.firstFrameMs) canvas.dataset.firstFrameMs = String(Math.round(performance.now() - started));
    if (stats.phase === 'ready') canvas.dataset.settleMs = String(Math.round(stats.settleMs));
    $('fps').textContent = stats.phase === 'ready' ? '화면 완성 · Idle' : `${stats.fps || '—'} FPS`;
    $('gpu').textContent = stats.gpuMs === null ? 'GPU —' : `GPU ${stats.gpuMs.toFixed(1)} ms`;
    $('resolution').textContent = `${stats.width} × ${stats.height}`;
    $('samples').textContent = `${stats.samples} / ${stats.target}`;
    $<HTMLButtonElement>('save').disabled = generating || stats.phase !== 'ready';
    if (!generating) $('status').textContent = stats.phase === 'moving' ? '구름을 돌아보는 중' : stats.phase === 'ready' ? '세부 묘사 완성' : `빛을 다듬는 중 · ${stats.samples}/${stats.target}`;
    Object.assign(canvas.dataset, { phase: stats.phase, samples: String(stats.samples), shadowBuilds: String(stats.shadowBuilds), draws: String(stats.draws), gpuMs: stats.gpuMs?.toFixed(2) ?? '', fps: String(stats.fps) });
  };
  void selectPreset();
  if (import.meta.hot) import.meta.hot.dispose(() => { worker?.terminate(); renderer.dispose(); });
} catch (error) { fail(error instanceof Error ? error.message : String(error)); }
