import { GlassView, scenePoint } from './glass-view';
import { GlassBodyMotion } from '../../../pages/rose-glass/interaction';
import { createInverseDebug } from './inverse-debug';
import { drawDeformationOverlay } from './deformation-overlay';

const stages = [
  ['형태', '각 픽셀의 위치로 안팎을 판정합니다. 안쪽은 유리의 기본색, 바깥쪽은 배경색으로 칠합니다.'],
  ['음영', '표면 방향에 따른 옆면의 어둠과 위치별 부드러운 색 영역을 계산하고 그림자를 더합니다.'],
  ['가장자리', '외곽에서의 거리를 계산해 가까운 곳에 흡수를 집중합니다. 끝에서는 뒤쪽 색을 섞습니다.'],
  ['빛', '넓은 반사광과 움직일 수 있는 광원을 더합니다. 빛의 위치를 바꾸며 표면의 굴곡을 읽어 보세요.'],
  ['서리', '크기가 다른 잔무늬와 작은 표면 기울기를 더합니다. 같은 빛 아래에서도 매끈한 면과 다른 반응이 보입니다.'],
  ['흐림', '가장자리 주변을 더 넓게 섞어 경계를 부드럽게 만듭니다. 가운데 질감은 상대적으로 선명하게 남습니다.'],
] as const;

function createDemo(id: string, title: string, description: string) {
  const element = document.createElement('section');
  element.className = 'interactive-demo'; element.id = id;
  element.setAttribute('aria-labelledby', `${id}-title`);
  element.innerHTML = `<div class="demo-heading"><p class="eyebrow">ROSE GLASS · 직접 조작하기</p>
    <h3 id="${id}-title">${title}</h3><p>${description}</p></div>
    <div class="rose-demo-layout"><div class="rose-scene"></div><div class="rose-controls"></div></div>
    <p class="demo-note">작품의 실제 표면 렌더링을 사용합니다. 비교하기 쉽도록 빛의 자동 움직임은 멈추고, 앞쪽 유리 한 개를 먼저 보여줍니다.</p>`;
  let view: GlassView;
  try { view = new GlassView(element.querySelector('.rose-scene')!, title); }
  catch {
    element.querySelector('.rose-demo-layout')!.textContent = '이 데모는 WebGL 2가 필요합니다. 본문의 설명을 확인하거나 다른 브라우저에서 열어 주세요.';
    return { element, view: null };
  }
  return { element, view };
}

