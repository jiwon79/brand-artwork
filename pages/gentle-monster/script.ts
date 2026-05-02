import GUI from 'lil-gui';

interface ColorVariant {
  color_name: string | null;
  color_code: string | null;
  color_hex: string | null;
  images: string[];
}

interface Product {
  id: string;
  name_kr: string | null;
  name_en: string | null;
  category: string;
  collection: string | null;
  frame_shape: string | null;
  frame_color: string | null;
  lens_color: string | null;
  materials: string | null;
  url: string;
  price: number | null;
  color_variants: ColorVariant[];
}

type Angle = 'FRONT' | 'SIDE' | 'D_45';
const ANGLE_TO_INDEX: Record<Angle, number> = { FRONT: 0, SIDE: 1, D_45: 2 };

const COLS = 9;
const ROWS = 10;
const ROW_STEP_RATIO = 0.92;

const SCALE_MIN = 0.5;
const SCALE_MAX = 4;

const BOTTOM_PADDING = 96;
const SIDE_PADDING = 12;
const TOP_PADDING = 24;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

class Catalog {
  private stage = document.getElementById('stage') as HTMLElement;
  private scene = document.getElementById('scene') as HTMLElement;
  private loading = document.getElementById('loading') as HTMLElement;
  private items: HTMLElement[] = [];
  // 각 아이템 중심의 씬 공간 오프셋 (뷰포트 중앙 기준) — pan/zoom과 무관, resize 때만 갱신
  private gxCache: Float32Array = new Float32Array(0);
  private gyCache: Float32Array = new Float32Array(0);
  // opacity 마지막 값 — 변화 없으면 DOM write 스킵
  private lastOpCache: Float32Array = new Float32Array(0);
  private products: Product[] = [];
  private currentAngle: Angle = 'FRONT';
  private cellPx = 60;
  private viewportW = window.innerWidth;
  private viewportH = window.innerHeight;

  private sphereR = 600;   // 구 반지름 — 작을수록 곡률 강함
  private cameraD = 200;   // 카메라 거리 — 작을수록 원근감 강함

  // pan/zoom 상태
  private tx = 0;
  private ty = 0;
  private scale = 1;

  // rAF coalescing
  private renderQueued = false;

  private detailEl = document.getElementById('detail') as HTMLElement;
  private dimOverlay = document.getElementById('dim-overlay') as HTMLElement;
  private selectedIdx: number | null = null;
  private pointerDownPos: { x: number; y: number; time: number } | null = null;

  private waveCancel: (() => void) | null = null;

  private pointers = new Map<number, { x: number; y: number }>();
  private gestureStart: {
    tx: number;
    ty: number;
    scale: number;
    cx: number;
    cy: number;
    dist: number;
  } | null = null;

  private get panLimitX(): number {
    return ((COLS - 1) * this.cellPx) / 2;
  }
  private get panLimitY(): number {
    return ((ROWS - 1) * this.cellPx * ROW_STEP_RATIO) / 2;
  }

  async start(): Promise<void> {
    const url = new URL('assets/metadata.json', document.baseURI).href;
    const res = await fetch(url);
    if (!res.ok) {
      this.loading.textContent = `로드 실패 (HTTP ${res.status})`;
      return;
    }
    this.products = await res.json();
    this.measureViewport();
    this.computeCellSize();
    this.layout();
    this.applySceneTransform();
    this.bindInputs();
    this.bindAngleToggle();
    this.bindGui();
    this.bindDetail();
    window.addEventListener('resize', () => this.handleResize());
    await this.preloadAll();
    this.loading.classList.add('hidden');
  }

  private async preloadAll(): Promise<void> {
    const total = Math.min(COLS * ROWS, this.products.length);
    const angles: Angle[] = ['FRONT', 'SIDE', 'D_45'];
    const totalCount = total * angles.length;
    let loaded = 0;
    this.loading.textContent = `로딩 중… 0 / ${totalCount}`;
    const promises: Promise<void>[] = [];
    for (let i = 0; i < total; i++) {
      for (const angle of angles) {
        promises.push(
          this.preloadImage(this.imageSrc(this.products[i], angle, true)).then(() => {
            loaded++;
            this.loading.textContent = `로딩 중… ${loaded} / ${totalCount}`;
          })
        );
      }
    }
    await Promise.all(promises);
  }

