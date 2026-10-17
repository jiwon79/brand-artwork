import { fragmentSource } from '../../../pages/rose-glass/shader';
import { foregroundGlassShape, glassBodyWidthAt } from '../../../pages/rose-glass/deformation';
import { GlassBodyMotion } from '../../../pages/rose-glass/interaction';
import { GlassView, scenePoint } from './glass-view';
import { createShadingDemo } from './shading-demo';
import { inspectPixel, inspectionShader } from './pixel-inspection';
import { nearestEdge } from './edge-distance';

type Kind = 'shape' | 'shading' | 'edge';
const copy = {
  shape: ['안팎 판정', '점을 옮겨 f와 안팎 판정을 확인하세요.'],
  edge: ['가장자리까지의 거리와 흡수', '점을 움직여 가장자리까지의 선을 확인하세요.'],
} as const;
const modes = {
  shape: [],
  edge: [['흡수 전', 3, '가장자리 흡수와 끝부분의 배경 비침을 끕니다.'], ['흡수 후', 0, '흡수와 끝부분의 배경 비침을 적용합니다.'], ['외곽과의 거리', 1, '밝을수록 경계에서 멉니다. 근사값 120 이상은 흰색입니다.'], ['통과하는 빛', 2, '밝을수록 빛이 많이 남습니다.']],
} as const;

export function createPixelDemo(kind: Kind) {
  if (kind === 'shading') return createShadingDemo();
  const element = document.createElement('section'); element.className = 'interactive-demo pixel-demo'; element.id = `${kind}-pixels`;
  element.setAttribute('aria-labelledby', `${kind}-pixels-title`);
  element.innerHTML = `<div class="demo-heading"><p class="eyebrow">계산을 눈으로 보기</p><h3 id="${kind}-pixels-title">${copy[kind][0]}</h3><p>${copy[kind][1]}</p></div>
    <div class="rose-demo-layout"><div class="rose-scene"><span class="pixel-marker" aria-hidden="true"></span></div><div class="rose-controls">
    ${kind === 'shape' ? '' : `<div class="rose-stage-buttons" role="group" aria-label="${copy[kind][0]} 보기">${modes[kind].map(([name, mode], index) => `<button type="button" class="${index < 2 ? 'comparison-button' : ''}" data-mode="${mode}" aria-pressed="false">${name}</button>`).join('')}</div>`}
    <p class="pixel-mode-description" aria-live="polite"></p>
    <div class="pixel-position-controls"><label for="${kind}-u">좌우 u</label><input id="${kind}-u" type="range" min="-1.25" max="1.25" step="0.01" value="0.6" />
    <label for="${kind}-v">위아래 v</label><input id="${kind}-v" type="range" min="-1.25" max="1.25" step="0.01" value="0" />
    ${kind === 'edge' ? '<label for="edge-width">흡수 폭</label><input id="edge-width" type="range" min="0.3" max="2" step="0.05" value="1" />' : ''}
    </div>
    <output class="pixel-readout" aria-live="polite"></output>
    </div></div>
    ${kind === 'edge' ? '<figure class="edge-plot"><canvas width="600" height="210" role="img" aria-label="유리 오른쪽 외곽에서 중앙까지 빨강 성분의 빛이 통과하는 비율"></canvas><figcaption>오른쪽 외곽 → 중앙: 빨강 성분의 빛이 통과하는 비율</figcaption></figure>' : ''}
    <p class="demo-note">앞쪽 유리의 실제 셰이더에서 계산한 값을 분리해 표시합니다. 수치는 서리·드래그·눌림이 없는 기본 상태입니다.${kind === 'edge' ? ' 외곽과의 거리는 셰이더의 근사값이며 작품 좌표의 단위입니다.' : ''}</p>`;
  const host = element.querySelector<HTMLElement>('.rose-scene')!;
  let view: GlassView;
  try { view = new GlassView(host, copy[kind][0], kind === 'shape' ? fragmentSource : inspectionShader(fragmentSource, kind)); }
  catch { host.textContent = '계산 그림을 표시하려면 WebGL 2가 필요합니다.'; return element; }
  const distanceOverlay = kind === 'edge' ? document.createElement('canvas') : null;
  if (distanceOverlay) {
    distanceOverlay.className = 'edge-distance-overlay'; distanceOverlay.setAttribute('aria-hidden', 'true'); host.append(distanceOverlay);
  }
  const motion = new GlassBodyMotion();
  const uInput = element.querySelector<HTMLInputElement>(`#${kind}-u`)!;
  const vInput = element.querySelector<HTMLInputElement>(`#${kind}-v`)!;
  const widthInput = element.querySelector<HTMLInputElement>('#edge-width');
  const readout = element.querySelector<HTMLOutputElement>('.pixel-readout')!;
  const marker = host.querySelector<HTMLElement>('.pixel-marker')!;
  const plot = element.querySelector<HTMLCanvasElement>('.edge-plot canvas');
  let mode = 0;
  const update = () => {
    const u = Number(uInput.value), v = Number(vInput.value);
    if (kind === 'edge') {
      const baseScale = Math.min(host.clientWidth / 590, host.clientHeight / 1280);
      if (baseScale > 0) view.previewZoom = Math.min((host.clientWidth - 16) / 560, (host.clientHeight - 24) / 800) / baseScale;
    }
    view.absorptionWidth = Number(widthInput?.value ?? 1);
    view.stage = kind === 'shape' ? 1 : mode === 3 ? 2 : 3;
    view.debugMode = kind === 'edge' && mode === 3 ? 0 : mode; view.draw(motion);
    const sample = inspectPixel(u, v, view.absorptionWidth);
    const scale = Math.min(host.clientWidth / 590, host.clientHeight / 1280) * view.previewZoom;
    const y = v * foregroundGlassShape.height;
    marker.style.left = `${host.clientWidth / 2 + (foregroundGlassShape.x + u * glassBodyWidthAt(2, v) + y * foregroundGlassShape.shear - 295) * scale}px`;
    marker.style.top = `${host.clientHeight / 2 + (foregroundGlassShape.y + y - 640) * scale}px`;
    const place = Math.abs(sample.field - 1) < .00001 ? '경계' : sample.field < 1 ? '안쪽' : '바깥쪽';
    readout.textContent = `u=${u.toFixed(2)}, v=${v.toFixed(2)}\nf=${sample.field.toFixed(3)} → ${place}`;
    if (distanceOverlay) {
      const nearest = nearestEdge(u, v);
      drawDistance(distanceOverlay, nearest, scale);
      readout.textContent = `가장자리까지 ${nearest.distance.toFixed(1)}\n셰이더 근사 ${sample.distance.toFixed(1)}\nf=${sample.field.toFixed(3)} · ${place}`;
      if (sample.field <= 1) readout.textContent += `\n통과율 ${(mode === 3 ? [1, 1, 1] : sample.transmission).map(t => `${(t * 100).toFixed(0)}%`).join(' / ')}`;
    }
    if (kind === 'shape') element.querySelector('.pixel-mode-description')!.textContent = place === '경계' ? '경계에서는 유리색과 배경색을 섞어 매끄럽게 연결합니다.' : sample.field < 1 ? '이 위치에는 유리의 기본색을 표시합니다.' : '이 위치에는 배경색을 유지합니다.';
    if (plot) drawPlot(plot, view.absorptionWidth, mode !== 3);
  };
  const setMode = (next: number) => {
    mode = next;
    element.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.mode) === mode)));
    element.querySelector('.pixel-mode-description')!.textContent = modes[kind].find(item => item[1] === mode)?.[2] ?? '';
    update();
  };
  element.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(Number(button.dataset.mode))));
  setMode(mode);
  for (const input of [uInput, vInput, widthInput]) input?.addEventListener('input', update);
  const pick = (event: PointerEvent) => {
    const rect = view.canvas.getBoundingClientRect();
    const p = scenePoint(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height, view.previewZoom);
    const y = p.y - foregroundGlassShape.y, v = y / foregroundGlassShape.height;
    const u = (p.x - foregroundGlassShape.x - y * foregroundGlassShape.shear) / glassBodyWidthAt(2, v);
    uInput.value = String(u); vInput.value = String(v); update();
  };
  view.canvas.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    view.canvas.setPointerCapture(event.pointerId); pick(event);
  });
  view.canvas.addEventListener('pointermove', event => { if (view.canvas.hasPointerCapture(event.pointerId)) pick(event); });
  for (const name of ['pointerup', 'pointercancel']) view.canvas.addEventListener(name, event => {
    const id = (event as PointerEvent).pointerId;
    if (view.canvas.hasPointerCapture(id)) view.canvas.releasePointerCapture(id);
  });
  new ResizeObserver(update).observe(host); update(); return element;
}

