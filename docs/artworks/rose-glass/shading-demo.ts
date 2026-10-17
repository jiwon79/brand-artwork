import { fragmentSource } from '../../../pages/rose-glass/shader';
import { foregroundGlassShape, glassBodyWidthAt } from '../../../pages/rose-glass/deformation';
import { GlassBodyMotion } from '../../../pages/rose-glass/interaction';
import { GlassView } from './glass-view';
import { inspectionShader } from './pixel-inspection';
import { colorHex, shadingRegions } from './shading-regions';
import { initialShadingState, reduceShadingState, type ShadingAction, type ShadingState } from './shading-state';

export function createShadingDemo() {
  const element = document.createElement('section'); element.id = 'shading-pixels'; element.className = 'interactive-demo shading-demo';
  element.setAttribute('aria-labelledby', 'shading-pixels-title');
  element.innerHTML = `<div class="demo-heading"><h3 id="shading-pixels-title">음영 쌓기</h3></div>
    <div class="shading-layout"><figure class="shading-preview"><div class="rose-scene"><span class="region-marker" aria-hidden="true">1</span></div><figcaption aria-live="polite"></figcaption></figure>
    <div class="shade-panel">
      <div class="shade-effects" role="group" aria-label="적용할 효과">${[['색 영역', 1], ['대각선 띠', 2], ['옆면 어둠', 4]].map(([label, bit]) => `<label class="shade-switch"><span>${label}${bit === 1 ? '<small>8곳</small>' : ''}</span><input type="checkbox" role="switch" data-effect="${bit}" aria-label="${label}" /><span class="switch-track" aria-hidden="true"></span></label>`).join('')}</div>
      <div class="shade-presets"><button type="button" data-all="0">전체 끄기</button><button type="button" data-all="1">전체 켜기</button></div>
      <div class="shade-view" role="group" aria-label="보기 모드"><label><input type="radio" name="shade-view" value="color" checked />합친 색</label><label><input type="radio" name="shade-view" value="weight" />강도</label></div>
      <label class="shade-inspect-label" for="shade-inspect">강도 보기 대상</label><select id="shade-inspect"><option value="1">선택한 색 영역</option><option value="2">대각선 띠</option><option value="3">옆면 어둠</option></select>
      <label class="region-select-label" for="shade-region">색 영역</label><select id="shade-region">${shadingRegions.map((region, index) => `<option value="${index}">${region.label}</option>`).join('')}</select>
      <div class="region-color"><span class="region-swatch" aria-hidden="true"></span><span class="region-color-label"></span></div>
      <output class="region-info" aria-live="polite"></output>
    </div></div>
    <p class="demo-note">보기 모드는 효과 스위치와 독립적으로 유지됩니다. 강도는 선택한 계산의 영향 분포입니다. 6~8번은 색 성분을 더하거나 빼는 보정 영역입니다.</p>`;
  const host = element.querySelector<HTMLElement>('.rose-scene')!;
  let view: GlassView;
  try { view = new GlassView(host, '음영 합성 및 선택한 색 영역', inspectionShader(fragmentSource, 'shading')); }
  catch { host.textContent = '음영 데모를 표시하지 못했습니다. WebGL 2 지원을 확인하세요.'; return element; }
  view.stage = 2; view.previewZoom = 1.4;
  const motion = new GlassBodyMotion();
  let state: ShadingState = { ...initialShadingState };
  const update = () => {
    const region = shadingRegions[state.region], hex = colorHex(region.color);
    const baseScale = Math.min(host.clientWidth / 590, host.clientHeight / 1280);
    if (baseScale > 0) view.previewZoom = Math.min((host.clientWidth - 16) / 560, (host.clientHeight - 24) / 800) / baseScale;
    view.debugEffects = state.effects; view.debugMode = state.view === 'color' ? 0 : state.inspect; view.debugRegion = state.region; view.draw(motion);
    element.querySelectorAll<HTMLInputElement>('[data-effect]').forEach(input => { input.checked = Boolean(state.effects & Number(input.dataset.effect)); });
    element.querySelectorAll<HTMLInputElement>('[name="shade-view"]').forEach(input => { input.checked = input.value === state.view; });
    element.querySelector<HTMLSelectElement>('#shade-region')!.value = String(state.region);
    element.querySelector<HTMLSelectElement>('#shade-inspect')!.value = String(state.inspect);
    element.querySelectorAll<HTMLElement>('#shade-inspect, .shade-inspect-label').forEach(item => { item.hidden = state.view === 'color'; });
    element.querySelector<HTMLElement>('.region-swatch')!.style.backgroundColor = hex;
    const operation = region.operation === 'mix' ? '목표색' : region.operation === 'add' ? '더하는 RGB' : '빼는 RGB';
    element.querySelector('.region-color-label')!.textContent = `${operation} ${hex.toUpperCase()}`;
    element.querySelector('.region-info')!.textContent = `중심 (${region.center[0].toFixed(2)}, ${region.center[1].toFixed(2)})${region.operation === 'mix' ? ` · ${(region.strength * 100).toFixed(0)}% 혼합` : ''}`;
    const marker = element.querySelector<HTMLElement>('.region-marker')!;
    marker.textContent = String(state.region + 1); marker.hidden = state.view === 'weight' && state.inspect !== 1;
    const scale = Math.min(host.clientWidth / 590, host.clientHeight / 1280) * view.previewZoom;
    const materialY = region.center[1] * foregroundGlassShape.height;
    marker.style.left = `${host.clientWidth / 2 + (foregroundGlassShape.x + region.center[0] * glassBodyWidthAt(2, region.center[1]) + materialY * foregroundGlassShape.shear - 295) * scale}px`;
    marker.style.top = `${host.clientHeight / 2 + (foregroundGlassShape.y + materialY - 640) * scale}px`;
    const label = state.view === 'color' ? '합친 색' : state.inspect === 1 ? `${state.region + 1}번 영역 강도` : state.inspect === 2 ? '대각선 띠 강도' : '옆면 어둠 강도';
    const inspectedBit = state.inspect === 1 ? 1 : state.inspect === 2 ? 2 : 4;
    element.querySelector('figcaption')!.textContent = `${label}${state.view === 'color' || state.inspect === 1 ? ` · ${state.region + 1}번 중심` : ''}${state.view === 'weight' && !(state.effects & inspectedBit) ? ' · 효과 꺼짐' : ''}`;
    view.canvas.setAttribute('aria-label', label);
    element.querySelectorAll<HTMLButtonElement>('[data-all]').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.all === '0' ? state.effects === 0 : state.effects === 7)); });
  };
  const dispatch = (action: ShadingAction) => { state = reduceShadingState(state, action); update(); };
  element.querySelectorAll<HTMLInputElement>('[data-effect]').forEach(input => input.addEventListener('change', () => dispatch({ type: 'effect', bit: Number(input.dataset.effect), enabled: input.checked })));
  element.querySelectorAll<HTMLButtonElement>('[data-all]').forEach(button => button.addEventListener('click', () => dispatch({ type: 'all', enabled: button.dataset.all === '1' })));
  element.querySelectorAll<HTMLInputElement>('[name="shade-view"]').forEach(input => input.addEventListener('change', () => dispatch({ type: 'view', value: input.value as ShadingState['view'] })));
  element.querySelector('#shade-region')!.addEventListener('change', event => dispatch({ type: 'region', value: Number((event.target as HTMLSelectElement).value) }));
  element.querySelector('#shade-inspect')!.addEventListener('change', event => dispatch({ type: 'inspect', value: Number((event.target as HTMLSelectElement).value) as ShadingState['inspect'] }));
  new ResizeObserver(update).observe(host); update(); return element;
}
