const stages = [
  '00 · 배경', '01 · 위쪽 유리', '02 · 아래쪽 유리', '03 · 중앙 형태',
  '04 · 입체 음영과 그림자', '05 · 두꺼운 외곽', '06 · 조명과 반사',
  '07 · 서리 질감', '08 · 블러 · 완성',
];
const definitions = [
  ['upper', '위쪽 유리', 1], ['lower', '아래쪽 유리', 2], ['front', '중앙 형태', 3],
  ['material', '입체 색과 내부 음영', 4], ['shadows', '드롭 섀도', 4],
  ['edges', '외곽의 흡수와 투과', 5], ['lighting', '조명과 반사', 6],
  ['grain', '서리 질감', 7], ['blur', '점진적 블러', 8],
] as const;
export const layers = { upper: true, lower: true, front: true, material: true,
  shadows: true, edges: true, lighting: true, grain: true, blur: true };

// These controls gate the real shader contributions, not screenshots or overlays.
export function createPresentation(wake: () => void, reduced: MediaQueryList) {
  let stage = 8, timer: ReturnType<typeof setInterval> | undefined;
  const toolbar = document.createElement('nav');
  toolbar.className = 'build-toolbar';
  toolbar.setAttribute('aria-label','렌더링 누적 단계');
  toolbar.setAttribute('data-touch-pointer-ignore','');
  const button = (label: string, text: string) => {
    const element = document.createElement('button');
    element.type = 'button'; element.setAttribute('aria-label',label); element.textContent = text;
    return element;
  };
  const previous = button('이전 렌더링 단계','‹');
  const next = button('다음 렌더링 단계','›');
  const play = button('렌더링 단계 자동 재생','재생');
  const toggle = button('렌더링 레이어 열기','레이어');
  const select = document.createElement('select');
  select.setAttribute('aria-label','렌더링 단계');
  stages.forEach((label,i) => select.add(new Option(label,String(i))));
  select.add(new Option('직접 조합','-1'));
  const panel = document.createElement('section');
  panel.id = 'render-layers'; panel.className = 'build-layers'; panel.hidden = true;
  panel.setAttribute('aria-label','렌더링 레이어');
  toggle.setAttribute('aria-controls',panel.id); toggle.setAttribute('aria-expanded','false');
  const title = document.createElement('strong'); title.textContent = '쌓이는 순서';
  const hint = document.createElement('p'); hint.textContent = '효과가 하나씩 더해집니다. 각 레이어를 따로 켜고 끌 수도 있어요.';
  panel.append(title,hint);
  const inputs = definitions.map(([key,label]) => {
    const row = document.createElement('label'), input = document.createElement('input');
    input.type = 'checkbox'; input.checked = true;
    row.append(input,document.createTextNode(label)); panel.append(row);
    input.addEventListener('change',() => { stop(); layers[key] = input.checked; stage = -1; sync(); wake(); });
    return { key, input };
  });
  function sync() {
    select.value = String(stage);
    previous.disabled = stage === 0; next.disabled = stage === 8;
    inputs.forEach(({key,input}) => { input.checked = layers[key]; });
  }
  function stop() { clearInterval(timer); timer = undefined; play.textContent = '재생'; play.setAttribute('aria-pressed','false'); }
  function apply(value: number) {
    stage = value;
    definitions.forEach(([key,,from]) => { layers[key] = stage >= from; });
    sync(); wake();
  }
  previous.addEventListener('click',() => { stop(); apply(Math.max(0,stage < 0 ? 7 : stage-1)); });
  next.addEventListener('click',() => { stop(); apply(Math.min(8,stage+1)); });
  select.addEventListener('change',() => { stop(); if (select.value !== '-1') apply(Number(select.value)); else { stage = -1; sync(); } });
  play.setAttribute('aria-pressed','false');
  play.addEventListener('click',() => {
    if (timer) { stop(); return; }
    apply(0); play.textContent = '정지'; play.setAttribute('aria-pressed','true');
    timer = setInterval(() => { apply(stage+1); if (stage === 8) stop(); },reduced.matches ? 2400 : 1500);
  });
  toggle.addEventListener('click',() => {
    panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded',String(!panel.hidden));
  });
  document.addEventListener('visibilitychange',() => { if (document.hidden) stop(); });
  toolbar.append(previous,select,next,play,toggle,panel);
  document.body.append(toolbar);
  sync();
}
