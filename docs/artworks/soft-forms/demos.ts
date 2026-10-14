import { ribbonGeometry, shellDistance, SHELL_COUNT, type Point } from './demo-geometry';

const coral = '#b64e3c';
const blue = '#3b687a';
const ink = '#36352f';

function slider(id: string, name: string, min: number, max: number, step: number, value: number) {
  return `<label class="slider-label" for="${id}"><span>${name}</span><output for="${id}" id="${id}-value">${value}</output></label>
    <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" />`;
}

function number(section: HTMLElement, id: string): number {
  return Number(section.querySelector<HTMLInputElement>(`#${id}`)!.value);
}

function setText(section: HTMLElement, id: string, text: string) {
  section.querySelector(`#${id}`)!.textContent = text;
}

function section(id: string, label: string, title: string, description: string): HTMLElement {
  const element = document.createElement('section');
  element.className = 'interactive-demo';
  element.id = id;
  element.setAttribute('aria-labelledby', `${id}-title`);
  element.innerHTML = `<div class="demo-heading"><p class="eyebrow">${label} · 직접 조작하기</p>
    <h3 id="${id}-title">${title}</h3><p>${description}</p></div>`;
  return element;
}

/** Draw only on input/resize; no background animation or WebGL is needed. */
function canvasView(section: HTMLElement, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = section.querySelector('canvas')!;
  const context = canvas.getContext('2d');
  if (!context) {
    canvas.replaceWith(Object.assign(document.createElement('p'), { textContent: '이 브라우저에서는 도식을 그릴 수 없습니다. 아래 수치와 본문 도식을 확인하세요.' }));
    return () => {};
  }
  const paint = () => {
    const pixelRatio = Math.min(devicePixelRatio, 2);
    const width = canvas.clientWidth;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(width * 320 / 640 * pixelRatio);
    context.setTransform(canvas.width / 640, 0, 0, canvas.height / 320, 0, 0);
    context.clearRect(0, 0, 640, 320);
    context.font = `${width < 480 ? 22 : 14}px system-ui, sans-serif`;
    context.lineWidth = 1;
    draw(context);
  };
  new ResizeObserver(paint).observe(canvas);
  return paint;
}

function line(ctx: CanvasRenderingContext2D, from: Point, to: Point) {
  ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
}

function point(ctx: CanvasRenderingContext2D, p: Point, radius = 3) {
  ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill();
}

