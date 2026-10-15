import { foregroundGlassShape, glassBodyWidthAt } from '../../../pages/rose-glass/deformation';

/** f=1 sampled radially; the later stages use the production profile and shear. */
export function outlinePoint(angle: number, exponent: number, stage: number) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const r = (Math.abs(c) ** exponent + Math.abs(s) ** exponent) ** (-1 / exponent);
  const u = c * r, v = s * r;
  if (stage === 0) return { x: u, y: v };
  const y = v * foregroundGlassShape.height;
  const width = stage >= 2 ? glassBodyWidthAt(2, v) : foregroundGlassShape.width;
  return { x: u * width + (stage >= 3 ? y * foregroundGlassShape.shear : 0), y };
}

export function createOutlineDemo() {
  const element = document.createElement('section');
  element.id = 'outline-demo'; element.className = 'interactive-demo';
  element.setAttribute('aria-labelledby', 'outline-demo-title');
  element.innerHTML = `<div class="demo-heading"><p class="eyebrow">외곽선 · 단계별로 비교하기</p>
    <h3 id="outline-demo-title">둥근 기본 도형이 앞쪽 유리가 되기까지</h3>
    <p>지수는 모서리의 둥근 정도를 바꿉니다. 같은 지수에 크기, 위아래 폭, 기울기를 차례로 적용해 보세요.</p></div>
    <label class="slider-label" for="outline-exponent"><span>지수 n</span><output id="outline-exponent-value" for="outline-exponent"></output></label>
    <input id="outline-exponent" type="range" min="2" max="4" step="0.01" value="2.45" />
    <div class="touch-presets" role="group" aria-label="지수 비교"><button type="button" data-exponent="2">2 · 원</button><button type="button" data-exponent="2.45">2.45 · 현재 값</button><button type="button" data-exponent="3">3 · 더 각지게</button></div>
    <div class="outline-panels"></div>
    <p class="demo-note outline-readout" aria-live="polite"></p>
    <p class="demo-note">각 패널의 점선은 직전 단계입니다. ①은 단위 좌표, ②~④는 같은 축척의 작품 좌표입니다. 중심 이동·드래그·음영은 제외했습니다. 원래 작품의 지수는 2.45로 유지됩니다.</p>`;
  const panels = element.querySelector('.outline-panels')!;
  const labels = ['① 기본 외곽선 f=1', '② 가로·세로 크기 적용', '③ 아래로 갈수록 좁히기', '④ 아래쪽을 오른쪽으로'];
  const canvases = labels.map(label => {
    const panel = document.createElement('figure');
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 420;
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', label);
    const caption = document.createElement('figcaption'); caption.textContent = label;
    panel.append(canvas, caption); panels.append(panel); return canvas;
  });
  const input = element.querySelector<HTMLInputElement>('#outline-exponent')!;
  const update = () => {
    const n = Number(input.value);
    element.querySelector('#outline-exponent-value')!.textContent = n.toFixed(2);
    element.querySelectorAll<HTMLButtonElement>('[data-exponent]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.exponent) === n)));
    canvases.forEach((canvas, stage) => {
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, 320, 420);
      const scale = stage === 0 ? 125 : .46;
      ctx.strokeStyle = '#ded6c7'; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(15, 210); ctx.lineTo(305, 210); ctx.moveTo(160, 15); ctx.lineTo(160, 405); ctx.stroke();
      const path = (which: number) => {
        ctx.beginPath();
        for (let i = 0; i <= 240; i++) {
          const point = outlinePoint(i / 240 * Math.PI * 2, n, which);
          // Stage ① has its own unit scale; later panels share the artwork scale.
          const factor = which === 0 && stage > 0 ? foregroundGlassShape.width : 1;
          const x = 160 + point.x * factor * scale, y = 210 + point.y * factor * scale;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
      };
      if (stage > 0) { path(stage - 1); ctx.strokeStyle = '#857d70'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]); ctx.stroke(); }
      path(stage); ctx.setLineDash([]); ctx.fillStyle = '#b96c5422'; ctx.fill(); ctx.strokeStyle = '#a65042'; ctx.lineWidth = 2.5; ctx.stroke();
    });
    const diagonal = 2 ** (-1 / n);
    element.querySelector('.outline-readout')!.textContent = `기본 도형의 대각선 위 점: u=v=${diagonal.toFixed(3)}. 2uⁿ=1에서 u=2^(−1/n)을 구합니다. 지수가 커지면 이 점이 (1,1)에 가까워져 모서리가 차오릅니다.`;
  };
  input.addEventListener('input', update);
  element.querySelectorAll<HTMLButtonElement>('[data-exponent]').forEach(button => button.addEventListener('click', () => { input.value = button.dataset.exponent!; update(); }));
  update(); return element;
}
