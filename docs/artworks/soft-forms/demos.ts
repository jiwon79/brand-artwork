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
    canvas.replaceWith(Object.assign(document.createElement('p'), { textContent: '이 브라우저에서는 도식을 그릴 수 없습니다. 본문의 설명과 그림을 확인하세요.' }));
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
  const element = section('shell-demo', '01 / SHELL', '몸체 밖에 얇은 층을 겹치기',
    '층을 고르고 안쪽·바깥쪽 배치 밀도를 바꿔 보세요.');
  element.insertAdjacentHTML('beforeend', `<div class="demo-figure">
    <canvas role="img" aria-label="몸체 단면 위의 셸 13개. 선택한 층은 붉은 실선, 나머지 층은 점선으로 표시됩니다."></canvas>
    <p class="figure-caption">위쪽은 몸체 바깥 · 거리를 일정 배율로 확대 · 곡선은 설명용 표면</p>
    </div><div class="demo-controls">
      <div>${slider('shell-layer', '살펴볼 층', 0, 12, 1, 6)}</div>
      <div>${slider('shell-exponent', '층을 모으는 쪽', 0.4, 2.6, 0.1, 1.3)}</div>
      <button type="button" class="reset-button">처음으로</button>
    </div><p class="demo-note" id="shell-observation" aria-live="polite"></p>
    <p class="demo-note">선 하나는 한 층의 단면입니다. 이 그림은 층의 배치를 보여줍니다. 실제 작품에서는 층에 잔무늬와 투명도를 더해 부드러운 털 덩어리로 보이게 합니다.</p>`);
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
    ctx.fillText('선택한 층', 66, 42);
    ctx.fillStyle = ink; ctx.fillText('몸체', 290, 284);
    ctx.strokeStyle = coral; ctx.lineWidth = 1;
    line(ctx, { x: 320, y: 226 }, { x: 320, y });
    line(ctx, { x: 314, y }, { x: 326, y });
    ctx.fillText('층의 두께', 338, (226 + y) / 2 + 5);
    ctx.fillStyle = blue; ctx.fillText('몸체 바깥 ↑', 454, 42);
  });
  const update = () => {
    const index = number(element, 'shell-layer'), exponent = number(element, 'shell-exponent');
    setText(element, 'shell-layer-value', index < 4 ? '안쪽' : index < 9 ? '중간' : '바깥쪽');
    setText(element, 'shell-exponent-value', exponent === 1 ? '고르게' : exponent > 1 ? '안쪽' : '바깥쪽');
    setText(element, 'shell-observation', exponent === 1 ? '층을 고르게 배치한 모습입니다.' : exponent > 1 ? '몸체 가까이에 층이 모여 있습니다. 안쪽의 두께를 촘촘히 채우는 배치입니다.' : '바깥쪽에 층이 모여 있습니다. 안쪽으로 갈수록 층 사이가 넓어집니다.');
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
  const element = section('ribbon-demo', '02 / RIBBON', '가느다란 띠로 한 가닥 만들기',
    '굵기·휨·기울기를 바꾸며 가닥의 형태를 비교하세요.');
  element.insertAdjacentHTML('beforeend', `<div class="demo-figure">
    <canvas role="img" aria-label="화면을 향해 펼친 털 리본. 뿌리에서 끝으로 갈수록 좁아지는 모습입니다."></canvas>
    <p class="figure-caption">붉은 면은 가닥의 폭 · 파란 선은 가닥의 중심 · 설명을 위해 확대</p>
    </div><div class="demo-controls ribbon-controls">
      <div>${slider('ribbon-width', '가닥의 굵기', 0.2, 2, 0.01, 0.63)}</div>
      <div>${slider('ribbon-bend', '가닥의 휨', -2.25, 2.25, 0.05, 1.2)}</div>
      <div>${slider('ribbon-angle', '카메라 쪽 기울기', 0, 90, 1, 25)}</div>
      <button type="button" class="reset-button">처음으로</button>
    </div><p class="demo-note" id="ribbon-observation" aria-live="polite"></p>
    <p class="demo-note">실제 작품에서는 이런 띠를 몸체 표면에 많이 붙입니다. 셸이 안쪽의 두께를 채우고, 리본이 외곽의 가닥을 보여줍니다.</p>`);
  const geometry = () => ribbonGeometry(number(element, 'ribbon-angle'), number(element, 'ribbon-width'), number(element, 'ribbon-bend'));
  const paint = canvasView(element, ctx => {
    const result = geometry();
    const small = element.querySelector('canvas')!.clientWidth < 480;
    const screen = (p: Point): Point => ({ x: 320 + p.x * 8, y: 276 - p.y * 8 });
    ctx.strokeStyle = '#dad4c9'; ctx.setLineDash([3, 4]);
    line(ctx, { x: 320, y: 64 }, { x: 320, y: 286 });
    ctx.setLineDash([]);
    for (let i = 0; i < result.stations.length - 1; i++) {
      const a = result.stations[i], b = result.stations[i + 1];
      const triangles = [[a.left, a.right, b.left], [b.left, a.right, b.right]];
      for (const triangle of triangles) {
        const points = triangle.map(screen);
        ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
        points.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.closePath();
        ctx.fillStyle = '#b64e3c40'; ctx.fill();
      }
    }
    ctx.strokeStyle = blue; ctx.lineWidth = 1.5;
    ctx.beginPath(); result.stations.forEach((s, i) => {
      const p = screen(s.center); if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }); ctx.stroke();
    const outline = [...result.stations.map(s => s.left), ...[...result.stations].reverse().map(s => s.right)];
    ctx.beginPath(); outline.forEach((p, i) => {
      const projected = screen(p);
      if (i === 0) ctx.moveTo(projected.x, projected.y); else ctx.lineTo(projected.x, projected.y);
    }); ctx.closePath(); ctx.strokeStyle = coral; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = `${small ? 22 : 14}px system-ui, sans-serif`; ctx.fillStyle = ink;
    ctx.fillText('화면에서 본 한 가닥', 66, 32);
    ctx.fillText('뿌리', 302, 305);
    const tip = screen(result.tip);
    ctx.fillText('끝', tip.x - 8, tip.y - 15);
  });
  const update = () => {
    const result = geometry();
    const width = number(element, 'ribbon-width'), bend = number(element, 'ribbon-bend'), angle = number(element, 'ribbon-angle');
    setText(element, 'ribbon-width-value', width < 0.6 ? '가늘게' : width < 1.2 ? '중간' : '굵게');
    setText(element, 'ribbon-bend-value', Math.abs(bend) < 0.1 ? '곧게' : bend > 0 ? '왼쪽으로' : '오른쪽으로');
    setText(element, 'ribbon-angle-value', angle < 30 ? '옆으로' : angle < 75 ? '비스듬히' : '카메라를 향해');
    setText(element, 'ribbon-observation', result.fallback
      ? '가닥이 카메라를 똑바로 향하면 뿌리와 끝이 겹쳐 보여 길이가 사라집니다. 이런 가닥 사이의 빈 공간은 셸이 채워줍니다.'
      : '가닥이 카메라를 향할수록 화면에서 보이는 길이는 짧아집니다. 하지만 폭은 화면 쪽으로 펼치므로 함께 줄어들지 않습니다.');
    paint();
  };
  element.addEventListener('input', update);
  element.querySelector('button')!.addEventListener('click', () => {
    for (const [id, value] of [['ribbon-width', '0.63'], ['ribbon-bend', '1.2'], ['ribbon-angle', '25']]) {
      element.querySelector<HTMLInputElement>(`#${id}`)!.value = value;
    }
    update();
  });
  update();
  return element;
}
