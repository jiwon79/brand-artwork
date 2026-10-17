import { applyDeformation, type Point } from '../../../pages/rose-glass/deformation';

const examples = [
  { label: '가까운 점', point: { x: -80, y: 60 }, displacement: { x: 150, y: -90 } },
  { label: '먼 점', point: { x: -350, y: 140 }, displacement: { x: 150, y: -90 } },
  { label: '대각선', point: { x: 180, y: -140 }, displacement: { x: -120, y: 120 } },
];

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
  element.innerHTML = `<div class="demo-heading"><h3 id="deformation-demo-title">변형 F의 한 단계</h3><p>그림을 눌러 P를 고르고, 두 점을 가로·세로로 움직여 보세요.</p></div>
    <div class="pull-views" role="group" aria-label="변형 규칙 보기"><button type="button" data-pull-view="weight" aria-pressed="false">영향 범위</button><button type="button" data-pull-view="warp" aria-pressed="true">점의 이동</button></div>
    <canvas class="pull-rule-canvas" role="img" aria-label="잡은 점 C에서 멀수록 덜 움직이는 격자. 빨간 점으로 당김을, 파란 점으로 검사 위치를 바꿀 수 있습니다."></canvas>
    <p class="pull-legend"></p>
    <div class="pull-examples" role="group" aria-label="2차원 점 예시">${examples.map((example, i) => `<button type="button" data-pull-example="${i}" aria-pressed="false">${example.label}</button>`).join('')}</div>
    <div class="pull-sliders"><div><label for="pull-length">당긴 길이 <output id="pull-length-value"></output></label><input id="pull-length" type="range" min="0" max="220" step="1" value="170" /></div><div><label for="pull-x">P 가로 <output id="pull-x-value"></output></label><input id="pull-x" type="range" min="-420" max="350" step="1" value="180" /></div><div><label for="pull-y">P 세로 <output id="pull-y-value"></output></label><input id="pull-y" type="range" min="-160" max="160" step="1" value="-140" /></div></div>
    <output class="pull-coordinates" aria-live="polite"></output>
    <output class="pull-calculation" aria-live="polite"></output>`;
  const canvas = element.querySelector<HTMLCanvasElement>('canvas')!, ctx = canvas.getContext('2d')!;
  const lengthInput = element.querySelector<HTMLInputElement>('#pull-length')!, xInput = element.querySelector<HTMLInputElement>('#pull-x')!, yInput = element.querySelector<HTMLInputElement>('#pull-y')!;
  let displacement = { ...examples[2].displacement }, point = { ...examples[2].point }, mode = 'warp';
  let drag: { id: number; kind: 'pull' | 'point' } | null = null;
  const scale = () => Math.min(canvas.clientWidth / 1000, canvas.clientHeight / 760);
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
    ctx.font = '11px system-ui, sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = '#faf8f3';
    const x = Math.max(4, Math.min(canvas.clientWidth - ctx.measureText(text).width - 4, q.x + dx)), y = Math.max(13, Math.min(canvas.clientHeight - 5, q.y + dy));
    ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
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
      for (const vertical of [true, false]) for (let fixed = vertical ? -800 : -300; fixed <= (vertical ? 750 : 300); fixed += 50) {
        ctx.beginPath();
        for (let variable = vertical ? -300 : -800; variable <= (vertical ? 300 : 750); variable += 10) {
          const p = vertical ? { x: fixed, y: variable } : { x: variable, y: fixed };
          const q = screen(warped ? pullSample(p, displacement).moved : p);
          if (variable === (vertical ? -300 : -800)) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
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
    lengthInput.value = String(Math.hypot(displacement.x, displacement.y)); xInput.value = String(point.x); yInput.value = String(point.y);
    element.querySelector('#pull-length-value')!.textContent = Math.hypot(displacement.x, displacement.y).toFixed(0);
    element.querySelector('#pull-x-value')!.textContent = point.x.toFixed(0);
    element.querySelector('#pull-y-value')!.textContent = point.y.toFixed(0);
    const pair = (p: Point) => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`;
    element.querySelector('.pull-coordinates')!.textContent = `P ${pair(point)} → F₁(P) ${pair(sample.moved)}`;
    element.querySelector('.pull-calculation')!.textContent = `당김 ${Math.hypot(displacement.x, displacement.y).toFixed(0)} × 영향 ${(sample.weight * 100).toFixed(1)}% ≈ 이동 ${sample.travel.toFixed(1)}`;
    element.querySelector('.pull-legend')!.textContent = mode === 'warp' ? '회색 점선: 변형 전 · 파란 실선: 변형 후' : '진할수록 당김의 영향을 많이 받습니다.';
    element.querySelectorAll<HTMLButtonElement>('[data-pull-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.pullView === mode)));
    element.querySelectorAll<HTMLButtonElement>('[data-pull-example]').forEach(button => {
      const example = examples[Number(button.dataset.pullExample)];
      button.setAttribute('aria-pressed', String(Math.hypot(point.x - example.point.x, point.y - example.point.y) < .5 && Math.hypot(displacement.x - example.displacement.x, displacement.y - example.displacement.y) < .5));
    });
  };
  lengthInput.addEventListener('input', () => {
    const length = Math.hypot(displacement.x, displacement.y), next = Number(lengthInput.value);
    displacement = length > 0 ? { x: displacement.x * next / length, y: displacement.y * next / length } : { x: next, y: 0 }; update();
  });
  for (const input of [xInput, yInput]) input.addEventListener('input', () => { point = { x: Number(xInput.value), y: Number(yInput.value) }; update(); });
  element.querySelectorAll<HTMLButtonElement>('[data-pull-example]').forEach(button => button.addEventListener('click', () => {
    const example = examples[Number(button.dataset.pullExample)]; point = { ...example.point }; displacement = { ...example.displacement }; update();
  }));
  element.querySelectorAll<HTMLButtonElement>('[data-pull-view]').forEach(button => button.addEventListener('click', () => { mode = button.dataset.pullView!; update(); }));
  const position = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left - canvas.clientWidth * .53) / scale(), y: (event.clientY - rect.top - canvas.clientHeight / 2) / scale() };
  };
  const move = (event: PointerEvent) => {
    const p = position(event);
    if (drag?.kind === 'pull') {
      const gain = Math.min(1, 220 / Math.max(1, Math.hypot(p.x, p.y)));
      displacement = { x: p.x * gain, y: p.y * gain };
    } else point = { x: Math.max(-420, Math.min(350, p.x)), y: Math.max(-160, Math.min(160, p.y)) };
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
