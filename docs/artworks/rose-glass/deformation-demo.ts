import { applyDeformation, type Point } from '../../../pages/rose-glass/deformation';

/** One production pull map, with pressure disabled to isolate the distance rule. */
export function pullSample(point: Point, displacement: Point) {
  const radius = 210 + .25 * Math.hypot(displacement.x, displacement.y);
  const weight = Math.exp(-.5 * (point.x ** 2 + point.y ** 2) / radius ** 2);
  const moved = applyDeformation(point, { deformationFields: [{ center: { x: 0, y: 0 }, displacement, indentation: 0 }] });
  return { moved, weight, radius, distance: Math.hypot(point.x, point.y), travel: Math.hypot(moved.x - point.x, moved.y - point.y) };
}

export function createDeformationDemo() {
  const element = document.createElement('section'); element.className = 'interactive-demo pull-rule-demo'; element.id = 'deformation-demo';
  element.setAttribute('aria-labelledby', 'deformation-demo-title');
  element.innerHTML = `<div class="demo-heading"><h3 id="deformation-demo-title">변형 F의 한 단계</h3><p>빨간 점으로 당기고, 파란 점 P를 좌우로 옮겨 이동량을 비교하세요.</p></div>
    <div class="pull-views" role="group" aria-label="변형 규칙 보기"><button type="button" data-pull-view="weight" aria-pressed="false">영향 범위</button><button type="button" data-pull-view="warp" aria-pressed="true">점의 이동</button></div>
    <canvas class="pull-rule-canvas" role="img" aria-label="잡은 점 C에서 멀수록 덜 움직이는 격자. 빨간 점으로 당김을, 파란 점으로 검사 위치를 바꿀 수 있습니다."></canvas>
    <p class="pull-legend"></p>
    <div class="pull-sliders"><div><label for="pull-length">당긴 길이 <output id="pull-length-value"></output></label><input id="pull-length" type="range" min="0" max="220" step="1" value="160" /></div><div><label for="pull-distance">C에서 P까지 <output id="pull-distance-value"></output></label><input id="pull-distance" type="range" min="0" max="420" step="1" value="220" /></div></div>
    <output class="pull-calculation" aria-live="polite"></output>`;
  const canvas = element.querySelector<HTMLCanvasElement>('canvas')!, ctx = canvas.getContext('2d')!;
  const lengthInput = element.querySelector<HTMLInputElement>('#pull-length')!, distanceInput = element.querySelector<HTMLInputElement>('#pull-distance')!;
  let displacement = { x: 160, y: 0 }, point = { x: -220, y: 0 }, mode = 'warp';
  let drag: { id: number; kind: 'pull' | 'point' } | null = null;
  const scale = () => Math.min(canvas.clientWidth / 1000, canvas.clientHeight / 440);
  const screen = (p: Point) => ({ x: canvas.clientWidth * .53 + p.x * scale(), y: canvas.clientHeight / 2 + p.y * scale() });
  const arrow = (a: Point, b: Point, color: string) => {
    const start = screen(a), end = screen(b), angle = Math.atan2(end.y - start.y, end.x - start.x);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
    if (Math.hypot(end.x - start.x, end.y - start.y) < 6) return;
    ctx.beginPath(); ctx.moveTo(end.x, end.y); ctx.lineTo(end.x - 7 * Math.cos(angle - .4), end.y - 7 * Math.sin(angle - .4)); ctx.lineTo(end.x - 7 * Math.cos(angle + .4), end.y - 7 * Math.sin(angle + .4)); ctx.closePath(); ctx.fill();
  };
  const dot = (p: Point, color: string, filled: boolean, text: string, dx = 8, dy = -10) => {
    const q = screen(p); ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, 2 * Math.PI); ctx.fillStyle = filled ? color : '#faf8f3'; ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = '11px system-ui, sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = '#faf8f3'; ctx.strokeText(text, q.x + dx, q.y + dy); ctx.fillStyle = color; ctx.fillText(text, q.x + dx, q.y + dy);
  };
  const update = () => {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(devicePixelRatio, 2); canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const sample = pullSample(point, displacement), center = screen({ x: 0, y: 0 });
    if (mode === 'weight') {
      const heat = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, 3 * sample.radius * scale());
      for (const r of [0, .5, 1, 1.5, 2, 2.5, 3]) heat.addColorStop(r / 3, `rgba(35,92,154,${.5 * Math.exp(-.5 * r * r)})`);
      ctx.fillStyle = heat; ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = '#235c9a66'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(center.x, center.y, sample.radius * scale(), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    const grid = (warped: boolean) => {
      ctx.strokeStyle = warped ? '#235c9a99' : '#8b847777'; ctx.lineWidth = 1; ctx.setLineDash(warped ? [] : [3, 4]);
      for (const vertical of [true, false]) for (let fixed = vertical ? -450 : -200; fixed <= (vertical ? 350 : 200); fixed += 50) {
        ctx.beginPath();
        for (let variable = vertical ? -200 : -450; variable <= (vertical ? 200 : 350); variable += 10) {
          const p = vertical ? { x: fixed, y: variable } : { x: variable, y: fixed };
          const q = screen(warped ? pullSample(p, displacement).moved : p);
          if (variable === (vertical ? -200 : -450)) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    };
    grid(false); if (mode === 'warp') grid(true);
    arrow({ x: 0, y: 0 }, displacement, '#b64e3c'); arrow(point, sample.moved, '#235c9a');
    dot({ x: 0, y: 0 }, '#645c4f', false, sample.distance < 1 ? 'P = C' : 'C', sample.distance < 1 ? -30 : -12, 20);
    if (sample.travel * scale() >= 8) {
      if (sample.distance >= 1) dot(point, '#235c9a', false, 'P', -12, -12);
      dot(sample.moved, '#235c9a', true, 'F₁(P)', -10, -12);
    } else dot(point, '#235c9a', false, sample.travel < 1e-8 ? 'P = F₁(P)' : 'P → F₁(P)', -25, -12);
    dot(displacement, '#b64e3c', true, Math.hypot(displacement.x, displacement.y) < 1 ? '당김 0' : '당김 Δ', 8, 20);
    lengthInput.value = String(Math.hypot(displacement.x, displacement.y)); distanceInput.value = String(sample.distance);
    element.querySelector('#pull-length-value')!.textContent = Math.hypot(displacement.x, displacement.y).toFixed(0);
    element.querySelector('#pull-distance-value')!.textContent = sample.distance.toFixed(0);
    element.querySelector('.pull-calculation')!.textContent = `당김 ${Math.hypot(displacement.x, displacement.y).toFixed(0)} × 영향 ${(sample.weight * 100).toFixed(1)}% ≈ 이동 ${sample.travel.toFixed(1)}`;
    element.querySelector('.pull-legend')!.textContent = mode === 'warp' ? '회색 점선: 변형 전 · 파란 실선: 변형 후' : '진할수록 당김의 영향을 많이 받습니다.';
    element.querySelectorAll<HTMLButtonElement>('[data-pull-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.pullView === mode)));
  };
  lengthInput.addEventListener('input', () => {
    const length = Math.hypot(displacement.x, displacement.y), next = Number(lengthInput.value);
    displacement = length > 0 ? { x: displacement.x * next / length, y: displacement.y * next / length } : { x: next, y: 0 }; update();
  });
  distanceInput.addEventListener('input', () => { point = { x: -Number(distanceInput.value), y: 0 }; update(); });
  element.querySelectorAll<HTMLButtonElement>('[data-pull-view]').forEach(button => button.addEventListener('click', () => { mode = button.dataset.pullView!; update(); }));
  const position = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left - canvas.clientWidth * .53) / scale(), y: (event.clientY - rect.top - canvas.clientHeight / 2) / scale() };
  };
  const move = (event: PointerEvent) => {
    const p = position(event);
    if (drag?.kind === 'pull') {
      const x = Math.max(-220, Math.min(220, p.x)), y = Math.max(-140, Math.min(140, p.y)), gain = Math.min(1, 220 / Math.max(1, Math.hypot(x, y)));
      displacement = { x: x * gain, y: y * gain };
    } else point = { x: Math.max(-420, Math.min(0, p.x)), y: 0 };
    update();
  };
  canvas.addEventListener('pointerdown', event => {
    if (drag || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const p = position(event);
    drag = { id: event.pointerId, kind: Math.hypot(p.x - displacement.x, p.y - displacement.y) * scale() <= 22 ? 'pull' : 'point' };
    canvas.setPointerCapture(event.pointerId); move(event);
  });
  canvas.addEventListener('pointermove', event => { if (drag?.id === event.pointerId) move(event); });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, event => {
    const id = (event as PointerEvent).pointerId;
    if (drag?.id !== id) return;
    drag = null; if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  });
  new ResizeObserver(update).observe(canvas); return element;
}
