import { fragmentSource } from '../../../pages/rose-glass/shader';
import { foregroundGlassShape, glassBodyWidthAt } from '../../../pages/rose-glass/deformation';
import { GlassBodyMotion } from '../../../pages/rose-glass/interaction';
import { GlassView, scenePoint } from './glass-view';
import { inspectPixel, inspectionShader } from './pixel-inspection';

type Kind = 'shape' | 'shading' | 'edge';
const copy = {
  shape: ['안팎 판정', '점을 옮겨 f와 안팎 판정을 확인하세요.'],
  shading: ['음영 쌓기', '세 요소를 켜고 끄며 누적 결과를 비교하세요.'],
  edge: ['가장자리 흡수', '흡수 폭을 바꾸며 거리·통과율·결과를 비교하세요.'],
} as const;
const modes = {
  shape: [],
  shading: [['전체 끄기', 5, '기본 핑크색입니다.'], ['전체 켜기', 4, '색 영역을 순서대로 섞고, 띠와 옆면의 감쇠를 적용한 결과입니다.'], ['첫 색 영역 강도 · 1/8', 1, '색 영역 8곳 중 오른쪽 위 한 곳의 혼합 비율입니다.'], ['대각선 띠', 2, '기준선 주변에 띠가 나타납니다. 흰 곳일수록 짙은 붉은색과 어둠을 더합니다.'], ['좌우 옆면', 3, '표면이 옆으로 기울수록 밝게 표시됩니다. 이 비율만큼 색을 빼서 옆면을 어둡게 합니다.']],
  edge: [['흡수 전', 3, '기본 음영입니다. 가장자리 흡수와 끝부분의 배경 비침을 끈 상태입니다.'], ['흡수 후', 0, '가장자리에서 빛을 흡수하고 끝부분에 배경색을 비춘 결과입니다.'], ['외곽과의 거리', 1, '검은 경계에서 안쪽으로 들어갈수록 밝아집니다. 외곽 근처의 거리 근사를 표시하며, 120 이상은 흰색입니다.'], ['통과하는 빛', 2, '흰 곳은 빛이 많이 남고 어두운 곳은 많이 흡수됩니다. 좌우·아래쪽의 흡수 폭이 다릅니다.']],
} as const;