function drawDistance(canvas: HTMLCanvasElement, nearest: ReturnType<typeof nearestEdge>, scale: number) {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return;
  const dpr = Math.min(devicePixelRatio, 2);
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d')!; ctx.scale(dpr, dpr);
  const project = (p: { x: number; y: number }) => ({
    x: width / 2 + (foregroundGlassShape.x + p.x - 295) * scale,
    y: height / 2 + (foregroundGlassShape.y + p.y - 640) * scale,
  });
  const start = project(nearest.point), end = project(nearest.boundary);
  ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y);
  ctx.strokeStyle = 'white'; ctx.lineWidth = 5; ctx.stroke();
  ctx.strokeStyle = '#235c9a'; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.arc(end.x, end.y, 4, 0, 2 * Math.PI); ctx.fillStyle = 'white'; ctx.fill(); ctx.stroke();
  ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
  const text = nearest.distance.toFixed(1), half = ctx.measureText(text).width / 2 + 4;
  const x = Math.max(half, Math.min(width - half, (start.x + end.x) / 2));
  const y = Math.max(14, Math.min(height - 6, (start.y + end.y) / 2 - 10));
  ctx.strokeStyle = 'white'; ctx.lineWidth = 4; ctx.strokeText(text, x, y); ctx.fillStyle = '#235c9a'; ctx.fillText(text, x, y);
}

function drawPlot(canvas: HTMLCanvasElement, width: number, absorption: boolean) {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 600, 210); ctx.font = '13px sans-serif'; ctx.fillStyle = '#645c4f';
  ctx.fillText('100%', 8, 24); ctx.fillText('0%', 20, 177);
  ctx.strokeStyle = '#d5cbb9'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(55, 20); ctx.lineTo(55, 175); ctx.lineTo(580, 175); ctx.stroke();
  ctx.strokeStyle = '#a65042'; ctx.lineWidth = 3; ctx.beginPath();
  for (let i = 0; i <= 160; i++) {
    const t = absorption ? inspectPixel(1 - i / 160, 0, width).transmission[0] : 1;
    const x = 55 + i / 160 * 525, y = 175 - t * 155;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke(); ctx.fillText('외곽', 55, 200); ctx.fillText('중앙', 550, 200);
}