export function createShellDemo(): HTMLElement {
  const element = section('shell-demo', '01 / SHELL', '겹 사이의 간격을 살펴보기',
    '선 하나는 털 한 가닥이 아니라, 몸체 밖에 복제한 표면 한 겹의 단면입니다. 층을 선택하고 지수를 바꿔 보세요.');
  element.insertAdjacentHTML('beforeend', `<div class="demo-figure">
    <canvas role="img" aria-label="몸체 단면 위의 셸 13개. 선택한 층은 붉은 실선, 나머지 층은 점선으로 표시됩니다."></canvas>
    <p class="figure-caption">위쪽은 몸체 바깥 · 거리를 일정 배율로 확대 · 곡선은 설명용 표면</p>
    </div><div class="demo-controls">
      <div>${slider('shell-layer', '선택한 셸 인덱스', 0, 12, 1, 6)}</div>
      <div>${slider('shell-exponent', '간격 지수 p', 0.4, 2.6, 0.1, 1.3)}</div>
      <button type="button" class="reset-button">작품 값으로 되돌리기</button>
    </div><div class="demo-readout" aria-live="polite" aria-atomic="true">
      <span>정규화 높이 ℓ <strong id="shell-height"></strong></span>
      <span>몸체와의 거리 h <strong id="shell-distance"></strong></span>
      <span>이전 층과의 간격 <strong id="shell-gap"></strong></span>
    </div><p class="demo-equation" id="shell-calculation"></p>
    <p class="demo-note" id="shell-observation"></p>
    <p class="demo-note">작품은 13개 셸과 p=1.3을 사용합니다. 도식에서는 D를 위 방향으로 고정하지만, 작품에서는 점마다 원본 단위구 방향을 사용합니다. 노이즈와 불투명도는 재현하지 않으며, 최외곽 셸은 작품에서 불투명도 0이지만 위치를 볼 수 있도록 표시합니다.</p>`);
  const paint = canvasView(element, ctx => {
    const selected = number(element, 'shell-layer');
    const exponent = number(element, 'shell-exponent');
    const curveY = (x: number, distance: number) => 226 + ((x - 320) / 240) ** 2 * 34 - distance * 4;
    const curve = (distance: number) => {
      ctx.beginPath();
      for (let x = 64; x <= 576; x += 4) {
        if (x === 64) ctx.moveTo(x, curveY(x, distance));
        else ctx.lineTo(x, curveY(x, distance));
      }
    };
    curve(0); ctx.lineTo(576, 306); ctx.lineTo(64, 306); ctx.closePath();
    ctx.fillStyle = '#e5ded2'; ctx.fill();
    curve(0); ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.stroke();
    for (let i = 0; i < SHELL_COUNT; i++) {
      curve(shellDistance(i, exponent));
      ctx.setLineDash(i === selected ? [] : [3, 5]);
      ctx.strokeStyle = i === selected ? coral : '#9f9990';
      ctx.lineWidth = i === selected ? 3 : 1;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const distance = shellDistance(selected, exponent);
    const y = curveY(320, distance);
    ctx.fillStyle = coral; point(ctx, { x: 320, y }, 4);
    ctx.fillText(`선택 ${selected} / ℓ = ${(selected / 12).toFixed(2)}`, 66, 42);
    ctx.fillStyle = ink; ctx.fillText('몸체 B', 280, 284);
    ctx.strokeStyle = coral; ctx.lineWidth = 1;
    line(ctx, { x: 320, y: 226 }, { x: 320, y });
    line(ctx, { x: 314, y }, { x: 326, y });
    ctx.fillText(`h = ${distance.toFixed(2)}`, 338, (226 + y) / 2 + 5);
    ctx.fillStyle = blue; ctx.fillText('기준 방향 D ↑', 454, 42);
  });
  const update = () => {
    const index = number(element, 'shell-layer'), exponent = number(element, 'shell-exponent');
    const height = index / 12, distance = shellDistance(index, exponent);
    setText(element, 'shell-layer-value', String(index));
    setText(element, 'shell-exponent-value', exponent.toFixed(1));
    setText(element, 'shell-height', height.toFixed(3));
    setText(element, 'shell-distance', `${distance.toFixed(2)} 단위`);
    setText(element, 'shell-gap', index === 0 ? '첫 번째 층' : `${(distance - shellDistance(index - 1, exponent)).toFixed(2)} 단위`);
    setText(element, 'shell-calculation', `h = 0.5 + 29 × (${index}/12)^${exponent.toFixed(1)} = ${distance.toFixed(2)}`);
    setText(element, 'shell-observation', exponent === 1 ? 'p=1: 모든 이웃 층의 간격이 같습니다.' : exponent > 1 ? 'p>1: 안쪽 층은 촘촘하고, 바깥쪽으로 갈수록 간격이 넓어집니다.' : '0<p<1: 안쪽 간격이 넓고, 바깥쪽으로 갈수록 간격이 좁아집니다.');
    paint();
  };
  element.addEventListener('input', update);
  element.querySelector('button')!.addEventListener('click', () => {
    element.querySelector<HTMLInputElement>('#shell-layer')!.value = '6';
    element.querySelector<HTMLInputElement>('#shell-exponent')!.value = '1.3';
    update();
  });
  update();
  return element;
}

export function createRibbonDemo(): HTMLElement {
  const element = section('ribbon-demo', '02 / RIBBON', '선분에 폭을 더해 한 가닥 만들기',
    '뿌리와 끝 사이에 분할점 5개를 놓고, 각 점의 양옆으로 폭을 더합니다. 점 10개가 삼각형 8개를 만듭니다.');
  element.insertAdjacentHTML('beforeend', `<div class="demo-figure">
    <canvas role="img" aria-label="카메라 공간에서 본 리본과 길이별 반폭 그래프. 정점과 삼각형 연결을 표시합니다."></canvas>
    <p class="figure-caption">왼쪽: 카메라 공간의 리본을 확대 · 오른쪽: 길이별 반폭 w(t)</p>
    </div><div class="demo-controls ribbon-controls">
      <div>${slider('ribbon-width', '뿌리 반폭 w₀', 0.2, 2, 0.01, 0.63)}</div>
      <div>${slider('ribbon-bend', '중간 휨 b', -2.25, 2.25, 0.05, 1.2)}</div>
      <div>${slider('ribbon-angle', '카메라 쪽 기울기', 0, 90, 1, 25)}</div>
      <button type="button" class="reset-button">처음 값으로 되돌리기</button>
    </div><label class="mesh-toggle"><input type="checkbox" id="ribbon-mesh" checked /> 정점·삼각형 연결 보기</label>
    <div class="demo-readout" aria-live="polite" aria-atomic="true">
      <span>투영한 축 길이 <strong id="ribbon-projected"></strong></span>
      <span>분할점 <strong>5개</strong></span><span>삼각형 <strong>8개</strong></span>
    </div><p class="demo-equation">w(t) = w₀ × (1−t)^1.4 · 휨(t) = b × sin(πt)</p>
    <div class="station-values" id="ribbon-stations"></div>
    <p class="demo-note" id="ribbon-observation"></p>
    <p class="demo-note">설명용 가닥의 길이는 25단위입니다. 작품의 반폭 범위는 0.49~0.77단위이며, 데모에서는 비교를 위해 범위를 넓혔습니다. 불투명도·조명·주변 가닥은 생략합니다. 카메라 기울기는 뿌리–끝 축을 카메라 쪽으로 회전한 각도입니다.</p>`);
  const geometry = () => ribbonGeometry(number(element, 'ribbon-angle'), number(element, 'ribbon-width'), number(element, 'ribbon-bend'));
  const paint = canvasView(element, ctx => {
    const result = geometry();
    const small = element.querySelector('canvas')!.clientWidth < 480;
    const screen = (p: Point): Point => ({ x: 230 + p.x * 8, y: 276 - p.y * 8 });
    const mesh = element.querySelector<HTMLInputElement>('#ribbon-mesh')!.checked;
    ctx.strokeStyle = '#dad4c9'; ctx.setLineDash([3, 4]);
    line(ctx, { x: 230, y: 64 }, { x: 230, y: 286 });
    ctx.setLineDash([]);
    for (let i = 0; i < result.stations.length - 1; i++) {
      const a = result.stations[i], b = result.stations[i + 1];
      const triangles = [[a.left, a.right, b.left], [b.left, a.right, b.right]];
      for (const triangle of triangles) {
        const points = triangle.map(screen);
        ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
        points.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.closePath();
        ctx.fillStyle = '#b64e3c40'; ctx.fill();
        if (mesh) { ctx.strokeStyle = coral; ctx.lineWidth = 1; ctx.stroke(); }
      }
    }
    ctx.strokeStyle = blue; ctx.lineWidth = 1.5;
    ctx.beginPath(); result.stations.forEach((s, i) => {
      const p = screen(s.center); if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }); ctx.stroke();
    ctx.font = `${small ? 20 : 12}px system-ui, sans-serif`;
    result.stations.forEach(s => {
      const p = screen(s.center);
      if (mesh) {
        ctx.fillStyle = coral; point(ctx, screen(s.left)); point(ctx, screen(s.right));
        if (result.projectedLength > 12) { ctx.fillStyle = ink; ctx.fillText(`t=${s.t}`, p.x + 32, p.y + 4); }
      }
    });
    ctx.font = `${small ? 22 : 14}px system-ui, sans-serif`; ctx.fillStyle = ink;
    ctx.fillText('카메라 공간', 66, 32);
    ctx.fillText('뿌리 R', 202, 305);
    const tip = screen(result.tip);
    ctx.fillText('끝 T', tip.x - 20, tip.y - 15);
    ctx.fillStyle = blue; ctx.fillText('반폭 w(t)', 438, 32);
    ctx.strokeStyle = '#a7a197'; ctx.lineWidth = 1;
    line(ctx, { x: 440, y: 76 }, { x: 440, y: 276 });
    line(ctx, { x: 440, y: 276 }, { x: 590, y: 276 });
    ctx.strokeStyle = coral; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      const x = 440 + number(element, 'ribbon-width') * (1 - t) ** 1.4 * 70;
      const y = 276 - t * 200;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = ink; ctx.font = `${small ? 20 : 12}px system-ui, sans-serif`;
    ctx.fillText('끝 t=1', 440, 63); ctx.fillText('뿌리 t=0', 440, 305);
    ctx.fillText('0', 435, 291); ctx.fillText('2 단위', 564, 291);
  });
  const update = () => {
    const result = geometry();
    for (const id of ['ribbon-width', 'ribbon-bend', 'ribbon-angle']) {
      setText(element, `${id}-value`, id === 'ribbon-angle' ? `${number(element, id)}°` : number(element, id).toFixed(2));
    }
    setText(element, 'ribbon-projected', `${result.projectedLength.toFixed(2)} 단위`);
    element.querySelector('#ribbon-stations')!.innerHTML = result.stations.map(s => `<span>t=${s.t}<strong>${s.halfWidth.toFixed(3)}</strong></span>`).join('');
    setText(element, 'ribbon-observation', result.fallback
      ? '90°: 뿌리와 끝이 화면의 같은 위치에 겹칩니다. 셰이더는 폭 방향을 화면 X축으로 대체합니다. 길이가 사라져 리본의 면적도 0이 됩니다.'
      : '기울기가 커질수록 투영한 길이는 짧아집니다. 폭은 카메라 공간에서 더하므로 함께 줄어들지 않습니다. 휨은 뿌리와 끝에서 0입니다.');
    paint();
  };
  element.addEventListener('input', update);
  element.querySelector('button')!.addEventListener('click', () => {
    for (const [id, value] of [['ribbon-width', '0.63'], ['ribbon-bend', '1.2'], ['ribbon-angle', '25']]) {
      element.querySelector<HTMLInputElement>(`#${id}`)!.value = value;
    }
    element.querySelector<HTMLInputElement>('#ribbon-mesh')!.checked = true;
    update();
  });
  update();
  return element;
}
