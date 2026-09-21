import { createStepper } from '../../common/stepper';

const stages = [
  { id: '0', label: '00 배경' }, { id: '1', label: '01 형태' },
  { id: '2', label: '02 음영' }, { id: '3', label: '03 외곽' },
  { id: '4', label: '04 조명' }, { id: '5', label: '05 질감' },
  { id: '6', label: '06 완성' },
] as const;
type Stage = typeof stages[number]['id'];
const definitions = [
  ['upper', '위쪽 유리', 1], ['lower', '아래쪽 유리', 1], ['front', '중앙 형태', 1],
  ['material', '입체 색과 내부 음영', 2], ['shadows', '드롭 섀도', 2],
  ['edges', '외곽의 흡수와 투과', 3], ['lighting', '조명과 반사', 4],
  ['grain', '서리 질감', 5], ['blur', '점진적 블러', 6],
] as const;
export const layers = { upper: true, lower: true, front: true, material: true,
  shadows: true, edges: true, lighting: true, grain: true, blur: true };

// Stage selection, URL state and pointer/keyboard activation belong to the
// shared stepper. This adapter only applies Rose Glass's shader contributions.
export function createPresentation(wake: () => void, reduced: MediaQueryList) {
  let timer: ReturnType<typeof setInterval> | undefined, advancing = false;
  const toolbar = document.createElement('nav');
  toolbar.className = 'build-toolbar';
  toolbar.setAttribute('aria-label','렌더링 재생과 레이어');
  toolbar.setAttribute('data-touch-pointer-ignore','');
  const button = (label: string, text: string) => {
    const element = document.createElement('button');
    element.type = 'button'; element.setAttribute('aria-label',label); element.textContent = text;
    return element;
  };
  const play = button('렌더링 단계 자동 재생','재생');
  const toggle = button('렌더링 레이어 열기','레이어');
  const panel = document.createElement('section');
  panel.id = 'render-layers'; panel.className = 'build-layers'; panel.hidden = true;
  panel.setAttribute('aria-label','렌더링 레이어');
  toggle.setAttribute('aria-controls',panel.id); toggle.setAttribute('aria-expanded','false');
  const title = document.createElement('strong'); title.textContent = '쌓이는 순서';
  const hint = document.createElement('p');
  hint.textContent = '형태 세 개 위에 효과가 하나씩 더해집니다.';
  panel.append(title,hint);
  let custom = false;
  const inputs = definitions.map(([key,label]) => {
    const row = document.createElement('label'), input = document.createElement('input');
    input.type = 'checkbox'; input.checked = true;
    row.append(input,document.createTextNode(label)); panel.append(row);
    input.addEventListener('change',() => {
      stop(); layers[key] = input.checked; custom = true;
      hint.textContent = '직접 조합 중 · 선택한 단계의 레이어를 수정했습니다.';
      wake();
    });
    return { key, input };
  });
  function stop() { clearInterval(timer); timer = undefined; play.textContent = '재생'; play.setAttribute('aria-pressed','false'); }
  function apply(id: Stage) {
    if (!advancing) stop();
    custom = false;
    definitions.forEach(([key,,from]) => { layers[key] = Number(id) >= from; });
    inputs.forEach(({key,input}) => { input.checked = layers[key]; });
    hint.textContent = '형태 세 개 위에 효과가 하나씩 더해집니다.';
    wake();
  }
  const stepper = createStepper({
    steps: stages, initialStep: '6', onChange: apply,
    ariaLabel: '렌더링 누적 단계', keyboard: false,
  });
  // Re-selecting the current preset also restores it after manual layer edits.
  stepper.element.addEventListener('pointerdown',() => {
    if (custom) apply(stepper.currentStep);
  },true);
  stepper.element.addEventListener('click',(event) => {
    if (custom && event.detail === 0) apply(stepper.currentStep);
  },true);
  play.setAttribute('aria-pressed','false');
  play.addEventListener('click',() => {
    if (timer) { stop(); return; }
    advancing = true; stepper.select('0'); apply('0'); advancing = false;
    play.textContent = '정지'; play.setAttribute('aria-pressed','true');
    timer = setInterval(() => {
      advancing = true; stepper.next(); advancing = false;
      if (stepper.currentStep === '6') stop();
    },reduced.matches ? 2400 : 1500);
  });
  toggle.addEventListener('click',() => {
    panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded',String(!panel.hidden));
  });
  document.addEventListener('visibilitychange',() => { if (document.hidden) stop(); });
  toolbar.append(play,toggle,panel);
  document.body.append(toolbar);
}
