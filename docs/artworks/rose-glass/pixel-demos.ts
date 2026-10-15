import { fragmentSource } from '../../../pages/rose-glass/shader';
import { foregroundGlassShape, glassBodyWidthAt } from '../../../pages/rose-glass/deformation';
import { GlassBodyMotion } from '../../../pages/rose-glass/interaction';
import { GlassView, scenePoint } from './glass-view';
import { inspectPixel, inspectionShader } from './pixel-inspection';

type Kind = 'shape' | 'shading' | 'edge';
const copy = {
  shape: ['픽셀 한 점의 안팎을 판정하기', '점을 유리 안팎으로 옮겨 보세요. 위치에서 계산한 f가 1을 넘는 순간 바깥쪽이 됩니다.'],
  shading: ['음영을 만드는 세 가지 재료', '각 버튼은 해당 계산의 영향만 보여줍니다. 흰 곳일수록 색 혼합이나 어둠이 강하게 적용됩니다. 마지막 버튼에서 합친 음영을 확인하세요.'],
  edge: ['외곽에서 안쪽으로 들어갈 때 빛은 얼마나 남을까?', '외곽과의 거리, 통과하는 빛, 흡수가 적용된 색을 차례로 보세요. 흡수 폭을 바꾸면 어둠이 안쪽으로 얼마나 퍼질지 달라집니다.'],
} as const;
const modes = {
  shape: [],
  shading: [['색 영역 하나', 1, '오른쪽 위의 색 영역 하나입니다. 흰 곳은 그 영역의 색을 많이 섞고 검은 곳은 기존 색을 유지합니다.'], ['대각선 띠', 2, '기준선 주변에 띠가 나타납니다. 흰 곳일수록 짙은 붉은색과 어둠을 더합니다.'], ['좌우 옆면', 3, '표면이 옆으로 기울수록 밝게 표시됩니다. 이 비율만큼 색을 빼서 옆면을 어둡게 합니다.'], ['합친 음영', 4, '여러 색 영역, 대각선 띠, 좌우 옆면 감쇠를 실제 계산 순서로 합친 기본 음영입니다.']],
  edge: [['외곽과의 거리', 1, '검은 경계에서 안쪽으로 들어갈수록 밝아집니다. 외곽 근처의 거리 근사를 표시하며, 120 이상은 흰색입니다.'], ['통과하는 빛', 2, '흰 곳은 빛이 많이 남고 어두운 곳은 많이 흡수됩니다. 좌우·아래쪽의 흡수 폭이 다릅니다.'], ['흡수 적용', 0, '기본 음영에 가장자리 흡수를 적용한 색입니다.']],
} as const;

