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
  private cameraD = 900;   // 카메라 거리 — 작을수록 원근감 강함

  // pan/zoom 상태
  private tx = 0;
  private ty = 0;
  private scale = 1;

  // rAF coalescing
  private renderQueued = false;

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
    window.addEventListener('resize', () => this.handleResize());
    requestAnimationFrame(() => this.loading.classList.add('hidden'));
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
    const x = this.viewportW / 2 + cellCenterX - this.cellPx / 2;
    const y = this.viewportH / 2 + cellCenterY - this.cellPx / 2;
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

      const img = document.createElement('img');
      img.alt = product.name_kr ?? product.id;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.draggable = false;
      img.src = this.imageSrc(product, this.currentAngle);
      el.appendChild(img);

      frag.appendChild(el);
      this.items.push(el);
    }
    this.scene.appendChild(frag);
    this.rebuildGeometryCache();
  }

  private imageSrc(product: Product, angle: Angle): string {
    const variant = product.color_variants[0];
    const idx = ANGLE_TO_INDEX[angle];
    const file = variant.images[idx] ?? variant.images[0];
    return new URL(`assets/images/${encodeURIComponent(file)}`, document.baseURI).href;
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
    const half = this.cellPx / 2;
    for (let i = 0; i < len; i++) {
      const pos = this.cellPosition(i);
      this.gxCache[i] = pos.x + half - cx;
      this.gyCache[i] = pos.y + half - cy;
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
      item.style.transform = `translate3d(${dx}px,${dy}px,${z3d}px) scale(${pf})`;
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
      try {
        this.stage.setPointerCapture(e.pointerId);
      } catch {}
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
      this.pointers.delete(e.pointerId);
      if (this.pointers.size > 0) {
        this.captureGestureStart();
        return;
      }
      this.gestureStart = null;
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

  private bindGui(): void {
    const gui = new GUI({ title: 'Gentle Monster' });
    const update = () => this.applySceneTransform();
    gui.add(this, 'sphereR', 100, 2000, 10).name('Sphere Radius').onChange(update);
    gui.add(this, 'cameraD', 200, 3000, 10).name('Camera Distance').onChange(update);
  }

  private bindAngleToggle(): void {
    const buttons = document.querySelectorAll<HTMLButtonElement>('#angle-toggle button');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const angle = btn.dataset.angle as Angle;
        if (angle === this.currentAngle) return;
        this.currentAngle = angle;
        buttons.forEach((b) => b.classList.toggle('active', b === btn));
        this.swapAngle(angle);
      });
    });
  }

  private swapAngle(angle: Angle): void {
    this.items.forEach((item, idx) => {
      const product = this.products[idx];
      const img = item.querySelector('img') as HTMLImageElement;
      img.src = this.imageSrc(product, angle);
    });
  }
}

new Catalog().start().catch((err) => {
  const loading = document.getElementById('loading') as HTMLElement;
  loading.textContent = `에러: ${err}`;
  console.error(err);
});
