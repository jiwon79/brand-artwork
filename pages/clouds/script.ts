import { CloudRenderer, type RenderStatus } from './gaussian/renderer.js';
import { PRESETS } from './gaussian/cloud.js';
import { SceneMemoryCache, sceneKey, type GaussianScene } from './scene-cache';
import './style.css';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('cloud-canvas');
type Preset = keyof typeof PRESETS;
const query = new URLSearchParams(location.search);
let selection: Preset = Object.prototype.hasOwnProperty.call(PRESETS, query.get('preset') ?? '') ? query.get('preset') as Preset : 'cumulus';
let seed = PRESETS[selection].seed, generation = 0, generating = false, failed = false, saving = false;
let renderer: CloudRenderer, worker: Worker | undefined, workerBusy = false, activeKey = '';
let metrics: { started: number; cache?: string; geometryMs?: number; firstFrameMs?: number; readyMs?: number };
const memory = new SceneMemoryCache(matchMedia('(pointer:coarse)').matches ? 128 * 1024 * 1024 : 240 * 1024 * 1024);
const formats: Record<string, (n: number) => string> = {
  elevation: n => `${Math.round(n)}°`, azimuth: n => `${Math.round(n)}°`, density: n => n.toFixed(2),
  exposure: n => `${n > 0 ? '+' : ''}${n.toFixed(2)} EV`, glare: n => `${Math.round(n * 100)}%`,
};
function setRange(name: string, value: number) {
  const input = $<HTMLInputElement>(name); input.value = String(value);
  input.style.setProperty('--fill', `${(value - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100}%`);
  $(`${name}-value`).textContent = formats[name](Number(input.value));
}
function fail(message: string) {
  failed = true; $('loading').hidden = true; $('error-message').textContent = message; $('error').hidden = false;
  $<HTMLButtonElement>('save').disabled = true; canvas.dataset.phase = 'error';
}
function showControls(visible: boolean) {
  $('controls').hidden = !visible; $('controls').inert = !visible;
  $('toggle').setAttribute('aria-expanded', String(visible)); $('toggle').setAttribute('aria-label', visible ? '설정 닫기' : '설정 열기');
}
showControls(!matchMedia('(max-width: 760px)').matches);
$('toggle').addEventListener('click', () => showControls($('controls').hidden));
$('reload').addEventListener('click', () => location.reload());
function status({ state, samples = 0, target = 128, count = 0, visibleCount = 0, error }: RenderStatus) {
  if (error) { fail(error); return; } if (failed || !renderer) return;
  const ready = state === 'ready' && !renderer.sampleFence && !generating;
  canvas.dataset.phase = ready ? 'ready' : generating ? 'generating' : state === 'ready' ? 'refining' : state ?? 'initializing';
  Object.assign(canvas.dataset, { samples: String(samples), sourceCount: String(count), visibleCount: String(visibleCount) });
  if (metrics) Object.assign(canvas.dataset, {
    geometryMs: String(metrics.geometryMs ?? ''), cache: metrics.cache ?? '',
    firstFrameMs: String(metrics.firstFrameMs ?? ''), readyMs: String(metrics.readyMs ?? ''),
  });
  $('resolution').textContent = `${canvas.width} × ${canvas.height}`; $('samples').textContent = `${samples} / ${target}`;
  $<HTMLButtonElement>('save').disabled = saving || !ready;
  if (ready && metrics && metrics.readyMs === undefined) { metrics.readyMs = performance.now() - metrics.started; canvas.dataset.readyMs = String(metrics.readyMs); }
  if (ready) { $('loading').hidden = true; $('status').textContent = '원본 세부 묘사 완성'; }
  else if (!generating) $('status').textContent = state === 'lighting' ? '빛을 계산하는 중' : `빛을 다듬는 중 · ${samples}/${target}`;
}
function accept(scene: GaussianScene, key: string, final: boolean) {
  generating = !final;
  renderer.setCloud(scene, { reuse: true });
  if (final) { memory.put(key, scene); activeKey = key; }
}
function createWorker() {
  const instance = new Worker(new URL('./cloud-worker.ts', import.meta.url), { type: 'module' });
  instance.onmessage = ({ data }: MessageEvent<{ id: number; scene: GaussianScene; stage: string; milliseconds: number; cacheHit: boolean; error?: string }>) => {
    if (instance !== worker || data.id !== generation || failed) return;
    if (data.error) { fail(data.error); return; }
    const final = data.stage === 'complete';
    if (final) { workerBusy = false; metrics.geometryMs = data.milliseconds; metrics.cache = data.cacheHit ? 'disk' : 'generated'; }
    try { accept(data.scene, sceneKey(selection, seed), final); } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
  };
  instance.onerror = event => { if (instance === worker) fail(event.message || '구름을 만들지 못했습니다. 다시 불러와 주세요.'); };
  return instance;
}
function createCloud(preset: Preset, nextSeed: number, applyPreset = true) {
  if (failed) return;
  selection = preset; seed = nextSeed >>> 0; generation++; generating = true;
  metrics = { started: performance.now() }; canvas.dataset.phase = 'generating'; canvas.dataset.samples = '0';
  const settings = PRESETS[preset];
  $<HTMLSelectElement>('formation').value = preset; $('seed').textContent = `SEED ${seed}`;
  $('scene-name').textContent = settings.name; $('scene-description').textContent = (settings as typeof settings & { description: string }).description;
  $('number').textContent = `${String(Object.keys(PRESETS).indexOf(preset) + 1).padStart(2, '0')} / 05`;
  $('storm-controls').hidden = preset !== 'storm';
  if (applyPreset) {
    for (const name of ['elevation', 'azimuth', 'density', 'exposure'] as const) setRange(name, settings[name]);
    renderer.configure({ elevation: settings.elevation, azimuth: settings.azimuth, density: settings.density, exposure: settings.exposure, scattering: settings.scattering });
    renderer.resetCamera(settings);
  }
  $('status').textContent = '구름을 준비하는 중'; $<HTMLButtonElement>('save').disabled = true;
  // A later selection owns all results. Stop obsolete CPU/GPU preparation.
  if (workerBusy) { worker?.terminate(); worker = undefined; workerBusy = false; }
  const key = sceneKey(preset, seed);
  const scene = key === activeKey && renderer.scene && !renderer.scene.preview && renderer.scene.seed === seed ? { ...renderer.scene, preset } : memory.get(key, preset);
  if (scene) {
    metrics.cache = 'memory'; metrics.geometryMs = performance.now() - metrics.started;
    accept(scene, key, true); return;
  }
  if (!worker) worker = createWorker(); workerBusy = true;
  worker.postMessage({ id: generation, preset, seed, persistent: query.get('cache') !== 'off' });
}
for (const name of Object.keys(formats)) {
  const input = $<HTMLInputElement>(name); setRange(name, Number(input.value));
  input.addEventListener('input', () => { setRange(name, Number(input.value)); renderer.configure({ [name]: Number(input.value) }); });
}
$('formation').addEventListener('change', () => { const value = $<HTMLSelectElement>('formation').value as Preset; createCloud(value, PRESETS[value].seed); });
$('new-cloud').addEventListener('click', () => createCloud(selection, crypto.getRandomValues(new Uint32Array(1))[0] % 100000, false));
$('orbit').addEventListener('click', () => {
  const orbit = !renderer.settings.orbit; $('orbit').setAttribute('aria-pressed', String(orbit)); renderer.configure({ orbit });
});
$('reset').addEventListener('click', () => renderer.resetCamera(PRESETS[selection]));
$('zoom-in').addEventListener('click', () => renderer.zoomBy(.8)); $('zoom-out').addEventListener('click', () => renderer.zoomBy(1 / .8));
$('detail').addEventListener('change', () => renderer.configure({ quality: $<HTMLSelectElement>('detail').value === 'high' ? 1 : .75 }));
$('flash').addEventListener('click', () => renderer.flashLightning());
$('lightning').addEventListener('click', () => {
  const lightning = !renderer.settings.lightning; renderer.configure({ lightning });
  $('lightning').setAttribute('aria-pressed', String(lightning)); $('lightning').textContent = `자동 번개 ${lightning ? '켜짐' : '꺼짐'}`;
});
$('save').addEventListener('click', async () => {
  if (saving || generating) return; saving = true; $<HTMLButtonElement>('save').disabled = true;
  try {
    const blob = await renderer.exportPNG(), url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `clouds-${selection}-${seed}.png`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (error) { $('status').textContent = error instanceof Error ? error.message : String(error); }
  finally { saving = false; $<HTMLButtonElement>('save').disabled = generating || !renderer.readyToSave; }
});
document.addEventListener('keydown', event => {
  if ((event.target as HTMLElement)?.matches('input,select,textarea') || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key.toLowerCase() === 'r') $('reset').click();
  if (event.key.toLowerCase() === 'h' || event.key === 'Escape') showControls(event.key === 'Escape' ? false : $('controls').hidden);
});
try {
  renderer = new CloudRenderer(canvas, status, { completedCache: query.get('cache') !== 'off' && query.get('framecache') !== 'off' });
  renderer.configure({ quality: 1, lodMultiplier: 1, samplesPerFrame: 4, autoPerformance: true, lightning: !matchMedia('(prefers-reduced-motion: reduce)').matches });
  canvas.addEventListener('samplecomplete', event => {
    const completed = (event as CustomEvent<{ scene: GaussianScene | null }>).detail.scene;
    if (completed?.preset === selection && completed.seed === seed) {
      $('loading').hidden = true;
      if (metrics.firstFrameMs === undefined) metrics.firstFrameMs = performance.now() - metrics.started;
    }
  });
  canvas.addEventListener('renderstats', () => {
    const stats = renderer.renderStats();
    $('fps').textContent = generating ? '구름 준비 중' : renderer.readyToSave && !renderer.sampleFence ? '화면 완성 · Idle' : `${stats.fps === null ? '—' : Math.round(stats.fps)} FPS`;
    $('gpu').textContent = stats.lod.scale === null ? 'GAUSSIAN' : `LOD ${stats.lod.scale}×`;
  });
  canvas.addEventListener('framecachechange', (event) => {
    const stats = (event as CustomEvent<{ persisted: number; restored: number; source: string }>).detail;
    Object.assign(canvas.dataset, { framePersisted: String(stats.persisted), frameRestored: String(stats.restored), frameCache: stats.source });
  });
  canvas.addEventListener('resolutionchange', () => { $('resolution').textContent = `${canvas.width} × ${canvas.height}`; });
  // Explicit diagnostics for reproducible source/quality/performance comparisons.
  Object.assign(window, { clouds: { renderer, diagnostics: () => ({ ...renderer.diagnostics(), generating, failed, generation: metrics, cache: { bytes: memory.bytes, entries: memory.entries.size } }) } });
  createCloud(selection, seed);
  if (import.meta.hot) import.meta.hot.dispose(() => { worker?.terminate(); renderer.dispose(); memory.clear(); });
  window.addEventListener('pagehide', event => { if (!event.persisted) { worker?.terminate(); renderer.dispose(); memory.clear(); } });
} catch (error) { fail(error instanceof Error ? error.message : String(error)); }