export function createMaterialDemo() {
  const { element, view } = createDemo('material-demo', '유리 표현 단계',
    '각 단계를 눌러 추가되는 표현을 비교하세요.');
  if (!view) return element;
  const motion = new GlassBodyMotion();
  const controls = element.querySelector('.rose-controls')!;
  controls.innerHTML = `<div class="rose-stage-buttons" role="group" aria-label="유리 표현 단계">${stages.map(([title], i) => `<button type="button" data-stage="${i + 1}" aria-pressed="${i === 0}">${title}</button>`).join('')}</div>
    <p class="rose-stage-description" aria-live="polite"></p>
    <label for="rose-light">빛의 위치</label><input id="rose-light" type="range" min="0" max="1" step="0.01" value="0.65" />
    <p class="demo-note">조명이 더해진 단계부터 빛의 위치를 바꿀 수 있습니다.</p>
    <label class="rose-checkbox"><input type="checkbox" id="rose-overlap" /> 뒤쪽 유리도 함께 보기</label>`;
  const setStage = (stage: number) => {
    view.stage = stage;
    controls.querySelectorAll<HTMLButtonElement>('[data-stage]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.stage) === stage)));
    controls.querySelector('.rose-stage-description')!.textContent = stages[stage - 1][1];
    controls.querySelector<HTMLInputElement>('#rose-light')!.disabled = stage < 4;
    view.draw(motion);
  };
  controls.querySelectorAll<HTMLButtonElement>('[data-stage]').forEach(button => button.addEventListener('click', () => setStage(Number(button.dataset.stage))));
  controls.querySelector('#rose-light')!.addEventListener('input', event => { view.light = Number((event.target as HTMLInputElement).value); view.draw(motion); });
  controls.querySelector('#rose-overlap')!.addEventListener('change', event => { view.overlap = (event.target as HTMLInputElement).checked; view.draw(motion); });
  new ResizeObserver(() => view.draw(motion)).observe(element.querySelector('.rose-scene')!);
  setStage(1);
  return element;
}

export function createDragDemo() {
  const { element, view } = createDemo('drag-demo', '국소 변형',
    '유리를 잡아당기고 손을 놓아 보세요.');
  if (!view) return element;
  const motion = new GlassBodyMotion();
  const controls = element.querySelector('.rose-controls')!;
  controls.innerHTML = `<div class="rose-stage-buttons" role="group" aria-label="국소 변형 보기"><button type="button" data-drag-view="grid" aria-pressed="true">격자</button><button type="button" data-drag-view="glass" aria-pressed="false">유리</button></div>
    <p class="rose-drag-status" aria-live="polite">유리 위를 잡아당겨 보세요.</p>
    <button type="button" data-action="pull">오른쪽으로 당겨 보기</button>
    <button type="button" data-action="release">손 놓기</button>
    <button type="button" data-action="reset">처음으로</button>`;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const pointers = new Set<number>();
  const overlay = document.createElement('canvas'); overlay.className = 'deformation-overlay'; overlay.setAttribute('aria-hidden', 'true'); view.canvas.after(overlay);
  const legend = document.createElement('p'); legend.className = 'drag-legend'; legend.textContent = '점선: 원래 외곽 · 파란 선: 점의 이동'; element.querySelector('.rose-demo-layout')!.after(legend);
  let dragView = 'grid';
  const draw = () => {
    view.stage = dragView === 'grid' ? 2 : 6; view.draw(motion);
    overlay.hidden = dragView !== 'grid' || Boolean(element.querySelector('.inverse-debug[open]'));
    legend.hidden = overlay.hidden;
    if (!overlay.hidden) drawDeformationOverlay(overlay, motion, view.previewZoom);
  };
  let frame = 0, previous = 0, inView = true, lastMode = '';
  const render = (now: number) => {
    frame = 0;
    if (!inView || document.hidden) return;
    const dt = Math.min((now - previous) / 1000 || 1 / 60, 1 / 30); previous = now;
    const active = !debug.frozen && motion.step(dt, 85, 1, { softness: 1.1, indentationDepth: 1, recovery: 1, stretchLimit: 430 }, reduced.matches);
    draw(); view.canvas.dataset.interaction = motion.mode;
    debug.update();
    if (lastMode !== motion.mode) {
      lastMode = motion.mode;
      controls.querySelector('.rose-drag-status')!.textContent = motion.mode === 'dragging' ? '잡은 곳 주변이 늘어나고 있습니다.' : motion.mode === 'returning' ? '손을 놓아 원래 형태로 돌아오는 중입니다.' : '유리 위를 잡아당겨 보세요.';
    }
    if (active) wake();
  };
  const wake = () => { if (!frame && inView && !document.hidden) frame = requestAnimationFrame(render); };
  const debug = createInverseDebug(element, view.canvas, motion, wake, () => {
    releaseAll(); motion.reset(true); motion.grab(-1, { x: 420, y: 645 }); motion.move(-1, { x: 600, y: 580 });
    for (let i = 0; i < 90; i++) motion.step(1 / 60, 85, 1, { softness: 1.1, indentationDepth: 1, recovery: 1, stretchLimit: 430 }, reduced.matches);
  });
  const releaseAll = () => {
    for (const id of pointers) { motion.release(id, reduced.matches); if (view.canvas.hasPointerCapture(id)) view.canvas.releasePointerCapture(id); }
    pointers.clear(); motion.release(-1, reduced.matches); wake();
  };
  const position = (event: PointerEvent) => {
    const rect = view.canvas.getBoundingClientRect();
    return scenePoint(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height, view.previewZoom);
  };
  view.canvas.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (debug.selecting) { debug.select(position(event)); return; }
    debug.resume();
    motion.release(-1, reduced.matches);
    if (motion.grab(event.pointerId, position(event), event.pressure)) {
      pointers.add(event.pointerId); view.canvas.setPointerCapture(event.pointerId); wake();
    }
  });
  view.canvas.addEventListener('pointermove', event => { if (pointers.has(event.pointerId)) { motion.move(event.pointerId, position(event), event.pressure); wake(); } });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) view.canvas.addEventListener(name, event => {
    const id = (event as PointerEvent).pointerId;
    if (pointers.delete(id)) { motion.release(id, reduced.matches); wake(); }
  });
  controls.querySelector('[data-action="pull"]')!.addEventListener('click', () => {
    debug.resume();
    releaseAll(); motion.reset(true); motion.grab(-1, { x: 420, y: 645 }); motion.move(-1, { x: 600, y: 580 }); wake();
  });
  controls.querySelector('[data-action="release"]')!.addEventListener('click', () => { debug.resume(); releaseAll(); });
  controls.querySelector('[data-action="reset"]')!.addEventListener('click', () => { debug.resume(); releaseAll(); motion.reset(true); wake(); });
  controls.querySelectorAll<HTMLButtonElement>('[data-drag-view]').forEach(button => button.addEventListener('click', () => {
    dragView = button.dataset.dragView!;
    controls.querySelectorAll<HTMLButtonElement>('[data-drag-view]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.dragView === dragView)));
    draw();
  }));
  new ResizeObserver(() => { draw(); debug.update(); }).observe(element.querySelector('.rose-scene')!);
  new IntersectionObserver(entries => { inView = entries[0].isIntersecting; if (inView) wake(); else releaseAll(); }).observe(element);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); else wake(); });
  return element;
}
