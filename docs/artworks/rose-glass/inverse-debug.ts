import { applyDeformation, invertDeformation, rotate, foregroundGlassShape, glassBodyWidthAt,
  type Point, type InverseDeformationStep } from '../../../pages/rose-glass/deformation';
import type { GlassBodyMotion } from '../../../pages/rose-glass/interaction';

export function inspectInverse(point: Point, motion: GlassBodyMotion) {
  const target = rotate({ x: point.x - foregroundGlassShape.x - motion.x, y: point.y - foregroundGlassShape.y - motion.y }, -motion.angle);
  const steps: InverseDeformationStep[] = [];
  const source = invertDeformation(target, motion, step => steps.push(step));
  const reconstructed = applyDeformation(source, motion);
  return { target, source, steps, residual: Math.hypot(reconstructed.x - target.x, reconstructed.y - target.y) };
}

export function createInverseDebug(element: HTMLElement, canvas: HTMLCanvasElement, motion: GlassBodyMotion, wake: () => void, example: () => void) {
  const details = document.createElement('details'); details.className = 'inverse-debug';
  details.id = 'inverse-debug'; details.open = location.hash === '#inverse-debug';
  details.innerHTML = `<summary>역변형 디버그: 현재 픽셀의 원래 위치 찾기</summary>
    <p class="demo-note">예제를 불러온 뒤 오른쪽 격자에서 점을 누르고 반복 단계를 바꿔 보세요. 직접 당긴 상태를 멈추고 위 유리에서 점을 선택할 수도 있습니다.</p>
    <button type="button" class="reset-button" data-debug-example>정지된 당김 예제 불러오기</button>
    <div class="inverse-options"><label><input type="checkbox" data-debug="freeze" /> 변형 멈추기</label>
      <label><input type="checkbox" data-debug="select" /> 계산할 점 선택 모드</label>
      <label><input type="checkbox" data-debug="grid" checked /> 유리 위 격자 표시</label></div>
    <canvas class="inverse-map" role="img" aria-label="변형 전 격자와 현재 격자의 점 대응. 파란 점은 찾아낸 원래 재료 위치, 붉은 점은 선택한 현재 위치입니다."></canvas>
    <p class="demo-note">왼쪽 파란 점이 원래 재료 위치, 오른쪽 붉은 점이 현재 화면 위치입니다. 오른쪽 격자를 눌러 다른 점을 검사할 수 있습니다.</p>
    <p class="demo-note"><strong>최종 복원 결과:</strong> 두 격자와 아래 좌표는 전체 역계산을 끝낸 결과입니다.</p>
    <div class="inverse-coordinates"><span>현재 위치 <strong data-value="target"></strong></span><span>찾아낸 원래 위치 <strong data-value="source"></strong></span><span>다시 변형했을 때 오차 <strong data-value="residual"></strong></span></div>
    <p class="demo-note">좌표는 유리 중심을 기준으로 표시합니다. 몸체 전체 이동과 회전은 먼저 되돌린 상태입니다.</p>
    <p class="demo-note"><strong>반복별 중간값:</strong> 아래에서 선택한 작은 변형 하나를 되돌리는 과정을 봅니다.</p>
    <label class="slider-label" for="inverse-iteration"><span>역계산 반복 단계</span><output id="inverse-step-name" for="inverse-iteration"></output></label>
    <input id="inverse-iteration" type="range" min="0" max="0" value="0" step="1" />
    <div class="inverse-step"><span>시작한 추정 위치 <strong data-value="guess"></strong></span><span>앞으로 변형해 본 위치 <strong data-value="forward"></strong></span><span>이번 변형의 목표 위치 <strong data-value="step-target"></strong></span><span>목표와의 차이 <strong data-value="error"></strong></span><span>고친 추정 위치 <strong data-value="next"></strong></span></div>
    <p class="demo-note inverse-hint"></p>
    <details class="inverse-matrix"><summary>변형 기울기 행렬도 보기</summary><pre data-value="matrix"></pre><p class="demo-note">추정 위치를 가로·세로로 조금 옮겼을 때 결과가 얼마나 움직이는지 나타냅니다. 이 행렬을 거꾸로 사용해 화면의 오차를 원래 위치의 수정량으로 바꿉니다.</p></details>`;
  element.append(details);
  const overlay = document.createElement('canvas'); overlay.className = 'inverse-overlay'; overlay.setAttribute('aria-hidden', 'true');
  overlay.hidden = true;
  canvas.after(overlay);
  const map = details.querySelector<HTMLCanvasElement>('.inverse-map')!;
  const slider = details.querySelector<HTMLInputElement>('#inverse-iteration')!;
  let selected: Point = { x: 410, y: 645 };
  const format = (p: Point) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`;
  const text = (key: string, value: string) => { details.querySelector(`[data-value="${key}"]`)!.textContent = value; };
  const enabled = (key: string) => details.querySelector<HTMLInputElement>(`[data-debug="${key}"]`)!.checked;
  const inside = (p: Point) => {
    const y = p.y / foregroundGlassShape.height, x = (p.x - p.y * foregroundGlassShape.shear) / glassBodyWidthAt(2, y);
    return Math.abs(x) ** foregroundGlassShape.exponent + Math.abs(y) ** foregroundGlassShape.exponent <= 1;
  };
  const moved = (p: Point) => {
    const warped = rotate(applyDeformation(p, motion), motion.angle);
    return { x: warped.x + motion.x, y: warped.y + motion.y };
  };
  const drawGrid = (ctx: CanvasRenderingContext2D, project: (p: Point) => Point) => {
    ctx.strokeStyle = '#3b687a80'; ctx.lineWidth = 1;
    for (const vertical of [true, false]) {
      for (let fixed = -375; fixed <= 375; fixed += 75) {
        ctx.beginPath(); let pen = false;
        for (let variable = -390; variable <= 390; variable += 6) {
          const p = vertical ? { x: fixed, y: variable } : { x: variable, y: fixed };
          if (!inside(p)) { pen = false; continue; }
          const out = project(p);
          if (pen) ctx.lineTo(out.x, out.y); else ctx.moveTo(out.x, out.y);
          pen = true;
        }
        ctx.stroke();
      }
    }
  };
  const dot = (ctx: CanvasRenderingContext2D, p: Point, color: string) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
  };
  const update = () => {
    overlay.hidden = !details.open || !enabled('grid');
    if (!details.open) return;
    const result = inspectInverse(selected, motion);
    const ratio = Math.min(devicePixelRatio, 2);
    map.width = Math.round(map.clientWidth * ratio); map.height = Math.round(map.clientWidth * 340 / 640 * ratio);
    const ctx = map.getContext('2d')!;
    ctx.setTransform(map.width / 640, 0, 0, map.height / 340, 0, 0);
    ctx.clearRect(0, 0, 640, 340);
    const left = (p: Point) => ({ x: 160 + p.x * 0.28, y: 175 + p.y * 0.28 });
    const right = (p: Point) => ({ x: 480 + p.x * 0.28, y: 175 + p.y * 0.28 });
    ctx.fillStyle = '#36352f'; ctx.font = `${map.clientWidth < 480 ? 22 : 14}px system-ui`;
    ctx.fillText('변형 전 유리', 85, 28); ctx.fillText('현재 유리', 425, 28);
    drawGrid(ctx, left); drawGrid(ctx, p => right(moved(p)));
    dot(ctx, left(result.source), '#3b687a');
    dot(ctx, right({ x: selected.x - foregroundGlassShape.x, y: selected.y - foregroundGlassShape.y }), '#b64e3c');
    if (!overlay.hidden) {
      const width = canvas.clientWidth, height = canvas.clientHeight;
      overlay.width = Math.round(width * ratio); overlay.height = Math.round(height * ratio);
      const top = overlay.getContext('2d')!; top.setTransform(ratio, 0, 0, ratio, 0, 0);
      const scale = Math.min(width / 590, height / 1280);
      const screen = (p: Point) => ({ x: (p.x + foregroundGlassShape.x - 295) * scale + width / 2, y: (p.y + foregroundGlassShape.y - 640) * scale + height / 2 });
      drawGrid(top, p => screen(moved(p)));
      dot(top, screen({ x: selected.x - foregroundGlassShape.x, y: selected.y - foregroundGlassShape.y }), '#b64e3c');
    }
    text('target', format(result.target)); text('source', format(result.source)); text('residual', result.residual.toFixed(5));
    slider.max = String(Math.max(0, result.steps.length - 1)); slider.disabled = !result.steps.length;
    const step = result.steps[Number(slider.value)];
    details.querySelector('#inverse-step-name')!.textContent = step ? `변형 ${step.fieldIndex + 1} · 반복 ${step.iteration + 1}/5` : '변형 없음';
    for (const [key, value] of Object.entries({ guess: step?.guess, forward: step?.forward, 'step-target': step?.target, error: step?.error, next: step?.next })) text(key, value ? format(value) : '—');
    text('matrix', step ? `[ ${step.jacobian.a.toFixed(4)}  ${step.jacobian.b.toFixed(4)} ]\n[ ${step.jacobian.c.toFixed(4)}  ${step.jacobian.d.toFixed(4)} ]` : '변형이 없으므로 단위 행렬입니다.');
    details.querySelector('.inverse-hint')!.textContent = step
      ? '추정한 원래 위치를 앞으로 변형해 목표와 비교합니다. 차이가 남으면 변형의 기울기로 수정량을 계산합니다. 마지막에 적용한 작은 변형부터 거꾸로, 각각 다섯 번 반복합니다.'
      : '유리를 당기면 역계산 과정이 나타납니다. 변형이 없을 때는 현재 위치와 원래 위치가 같습니다.';
  };
  details.addEventListener('toggle', () => { update(); wake(); }); details.addEventListener('input', () => { update(); wake(); });
  details.querySelector('[data-debug-example]')!.addEventListener('click', () => {
    example(); selected = { x: 410, y: 645 };
    details.querySelector<HTMLInputElement>('[data-debug="freeze"]')!.checked = true;
    update(); wake();
  });
  const select = (point: Point) => {
    if (motion.hitTest(point)) { selected = point; update(); }
    else details.querySelector('.inverse-hint')!.textContent = '유리 안쪽의 점을 눌러 주세요. 유리 바깥은 배경을 그리는 위치입니다.';
  };
  map.addEventListener('pointerdown', event => {
    const rect = map.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * 640, y = (event.clientY - rect.top) / rect.height * 340;
    if (x >= 320) select({ x: (x - 480) / 0.28 + foregroundGlassShape.x, y: (y - 175) / 0.28 + foregroundGlassShape.y });
  });
  document.querySelector('a[href="#inverse-debug"]')?.addEventListener('click', () => { details.open = true; });
  new ResizeObserver(update).observe(map);
  return {
    update,
    get frozen() { return details.open && enabled('freeze'); },
    get selecting() { return details.open && enabled('select'); },
    select,
    resume() { details.querySelector<HTMLInputElement>('[data-debug="freeze"]')!.checked = false; },
  };
}