export function createPixelDemo(kind: Kind) {
  const element = document.createElement('section'); element.className = 'interactive-demo pixel-demo'; element.id = `${kind}-pixels`;
  element.setAttribute('aria-labelledby', `${kind}-pixels-title`);
  element.innerHTML = `<div class="demo-heading"><p class="eyebrow">계산을 눈으로 보기</p><h3 id="${kind}-pixels-title">${copy[kind][0]}</h3><p>${copy[kind][1]}</p></div>
    <div class="rose-demo-layout"><div class="rose-scene"><span class="pixel-marker" aria-hidden="true"></span></div><div class="rose-controls">
    ${kind === 'shape' ? '' : `<div class="rose-stage-buttons" role="group" aria-label="${copy[kind][0]} 보기">${modes[kind].filter((_, index) => kind !== 'shading' || index < 2).map(([name, mode], index) => `<button type="button" class="${index < 2 ? 'comparison-button' : ''}" data-mode="${mode}" aria-pressed="false">${name}</button>`).join('')}</div>`}
    ${kind === 'shading' ? `<div class="shade-toggles">${[['색 영역', 1], ['대각선 띠', 2], ['옆면 어둠', 4]].map(([label, bit]) => `<div class="shade-toggle-row" role="group" aria-label="${label}"><span>${label}${bit === 1 ? ' <small>8곳</small>' : ''}</span><label><input type="radio" name="shade-${bit}" value="0" data-shade="${bit}" aria-label="${label} 끄기" checked />끔</label><label><input type="radio" name="shade-${bit}" value="1" data-shade="${bit}" aria-label="${label} 켜기" />켬</label></div>`).join('')}</div><p class="shade-color-note">색 영역은 기본색 5곳과 보정 3곳을 함께 적용합니다.</p>` : ''}
    <p class="pixel-mode-description" aria-live="polite"></p>
    ${kind === 'shading' ? `<details class="shade-diagnostics"><summary>계산 보기</summary><label for="shade-inspect-view">표시</label><select id="shade-inspect-view"><option value="0">합친 색</option>${modes.shading.slice(2).map(([label, value]) => `<option value="${value}">${label}</option>`).join('')}</select>` : ''}
    <label for="${kind}-u">좌우 u</label><input id="${kind}-u" type="range" min="-1.25" max="1.25" step="0.01" value="0.6" />
    <label for="${kind}-v">위아래 v</label><input id="${kind}-v" type="range" min="-1.25" max="1.25" step="0.01" value="0" />
    ${kind === 'edge' ? '<label for="edge-width">흡수 폭</label><input id="edge-width" type="range" min="0.3" max="2" step="0.05" value="1" />' : ''}
    <output class="pixel-readout" aria-live="polite"></output>
    ${kind === 'shading' ? '</details>' : ''}
    </div></div>
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
  let mode = kind === 'shading' ? 16 : 0;
  const update = () => {
    const u = Number(uInput.value), v = Number(vInput.value);
    view.absorptionWidth = Number(widthInput?.value ?? 1);
    view.stage = kind === 'shape' ? 1 : kind === 'shading' || mode === 3 ? 2 : 3;
    view.debugMode = kind === 'edge' && mode === 3 ? 0 : mode; view.draw(motion);
    const sample = inspectPixel(u, v, view.absorptionWidth);
    const scale = Math.min(host.clientWidth / 590, host.clientHeight / 1280);
    const y = v * foregroundGlassShape.height;
    marker.style.left = `${host.clientWidth / 2 + (foregroundGlassShape.x + u * glassBodyWidthAt(2, v) + y * foregroundGlassShape.shear - 295) * scale}px`;
    marker.style.top = `${host.clientHeight / 2 + (foregroundGlassShape.y + y - 640) * scale}px`;
    const place = Math.abs(sample.field - 1) < .00001 ? '경계' : sample.field < 1 ? '안쪽' : '바깥쪽';
    readout.textContent = `u=${u.toFixed(2)}, v=${v.toFixed(2)}\nf=${sample.field.toFixed(3)} → ${place}`;
    if (kind === 'shading' && sample.field <= 1) {
      const measurements = { 1: `혼합 비율 ${sample.patch.toFixed(3)}`, 2: `띠 강도 ${sample.band.toFixed(3)}`, 3: `좌 ${sample.left.toFixed(3)} / 우 ${sample.right.toFixed(3)}`, 4: '혼합·감쇠 적용', 5: '기본 핑크색' };
      const enabled = [['색 영역', 1], ['띠', 2], ['옆면', 4]].filter(([, bit]) => (mode & Number(bit)) !== 0).map(([label]) => label);
      readout.textContent += `\n${mode >= 16 ? enabled.join(' → ') || '기본 핑크색' : measurements[mode as keyof typeof measurements]}`;
    }
    if (kind === 'edge' && sample.field <= 1) readout.textContent += `\n거리 ≈ ${sample.distance.toFixed(1)}\n통과율 RGB\n${(mode === 3 ? [1, 1, 1] : sample.transmission).map(t => `${(t * 100).toFixed(0)}%`).join(' / ')}`;
    if (kind === 'shape') element.querySelector('.pixel-mode-description')!.textContent = place === '경계' ? '경계에서는 유리색과 배경색을 섞어 매끄럽게 연결합니다.' : sample.field < 1 ? '이 위치에는 유리의 기본색을 표시합니다.' : '이 위치에는 배경색을 유지합니다.';
    if (plot) drawPlot(plot, view.absorptionWidth, mode !== 3);
  };
  const setMode = (next: number) => {
    mode = next;
    element.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(item => {
      const value = Number(item.dataset.mode);
      const selected = kind === 'shading' && value === 5 ? mode === 16 : kind === 'shading' && value === 4 ? mode === 23 : value === mode;
      item.setAttribute('aria-pressed', String(selected));
    });
    if (kind === 'shading' && mode >= 16) {
      element.querySelectorAll<HTMLInputElement>('[data-shade]').forEach(input => {
        input.checked = Boolean(mode & Number(input.dataset.shade)) === (input.value === '1');
      });
    }
    element.querySelector('.pixel-mode-description')!.textContent = kind === 'shading' && mode >= 16
      ? mode === 16 ? '기본 핑크색' : `핑크색 + ${[['색 영역 8곳', 1], ['띠', 2], ['옆면', 4]].filter(([, bit]) => (mode & Number(bit)) !== 0).map(([label]) => label).join(' + ')}`
      : modes[kind].find(item => item[1] === mode)?.[2] ?? '';
    const inspectionSelect = element.querySelector<HTMLSelectElement>('#shade-inspect-view');
    if (inspectionSelect) inspectionSelect.value = String(mode >= 16 ? 0 : mode);
    update();
  };
  element.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.addEventListener('click', () => {
    const next = Number(button.dataset.mode);
    setMode(kind === 'shading' && next === 5 ? 16 : kind === 'shading' && next === 4 ? 23 : next);
  }));
  element.querySelectorAll<HTMLInputElement>('[data-shade]').forEach(input => input.addEventListener('change', () => {
    let bits = 0;
    element.querySelectorAll<HTMLInputElement>('[data-shade]:checked').forEach(selected => {
      if (selected.value === '1') bits |= Number(selected.dataset.shade);
    });
    setMode(16 | bits);
  }));
  const shadingBits = () => [...element.querySelectorAll<HTMLInputElement>('[data-shade]:checked')].reduce((bits, input) => input.value === '1' ? bits | Number(input.dataset.shade) : bits, 0);
  const inspectionDetails = element.querySelector<HTMLDetailsElement>('.shade-diagnostics');
  element.querySelector('#shade-inspect-view')?.addEventListener('change', event => {
    const value = Number((event.target as HTMLSelectElement).value);
    setMode(value || (16 | shadingBits()));
  });
  if (inspectionDetails) {
    marker.hidden = true;
    inspectionDetails.addEventListener('toggle', () => {
      marker.hidden = !inspectionDetails.open;
      if (!inspectionDetails.open && mode < 16) setMode(16 | shadingBits());
    });
  }
  setMode(mode);
  for (const input of [uInput, vInput, widthInput]) input?.addEventListener('input', update);
  const pick = (event: PointerEvent) => {
    if (inspectionDetails) inspectionDetails.open = true;
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
