import GUI, { type Controller } from 'lil-gui';
import { CORE_PALETTE, PALETTE, PETAL_PALETTE } from './reference-layout';

const ranges = {
  exposure: [0.3, 1.6, 0.01], saturation: [0, 1.5, 0.01],
  petalRoughness: [0.2, 1, 0.01], coreRoughness: [0.2, 1, 0.01], smileyRoughness: [0.2, 1, 0.01],
  specular: [0, 1, 0.01], environment: [0, 1.5, 0.01],
  key: [0, 8, 0.05], fill: [0, 3, 0.05], rim: [0, 3, 0.05],
  azimuth: [-85, 85, 1], elevation: [10, 80, 1], spread: [0.5, 5, 0.1], falloff: [0, 0.7, 0.01],
} satisfies Record<string, [number, number, number]>;
type NumericKey = keyof typeof ranges;
type ColorKey = keyof typeof PALETTE;
export type LookSettings = Record<NumericKey, number> & {
  toneMapping: 'ACES' | 'AgX' | 'Neutral';
  lightColor: string; rimColor: string; strokeColor: string;
  petals: Record<keyof typeof PETAL_PALETTE, string>;
  cores: Record<ColorKey, string>;
  smileys: Record<ColorKey, string>;
};

export function createLook(): LookSettings {
  return {
    exposure: 0.9, saturation: 1,
    petalRoughness: 0.76, coreRoughness: 0.74, smileyRoughness: 0.76,
    specular: 0.28, environment: 0.14, key: 4.45, fill: 0.55, rim: 0.9,
    azimuth: Math.atan2(-3, 3.5) * 180 / Math.PI,
    elevation: Math.asin(5 / Math.sqrt(46.25)) * 180 / Math.PI,
    spread: 3.2, falloff: 0.3, toneMapping: 'ACES',
    lightColor: '#fff1fb', rimColor: '#eee4ea', strokeColor: '#62576a',
    petals: { ...PETAL_PALETTE }, cores: { ...CORE_PALETTE }, smileys: { ...PALETTE },
  };
}

export function createLookControls(look: LookSettings, onChange: () => void) {
  const panel = document.querySelector<HTMLElement>('#look-panel')!;
  const toggle = document.querySelector<HTMLButtonElement>('.look-button')!;
  const close = panel.querySelector<HTMLButtonElement>('.look-close')!;
  const feedback = panel.querySelector<HTMLElement>('.look-feedback')!;
  const events = new AbortController();
  const gui = new GUI({ container: panel.querySelector<HTMLElement>('.look-gui')!, closeFolders: true });
  gui.$title.hidden = true;
  function label(controller: Controller, name: string) {
    controller.name(name);
    controller.domElement.querySelectorAll('input, select').forEach(input => input.setAttribute('aria-label', name));
    return controller;
  }
  function number(folder: GUI, key: NumericKey, name: string) {
    return label(folder.add(look, key, ...ranges[key]).decimals(2), name);
  }
  number(gui, 'exposure', '전체 밝기');
  number(gui, 'saturation', '전체 채도');
  label(gui.add(look, 'toneMapping', {
    '기본 대비 (ACES)': 'ACES', '부드러운 대비 (AgX)': 'AgX', '색상 유지 (Neutral)': 'Neutral',
  }), '밝은 색 처리');
  const material = gui.addFolder('재질 · 무광과 반사');
  number(material, 'petalRoughness', '꽃잎 무광 정도');
  number(material, 'coreRoughness', '중앙 무광 정도');
  number(material, 'smileyRoughness', '스마일 무광 정도');
  number(material, 'specular', '반사 강도');
  number(material, 'environment', '주변 빛 반사');
  const lighting = gui.addFolder('조명 · 방향과 음영');
  number(lighting, 'key', '주 조명 밝기');
  number(lighting, 'fill', '그림자 채우기');
  number(lighting, 'rim', '테두리 조명');
  number(lighting, 'azimuth', '좌우 방향');
  number(lighting, 'elevation', '조명 높이');
  number(lighting, 'spread', '그림자 부드러움');
  number(lighting, 'falloff', '위아래 밝기 차이');
  label(lighting.addColor(look, 'lightColor'), '주 조명 색');
  const petals = gui.addFolder('꽃잎 · 기본색');
  for (const [key, name] of [['W', '흰 꽃잎'], ['R', '연분홍 꽃잎'], ['P', '분홍 꽃잎']]) {
    label(petals.addColor(look.petals, key), name);
  }
  label(petals.addColor(look, 'rimColor'), '중앙 테두리');
  label(petals.addColor(look, 'strokeColor'), '선과 점');
  const colorNames = { B: '파랑', I: '하늘', G: '초록', Y: '노랑', R: '빨강', P: '분홍', L: '연두', W: '연보라' };
  for (const [group, title] of [['cores', '중앙 · 기본색'], ['smileys', '스마일 · 기본색']] as const) {
    const folder = gui.addFolder(title);
    for (const key of Object.keys(colorNames) as ColorKey[]) label(folder.addColor(look[group], key), colorNames[key]);
  }
  gui.onChange(() => { feedback.textContent = ''; onChange(); });
  const actions = {
    reset() {
      const initial = createLook();
      Object.assign(look.petals, initial.petals);
      Object.assign(look.cores, initial.cores);
      Object.assign(look.smileys, initial.smileys);
      Object.assign(look, { ...initial, petals: look.petals, cores: look.cores, smileys: look.smileys });
      gui.controllersRecursive().forEach(controller => controller.updateDisplay());
      onChange();
      feedback.textContent = '기본값으로 되돌렸습니다.';
    },
    async copy() {
      try {
        await navigator.clipboard.writeText(JSON.stringify(look, null, 2));
        feedback.textContent = '설정을 복사했습니다. 이 값을 보내면 같은 모습으로 맞출 수 있습니다.';
      } catch { feedback.textContent = '설정을 복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.'; }
    },
  };
  label(gui.add(actions, 'reset'), '기본값으로 되돌리기');
  label(gui.add(actions, 'copy'), '설정 복사');
  function setOpen(open: boolean) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) close.focus();
    else toggle.focus();
  }
  toggle.addEventListener('click', () => setOpen(panel.hidden), { signal: events.signal });
  close.addEventListener('click', () => setOpen(false), { signal: events.signal });
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') setOpen(false); }, { signal: events.signal });
  return () => { events.abort(); gui.destroy(); };
}