export function createPixelDemo(kind: Kind) {
  const element = document.createElement('section'); element.className = 'interactive-demo pixel-demo'; element.id = `${kind}-pixels`;
  element.setAttribute('aria-labelledby', `${kind}-pixels-title`);
  element.innerHTML = `<div class="demo-heading"><p class="eyebrow">계산을 눈으로 보기</p><h3 id="${kind}-pixels-title">${copy[kind][0]}</h3><p>${copy[kind][1]}</p></div>
    <div class="rose-demo-layout"><div class="rose-scene"><span class="pixel-marker" aria-hidden="true"></span></div><div class="rose-controls">
    ${kind === 'shape' ? '' : `<div class="rose-stage-buttons" role="group" aria-label="${copy[kind][0]} 보기">${modes[kind].map(([name, mode]) => `<button type="button" data-mode="${mode}" aria-pressed="false">${name}</button>`).join('')}</div>`}
    <p class="pixel-mode-description" aria-live="polite"></p>
    <label for="${kind}-u">점의 좌우 위치 u</label><input id="${kind}-u" type="range" min="-1.25" max="1.25" step="0.01" value="0.6" />
    <label for="${kind}-v">점의 위아래 위치 v</label><input id="${kind}-v" type="range" min="-1.25" max="1.25" step="0.01" value="0" />
    ${kind === 'edge' ? '<label for="edge-width">흡수 폭</label><input id="edge-width" type="range" min="0.3" max="2" step="0.05" value="1" />' : ''}
    <output class="pixel-readout" aria-live="polite"></output>
    <p class="demo-note">화면을 누르거나 점을 드래그할 수 있습니다. 슬라이더는 키보드로도 조작할 수 있습니다.</p></div></div>
    ${kind === 'edge' ? '<figure class="edge-plot"><canvas width="600" height="210" role="img" aria-label="유리 오른쪽 외곽에서 중앙까지 빨강 성분의 빛이 통과하는 비율"></canvas><figcaption>오른쪽 외곽 → 중앙: 빨강 성분의 빛이 통과하는 비율</figcaption></figure>' : ''}
    <p class="demo-note">앞쪽 유리의 실제 셰이더에서 계산한 값을 분리해 표시합니다. 수치는 서리·드래그·눌림이 없는 기본 상태입니다.${kind === 'edge' ? ' 외곽과의 거리는 셰이더의 근사값이며 작품 좌표의 단위입니다.' : ''}</p>`;
  const host = element.querySelector<HTMLElement>('.rose-scene')!;
  let view: GlassView;
  try { view = new GlassView(host, copy[kind][0], kind === 'shape' ? fragmentSource : inspectionShader(fragmentSource, kind)); }
  catch { host.textContent = '계산 그림을 표시하려면 WebGL 2가 필요합니다.'; return element; }
  view.stage = kind === 'shape' ? 1 : kind === 'shading' ? 2 : 3;
  const motion = new GlassBodyMotion();
  const uInput = element.querySelector<HTMLInputElement>(`#${kind}-u`)!;
  const vInput = element.querySelector<HTMLInputElement>(`#${kind}-v`)!;
  const widthInput = element.querySelector<HTMLInputElement>('#edge-width');
  const readout = element.querySelector<HTMLOutputElement>('.pixel-readout')!;
  const marker = host.querySelector<HTMLElement>('.pixel-marker')!;
  const plot = element.querySelector<HTMLCanvasElement>('.edge-plot canvas');
  let mode = kind === 'shape' ? 0 : 1;
  const update = () => {
    const u = Number(uInput.value), v = Number(vInput.value);
    view.absorptionWidth = Number(widthInput?.value ?? 1); view.debugMode = mode; view.draw(motion);
    const sample = inspectPixel(u, v, view.absorptionWidth);
    const scale = Math.min(host.clientWidth / 590, host.clientHeight / 1280);
    const y = v * foregroundGlassShape.height;
    marker.style.left = `${host.clientWidth / 2 + (foregroundGlassShape.x + u * glassBodyWidthAt(2, v) + y * foregroundGlassShape.shear - 295) * scale}px`;
    marker.style.top = `${host.clientHeight / 2 + (foregroundGlassShape.y + y - 640) * scale}px`;
    const place = Math.abs(sample.field - 1) < .00001 ? '경계' : sample.field < 1 ? '안쪽' : '바깥쪽';
    readout.textContent = `u=${u.toFixed(2)}, v=${v.toFixed(2)}\nf=${sample.field.toFixed(3)} → ${place}`;
    if (kind === 'shading' && sample.field <= 1) readout.textContent += `\n색 영역 혼합 비율 ${sample.patch.toFixed(3)}\n대각선 띠 강도 ${sample.band.toFixed(3)}\n왼쪽 감쇠 ${sample.left.toFixed(3)} / 오른쪽 감쇠 ${sample.right.toFixed(3)}`;
    if (kind === 'edge' && sample.field <= 1) readout.textContent += `\n외곽과의 거리 ≈ ${sample.distance.toFixed(1)}\n흡수 폭 배율 ${view.absorptionWidth.toFixed(2)}\n빛이 통과하는 비율 (RGB)\n${sample.transmission.map(t => `${(t * 100).toFixed(1)}%`).join(' / ')}`;
    if (kind === 'shape') element.querySelector('.pixel-mode-description')!.textContent = place === '경계' ? '경계에서는 유리색과 배경색을 섞어 매끄럽게 연결합니다.' : sample.field < 1 ? '이 위치에는 유리의 기본색을 표시합니다.' : '이 위치에는 배경색을 유지합니다.';
    if (plot) drawPlot(plot, view.absorptionWidth);
  };
  element.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.addEventListener('click', () => {
    mode = Number(button.dataset.mode);
    element.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(item => item.setAttribute('aria-pressed', String(Number(item.dataset.mode) === mode)));
    element.querySelector('.pixel-mode-description')!.textContent = modes[kind].find(item => item[1] === mode)?.[2] ?? '';
    update();
  }));
  const first = element.querySelector<HTMLButtonElement>('[data-mode]');
  if (first) { first.setAttribute('aria-pressed', 'true'); element.querySelector('.pixel-mode-description')!.textContent = modes[kind][0]?.[2] ?? ''; }
  for (const input of [uInput, vInput, widthInput]) input?.addEventListener('input', update);
  const pick = (event: PointerEvent) => {
    const rect = view.canvas.getBoundingClientRect();
    const p = scenePoint(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
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

function drawPlot(canvas: HTMLCanvasElement, width: number) {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 600, 210); ctx.font = '13px sans-serif'; ctx.fillStyle = '#645c4f';
  ctx.fillText('100%', 8, 24); ctx.fillText('0%', 20, 177);
  ctx.strokeStyle = '#d5cbb9'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(55, 20); ctx.lineTo(55, 175); ctx.lineTo(580, 175); ctx.stroke();
  ctx.strokeStyle = '#a65042'; ctx.lineWidth = 3; ctx.beginPath();
  for (let i = 0; i <= 160; i++) {
    const t = inspectPixel(1 - i / 160, 0, width).transmission[0];
    const x = 55 + i / 160 * 525, y = 175 - t * 155;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke(); ctx.fillText('외곽', 55, 200); ctx.fillText('중앙', 550, 200);
}