  private preloadImage(src: string): Promise<void> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = src;
    });
  }

  private measureViewport(): void {
    this.viewportW = window.innerWidth;
    this.viewportH = window.innerHeight;
  }

  private computeCellSize(): void {
    const w = this.viewportW - SIDE_PADDING * 2;
    const h = this.viewportH - TOP_PADDING - BOTTOM_PADDING;
    const byWidth = w / 9.5;
    const byHeight = h / ((ROWS - 1) * ROW_STEP_RATIO + 1);
    this.cellPx = Math.floor(Math.min(byWidth, byHeight));
  }

  private handleResize(): void {
    this.measureViewport();
    this.computeCellSize();
    this.scene.style.setProperty('--cell', `${this.cellPx}px`);
    this.items.forEach((el, idx) => {
      const { x, y } = this.cellPosition(idx);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    });
    this.rebuildGeometryCache();
    this.applySceneTransform();
  }

  private cellPosition(idx: number): { x: number; y: number } {
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    const rowOffset = row % 2 === 0 ? 0 : this.cellPx / 2;
    // viewport 중앙 기준 + grid 셀 중심 위치 - 셀 크기 절반 (왼쪽 위 기준)
    const cellCenterX = (col - (COLS - 1) / 2) * this.cellPx + rowOffset;
    const cellCenterY = (row - (ROWS - 1) / 2) * this.cellPx * ROW_STEP_RATIO;
    const x = this.viewportW / 2 + cellCenterX - 128;
    const y = this.viewportH / 2 + cellCenterY - 128;
    return { x, y };
  }

  private layout(): void {
    this.scene.style.setProperty('--cell', `${this.cellPx}px`);
    const total = Math.min(COLS * ROWS, this.products.length);

    // DocumentFragment로 한 번에 추가 (reflow 최소화)
    const frag = document.createDocumentFragment();
    for (let i = 0; i < total; i++) {
      const product = this.products[i];
      const { x, y } = this.cellPosition(i);

      const el = document.createElement('div');
      el.className = 'item';
      el.dataset.index = String(i);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;

      // 3개 앵글 img를 전부 DOM에 올려두고 active class로만 토글 — src 교체 없음
      const angles: Angle[] = ['FRONT', 'SIDE', 'D_45'];
      for (const a of angles) {
        const img = document.createElement('img');
        img.alt = a === 'FRONT' ? (product.name_kr ?? product.id) : '';
        img.decoding = 'async';
        img.draggable = false;
        img.dataset.angle = a;
        img.src = this.imageSrc(product, a, true); // 그리드는 256px 썸네일
        if (a === this.currentAngle) img.classList.add('active');
        el.appendChild(img);
      }

      frag.appendChild(el);
      this.items.push(el);
    }
    this.scene.appendChild(frag);
    this.rebuildGeometryCache();
  }

  private imageSrc(product: Product, angle: Angle, thumb = false): string {
    const variant = product.color_variants[0];
    const idx = ANGLE_TO_INDEX[angle];
    const file = variant.images[idx] ?? variant.images[0];
    const dir = thumb ? 'thumbnails' : 'images';
    return new URL(`assets/${dir}/${encodeURIComponent(file)}`, document.baseURI).href;
  }

  private rebuildGeometryCache(): void {
    const len = this.items.length;
    if (this.gxCache.length !== len) {
      this.gxCache = new Float32Array(len);
      this.gyCache = new Float32Array(len);
      this.lastOpCache = new Float32Array(len).fill(-1); // -1 = 미설정 강제 첫 write
    }
    const cx = this.viewportW / 2;
    const cy = this.viewportH / 2;
    for (let i = 0; i < len; i++) {
      const pos = this.cellPosition(i);
      this.gxCache[i] = pos.x + 128 - cx;
      this.gyCache[i] = pos.y + 128 - cy;
    }
  }

  private applyItemDepths(): void {
    const items = this.items;
    const len = items.length;
    if (len === 0) return;
    const gx = this.gxCache;
    const gy = this.gyCache;
    const tx = this.tx;
    const ty = this.ty;
    const sScene = this.scale;
    const invScene = 1 / sScene;
    const cellScale = this.cellPx / 256;
    const R = this.sphereR;
    const D = this.cameraD;
    const invR = 1 / R;
    // 카메라에서 구로 그은 접선의 각도 — 이 너머는 구에 의해 가려짐
    const phiMax = Math.acos(R / (D + R));
    const fadeStart = phiMax * 0.85;
    const invFadeRange = 1 / (phiMax - fadeStart);
    const lastOp = this.lastOpCache;
    for (let i = 0; i < len; i++) {
      const item = items[i];
      const sox = gx[i] * sScene + tx;
      const soy = gy[i] * sScene + ty;
      const phi = Math.sqrt(sox * sox + soy * soy) * invR;
      // silhouette 너머 — 숨김 (opacity 캐시도 0으로)
      if (phi >= phiMax) {
        if (lastOp[i] !== 0) {
          item.style.transform = 'scale(0)';
          item.style.opacity = '0';
          lastOp[i] = 0;
        }
        continue;
      }
      const sinc = phi < 1e-4 ? 1 : Math.sin(phi) / phi;
      const pf = D / (D + R * (1 - Math.cos(phi)));
      const pull = (sinc * pf - 1) * invScene;
      const dx = sox * pull;
      const dy = soy * pull;
      // translateZ로 GPU compositor가 깊이 자동 정렬 (preserve-3d 부모 필요)
      const z3d = pf * 100;
      item.style.transform = `translate3d(${dx}px,${dy}px,${z3d}px) scale(${pf * cellScale})`;
      // opacity는 변화 시에만 write — 대부분 1이라 큰 절약
      const opacity = phi <= fadeStart ? 1 : (phiMax - phi) * invFadeRange;
      // 0.02 임계값으로 노이즈성 write 컷 — 시각 차이 무시 가능
      if (Math.abs(opacity - lastOp[i]) > 0.02) {
        item.style.opacity = opacity >= 0.999 ? '' : String(opacity);
        lastOp[i] = opacity;
      }
    }
  }

  /** rAF로 코얼레스 — pointermove가 1프레임에 여러 번 와도 transform은 한 번만 적용 */
  private requestRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.applySceneTransform();
    });
  }

  private applySceneTransform(): void {
    if (this.tx === 0 && this.ty === 0 && this.scale === 1) {
      this.scene.style.transform = 'translateZ(0)';
    } else {
      this.scene.style.transform = `translate3d(${this.tx}px, ${this.ty}px, 0) scale(${this.scale})`;
    }
    if (this.items.length > 0) this.applyItemDepths();
  }

  private bindInputs(): void {
    const onDown = (e: PointerEvent) => {
      if (this.selectedIdx !== null) return;
      // 드래그 시작 시 진행 중인 wave 즉시 취소 — rAF 경합 제거
      if (this.waveCancel) { this.waveCancel(); this.waveCancel = null; }
      try {
        this.stage.setPointerCapture(e.pointerId);
      } catch {}
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.pointerDownPos = { x: e.clientX, y: e.clientY, time: Date.now() };
      } else {
        this.pointerDownPos = null;
      }
      this.captureGestureStart();
    };

    const onMove = (e: PointerEvent) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!this.gestureStart) return;
      const ps = [...this.pointers.values()];

      if (ps.length === 1) {
        const dx = ps[0].x - this.gestureStart.cx;
        const dy = ps[0].y - this.gestureStart.cy;
        this.tx = clamp(
          this.gestureStart.tx + dx,
          -this.panLimitX * this.scale,
          this.panLimitX * this.scale,
        );
        this.ty = clamp(
          this.gestureStart.ty + dy,
          -this.panLimitY * this.scale,
          this.panLimitY * this.scale,
        );
      } else {
        const cx = (ps[0].x + ps[1].x) / 2;
        const cy = (ps[0].y + ps[1].y) / 2;
        const dist = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
        if (this.gestureStart.dist > 0) {
          const ratio = dist / this.gestureStart.dist;
          this.scale = clamp(
            this.gestureStart.scale * ratio,
            SCALE_MIN,
            SCALE_MAX,
          );
        }
        const dx = cx - this.gestureStart.cx;
        const dy = cy - this.gestureStart.cy;
        this.tx = clamp(
          this.gestureStart.tx + dx,
          -this.panLimitX * this.scale,
          this.panLimitX * this.scale,
        );
        this.ty = clamp(
          this.gestureStart.ty + dy,
          -this.panLimitY * this.scale,
          this.panLimitY * this.scale,
        );
      }
      this.requestRender();
    };

    const onUp = (e: PointerEvent) => {
      if (this.selectedIdx !== null) return;
      const wasClick =
        this.pointerDownPos !== null &&
        this.pointers.size === 1 &&
        Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y) < 8 &&
        Date.now() - this.pointerDownPos.time < 400;

      this.pointers.delete(e.pointerId);
      if (this.pointers.size > 0) {
        this.captureGestureStart();
        this.pointerDownPos = null;
        return;
      }
      this.gestureStart = null;
      this.pointerDownPos = null;

      if (wasClick) this.handleTap(e.clientX, e.clientY);
    };

    // passive 옵션으로 처리 비용 줄임 (preventDefault 불필요한 곳)
    this.stage.addEventListener('pointerdown', onDown);
    this.stage.addEventListener('pointermove', onMove);
    this.stage.addEventListener('pointerup', onUp);
    this.stage.addEventListener('pointercancel', onUp);

    this.stage.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        e.preventDefault();
        if (this.selectedIdx !== null) return;
        const delta = -e.deltaY * 0.001;
        this.scale = clamp(this.scale * Math.exp(delta), SCALE_MIN, SCALE_MAX);
        this.requestRender();
      },
      { passive: false },
    );
  }

  private captureGestureStart(): void {
    const ps = [...this.pointers.values()];
    if (ps.length === 0) {
      this.gestureStart = null;
      return;
    }
    if (ps.length === 1) {
      this.gestureStart = {
        tx: this.tx,
        ty: this.ty,
        scale: this.scale,
        cx: ps[0].x,
        cy: ps[0].y,
        dist: 0,
      };
    } else {
      this.gestureStart = {
        tx: this.tx,
        ty: this.ty,
        scale: this.scale,
        cx: (ps[0].x + ps[1].x) / 2,
        cy: (ps[0].y + ps[1].y) / 2,
        dist: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y),
      };
    }
  }

  /** geometry cache로 item의 화면 중심 좌표와 시각적 크기를 계산 — getBoundingClientRect 불필요 */
  private getItemScreenCenter(idx: number): { cx: number; cy: number; size: number } {
    const sox = this.gxCache[idx] * this.scale + this.tx;
    const soy = this.gyCache[idx] * this.scale + this.ty;
    const phi = Math.sqrt(sox * sox + soy * soy) / this.sphereR;
    const sinc = phi < 1e-4 ? 1 : Math.sin(phi) / phi;
    const pf = this.cameraD / (this.cameraD + this.sphereR * (1 - Math.cos(phi)));
    return {
      cx: this.viewportW / 2 + sox * sinc * pf,
      cy: this.viewportH / 2 + soy * sinc * pf,
      size: this.cellPx * pf * this.scale,
    };
  }

  private handleTap(x: number, y: number): void {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.items.length; i++) {
      const { cx, cy, size } = this.getItemScreenCenter(i);
      const half = size / 2;
      if (x >= cx - half && x <= cx + half && y >= cy - half && y <= cy + half) {
        const d = Math.hypot(x - cx, y - cy);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
    }
    if (bestIdx >= 0) this.showDetail(bestIdx);
  }

  private showDetail(idx: number): void {
    const product = this.products[idx];
    this.selectedIdx = idx;

    const detailImg = this.detailEl.querySelector('.detail-img') as HTMLImageElement;
    const thumbSrc = this.imageSrc(product, this.currentAngle, true);
    const fullSrc = this.imageSrc(product, this.currentAngle, false);
    detailImg.src = thumbSrc; // FLIP은 썸네일로 즉시 시작
    detailImg.alt = product.name_kr ?? product.id;
    // full-size를 백그라운드 로드 후 교체 — 화질 개선
    const preloadFull = new Image();
    preloadFull.onload = () => { if (this.selectedIdx === idx) detailImg.src = fullSrc; };
    preloadFull.src = fullSrc;

    (this.detailEl.querySelector('.detail-name-kr') as HTMLElement).textContent = product.name_kr ?? '';
    (this.detailEl.querySelector('.detail-name-en') as HTMLElement).textContent = product.name_en ?? product.id;

    const metaParts: string[] = [];
    if (product.collection) metaParts.push(product.collection);
    if (product.price) metaParts.push(`₩${product.price.toLocaleString()}`);
    (this.detailEl.querySelector('.detail-meta') as HTMLElement).textContent = metaParts.join(' · ');
    (this.detailEl.querySelector('.detail-cta') as HTMLAnchorElement).href = product.url;

    // FLIP: 아이템의 현재 위치에서 중앙으로 이동
    const imgWrap = this.detailEl.querySelector('.detail-img-wrap') as HTMLElement;
    const info = this.detailEl.querySelector('.detail-info') as HTMLElement;
    info.style.cssText = '';
    imgWrap.style.transition = 'none';
    imgWrap.style.transform = 'scale(1)';

    this.detailEl.classList.remove('hidden');

    // geometry cache로 item 화면 위치 계산 — contain:strict + display:none 환경에서 getBoundingClientRect 오동작 방지
    const { cx: itemCx, cy: itemCy, size: itemSize } = this.getItemScreenCenter(idx);
    const wrapRect = imgWrap.getBoundingClientRect();
    const wrapCx = (wrapRect.left + wrapRect.right) / 2;
    const wrapCy = (wrapRect.top + wrapRect.bottom) / 2;

    const tx = itemCx - wrapCx;
    const ty = itemCy - wrapCy;
    const s0 = itemSize / wrapRect.width;

    // 아이템 위치에서 시작, 원본은 숨겨서 단일 이미지처럼 보이게
    imgWrap.style.transform = `translate(${tx}px, ${ty}px) scale(${s0})`;
    this.items[idx].style.visibility = 'hidden';

    // 다음 프레임에 애니메이션 시작
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        imgWrap.style.transition = 'transform 360ms cubic-bezier(0.32, 0.72, 0, 1)';
        imgWrap.style.transform = 'scale(1)';
        this.dimOverlay.classList.add('active');
        this.detailEl.classList.add('visible');
      });
    });
  }

  private hideDetail(): void {
    if (this.selectedIdx === null) return;
    const idx = this.selectedIdx;
    this.selectedIdx = null;

    const imgWrap = this.detailEl.querySelector('.detail-img-wrap') as HTMLElement;
    const { cx: itemCx, cy: itemCy, size: itemSize } = this.getItemScreenCenter(idx);
    const wrapRect = imgWrap.getBoundingClientRect();

    const tx = itemCx - (wrapRect.left + wrapRect.right) / 2;
    const ty = itemCy - (wrapRect.top + wrapRect.bottom) / 2;
    const sEnd = itemSize / wrapRect.width;

    // info: CSS delay 없이 즉시 숨김 (delayed fade-out이 imgWrap 복귀 후까지 이어지는 버그 방지)
    const info = this.detailEl.querySelector('.detail-info') as HTMLElement;
    info.style.transition = 'none';
    info.style.opacity = '0';
    info.style.transform = 'translateY(8px)';

    this.detailEl.classList.remove('visible');
    this.dimOverlay.classList.remove('active');

    // img-wrap을 원래 아이템 위치로 돌려보냄
    imgWrap.style.transition = 'transform 240ms cubic-bezier(0.23, 1, 0.32, 1)';
    imgWrap.style.transform = `translate(${tx}px, ${ty}px) scale(${sEnd})`;

    imgWrap.addEventListener('transitionend', () => {
      this.detailEl.classList.add('hidden');
      imgWrap.style.transition = 'none';
      imgWrap.style.transform = 'scale(1)';
      this.items[idx].style.visibility = '';
    }, { once: true });
  }

  private navigateDetail(dir: -1 | 1): void {
    if (this.selectedIdx === null) return;
    const total = Math.min(COLS * ROWS, this.products.length);
    const newIdx = (this.selectedIdx + dir + total) % total;

    const detailImg = this.detailEl.querySelector<HTMLImageElement>('.detail-img')!;

    // 이전 아이템 grid 복원, 새 아이템 숨김
    this.items[this.selectedIdx].style.visibility = '';
    this.items[newIdx].style.visibility = 'hidden';
    this.selectedIdx = newIdx;

    const product = this.products[newIdx];

    // 썸네일 즉시 표시 후 full-size 백그라운드 로드
    detailImg.src = this.imageSrc(product, this.currentAngle, true);
    detailImg.alt = product.name_kr ?? product.id;
    const pre = new Image();
    pre.onload = () => { if (this.selectedIdx === newIdx) detailImg.src = this.imageSrc(product, this.currentAngle, false); };
    pre.src = this.imageSrc(product, this.currentAngle, false);

    (this.detailEl.querySelector('.detail-name-kr') as HTMLElement).textContent = product.name_kr ?? '';
    (this.detailEl.querySelector('.detail-name-en') as HTMLElement).textContent = product.name_en ?? product.id;
    const metaParts: string[] = [];
    if (product.collection) metaParts.push(product.collection);
    if (product.price) metaParts.push(`₩${product.price.toLocaleString()}`);
    (this.detailEl.querySelector('.detail-meta') as HTMLElement).textContent = metaParts.join(' · ');
    (this.detailEl.querySelector('.detail-cta') as HTMLAnchorElement).href = product.url;
  }

  private bindDetail(): void {
    this.detailEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.detail-cta') && !target.closest('.detail-nav')) this.hideDetail();
    });
    this.detailEl.querySelector('.detail-prev')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.navigateDetail(-1);
    });
    this.detailEl.querySelector('.detail-next')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.navigateDetail(1);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hideDetail();
      if (e.key === 'ArrowLeft' && this.selectedIdx !== null) this.navigateDetail(-1);
      if (e.key === 'ArrowRight' && this.selectedIdx !== null) this.navigateDetail(1);
    });
  }

  private bindGui(): void {
    const gui = new GUI({ title: 'Gentle Monster' });
    const update = () => this.applySceneTransform();
    gui.add(this, 'sphereR', 100, 2000, 10).name('Sphere Radius').onChange(update);
    gui.add(this, 'cameraD', 50, 800, 5).name('Camera Distance').onChange(update);
  }

  private bindAngleToggle(): void {
    const buttons = document.querySelectorAll<HTMLButtonElement>('#angle-toggle button');
    const slider = document.getElementById('angle-slider') as HTMLElement;

    const moveSlider = (btn: HTMLButtonElement) => {
      slider.style.width = `${btn.offsetWidth}px`;
      slider.style.height = `${btn.offsetHeight}px`;
      slider.style.transform = `translateX(${btn.offsetLeft}px) translateY(${btn.offsetTop}px)`;
    };

    // 초기 위치 — 트랜지션 없이 즉시 배치
    const initBtn = document.querySelector<HTMLButtonElement>('#angle-toggle button.active');
    if (initBtn) {
      slider.style.transition = 'none';
      moveSlider(initBtn);
      requestAnimationFrame(() => { slider.style.transition = ''; });
    }

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const angle = btn.dataset.angle as Angle;
        if (angle === this.currentAngle) return;
        this.currentAngle = angle;
        buttons.forEach((b) => b.classList.toggle('active', b === btn));
        moveSlider(btn);
        this.swapAngle(angle);
      });
    });
  }

  private swapAngle(angle: Angle): void {
    // 이전 wave 취소 — 중복 실행 방지
    if (this.waveCancel) { this.waveCancel(); this.waveCancel = null; }

    const cx = this.viewportW / 2;
    const cy = this.viewportH / 2;
    const MAX_STAGGER = 450;

    // tick 바깥에서 img 레퍼런스 미리 수집 — 루프 내 querySelectorAll 제거
    const sorted = this.items
      .map((item) => {
        const r = item.getBoundingClientRect();
        const dist = Math.hypot((r.left + r.right) / 2 - cx, (r.top + r.bottom) / 2 - cy);
        const newImg = item.querySelector<HTMLImageElement>(`img[data-angle="${angle}"]`)!;
        const activeImgs = Array.from(item.querySelectorAll<HTMLImageElement>('img.active'));
        return { dist, newImg, activeImgs };
      })
      .sort((a, b) => a.dist - b.dist);

    const n = sorted.length;
    const maxDist = sorted[n - 1]?.dist || 1;

    // 비활성 img는 display:none → GPU 텍스처 없음.
    // 표시 직전 decode()로 미리 압축 해제 (캐시 히트 = near-zero)
    const ready = new Uint8Array(n);
    sorted.forEach(({ newImg }, i) => {
      newImg.decode().then(() => { ready[i] = 1; }).catch(() => { ready[i] = 1; });
    });

    let cancelled = false;
    this.waveCancel = () => { cancelled = true; };

    const waveStart = performance.now();
    const pending = sorted.map(({ newImg, activeImgs, dist }, rank) => ({
      newImg,
      activeImgs,
      at: waveStart + (rank / (n - 1) * 0.6 + dist / maxDist * 0.4) * MAX_STAGGER,
      rank,
    }));

    const tick = (now: number) => {
      if (cancelled) return;
      let i = pending.length;
      while (i--) {
        const e = pending[i];
        if (now >= e.at && ready[e.rank]) {
          e.newImg.classList.add('active');
          for (const img of e.activeImgs) img.classList.remove('active');
          pending.splice(i, 1);
        }
      }
      if (pending.length > 0) requestAnimationFrame(tick);
      else this.waveCancel = null;
    };
    requestAnimationFrame(tick);

    if (this.selectedIdx !== null) {
      const detailImg = this.detailEl.querySelector<HTMLImageElement>('.detail-img');
      if (detailImg) detailImg.src = this.imageSrc(this.products[this.selectedIdx], angle, false);
    }
  }
}

new Catalog().start().catch((err) => {
  const loading = document.getElementById('loading') as HTMLElement;
  loading.textContent = `에러: ${err}`;
  console.error(err);
});
