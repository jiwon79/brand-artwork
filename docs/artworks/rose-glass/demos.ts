import { GlassView, scenePoint } from './glass-view';
import { GlassBodyMotion } from '../../../pages/rose-glass/interaction';

const stages = [
  ['형태', '유리의 외곽 안을 기본색으로 채운 상태입니다. 아직 두께와 표면을 읽기 어렵습니다.'],
  ['음영', '표면의 방향에 따라 밝기를 바꾸고 그림자를 더합니다. 평면에 둥근 부피가 생겨 보입니다.'],
  ['가장자리', '가장자리의 빛 흡수와 뒤쪽 색의 비침을 더합니다. 불투명한 덩어리보다 유리처럼 느껴집니다.'],
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
  const { element, view } = createDemo('material-demo', '형태 위에 유리의 인상을 쌓기',
    '버튼을 순서대로 눌러 보세요. 앞 단계에 어떤 표현이 더해지는지 같은 형태에서 비교할 수 있습니다.');
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
  const { element, view } = createDemo('drag-demo', '잡은 곳 주변만 늘어나게 하기',
    '유리 위를 누른 채 끌어 보세요. 잡은 곳은 많이 움직이고 먼 곳은 덜 움직입니다. 손을 놓으면 원래 모습으로 돌아옵니다.');
  if (!view) return element;
  const motion = new GlassBodyMotion();
  const controls = element.querySelector('.rose-controls')!;
  controls.innerHTML = `<p class="rose-drag-status" aria-live="polite">유리 위를 잡아당겨 보세요.</p>
    <button type="button" data-action="pull">오른쪽으로 당겨 보기</button>
    <button type="button" data-action="release">손 놓기</button>
    <button type="button" data-action="reset">처음으로</button>
    <p class="demo-note">버튼으로도 당기기와 복원을 비교할 수 있습니다. 유리 표면의 무늬가 형태와 함께 따라가는 모습도 보세요.</p>`;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const pointers = new Set<number>();
  let frame = 0, previous = 0, inView = true, lastMode = '';
  const render = (now: number) => {
    frame = 0;
    if (!inView || document.hidden) return;
    const dt = Math.min((now - previous) / 1000 || 1 / 60, 1 / 30); previous = now;
    const active = motion.step(dt, 85, 1, { softness: 1.1, indentationDepth: 1, recovery: 1, stretchLimit: 430 }, reduced.matches);
    view.draw(motion); view.canvas.dataset.interaction = motion.mode;
    if (lastMode !== motion.mode) {
      lastMode = motion.mode;
      controls.querySelector('.rose-drag-status')!.textContent = motion.mode === 'dragging' ? '잡은 곳 주변이 늘어나고 있습니다.' : motion.mode === 'returning' ? '손을 놓아 원래 형태로 돌아오는 중입니다.' : '유리 위를 잡아당겨 보세요.';
    }
    if (active) wake();
  };
  const wake = () => { if (!frame && inView && !document.hidden) frame = requestAnimationFrame(render); };
  const releaseAll = () => {
    for (const id of pointers) { motion.release(id, reduced.matches); if (view.canvas.hasPointerCapture(id)) view.canvas.releasePointerCapture(id); }
    pointers.clear(); motion.release(-1, reduced.matches); wake();
  };
  const position = (event: PointerEvent) => {
    const rect = view.canvas.getBoundingClientRect();
    return scenePoint(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
  };
  view.canvas.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
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
    releaseAll(); motion.reset(true); motion.grab(-1, { x: 420, y: 645 }); motion.move(-1, { x: 600, y: 580 }); wake();
  });
  controls.querySelector('[data-action="release"]')!.addEventListener('click', releaseAll);
  controls.querySelector('[data-action="reset"]')!.addEventListener('click', () => { releaseAll(); motion.reset(true); wake(); });
  new ResizeObserver(() => view.draw(motion)).observe(element.querySelector('.rose-scene')!);
  new IntersectionObserver(entries => { inView = entries[0].isIntersecting; if (inView) wake(); else releaseAll(); }).observe(element);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); else wake(); });
  return element;
}
