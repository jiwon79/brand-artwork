import type { DicePaint, Point } from './field';

export const PROCESS_STEPS = [
  { id: 'stroke', label: 'Stroke' },
  { id: 'coverage', label: 'Coverage' },
  { id: 'face', label: 'Face' },
  { id: 'rotation', label: 'Rotation' },
  { id: 'final', label: 'Final' },
] as const;
export type ProcessStage = typeof PROCESS_STEPS[number]['id'];
export const STAGE_DESCRIPTIONS: Record<ProcessStage, string> = {
  stroke: '드래그 경로 · 파랑은 느리게, 주황은 빠르게',
  coverage: '선이 각 칸을 덮은 정도 → 밝기',
  face: '밝기 → 1–6 눈 선택',
  rotation: '드래그 방향과 속도 → 회전 · 선택한 면으로 정렬',
  final: '재질 · 조명 · 눈의 발광',
};
const PIPS = [
  [[0, 0]], [[-1, 1], [1, -1]], [[-1, 1], [0, 0], [1, -1]],
  [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  [[-1, -1], [-1, 1], [0, 0], [1, -1], [1, 1]],
  [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
];

/** Stores normalized input separately from the live paint simulation. */
export class ProcessView {
  readonly canvas = document.createElement('canvas');
  private context: CanvasRenderingContext2D;
  private segments: Array<{ a: Point; b: Point; speed: number; thickness: number }> = [];
  constructor() {
    this.canvas.className = 'process-canvas';
    this.canvas.hidden = true;
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.dataset.touchPointerIgnore = 'true';
    this.context = this.canvas.getContext('2d')!;
    document.querySelector('main')!.append(this.canvas);
  }
  record(a: Point, b: Point, velocity: Point, width: number, height: number, thickness = 1) {
    this.segments.push({
      a: { x: a.x / width, y: a.y / height },
      b: { x: b.x / width, y: b.y / height },
      thickness,
      speed: Math.min(1, Math.log1p(Math.hypot(velocity.x, velocity.y) / 6) / Math.log(9)),
    });
  }
  reset() { this.segments = []; }
  draw(stage: ProcessStage, paint: DicePaint, height: number, source: HTMLCanvasElement) {
    const flat = stage === 'stroke' || stage === 'coverage' || stage === 'face';
    this.canvas.hidden = !flat;
    if (!flat) return;
    const w = source.clientWidth;
    const h = source.clientHeight;
    const ratio = Math.min(devicePixelRatio, 2);
    if (this.canvas.width !== Math.round(w * ratio) || this.canvas.height !== Math.round(h * ratio)) {
      this.canvas.width = Math.round(w * ratio);
      this.canvas.height = Math.round(h * ratio);
    }
    const ctx = this.context;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = '#080a10';
    ctx.fillRect(0, 0, w, h);
    const unit = h / height;
    for (const state of paint.states) {
      const x = w / 2 + state.cell.x * unit;
      const y = h / 2 - state.cell.y * unit;
      const size = unit * 0.86;
      const shade = Math.round(state.luminance * 255);
      ctx.fillStyle = stage === 'coverage' ? `rgb(${shade},${shade},${shade})` : '#151922';
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      if (stage !== 'face') continue;
      ctx.fillStyle = state.luminance > 0 ? '#f4f7ff' : '#343b49';
      for (const [px, py] of PIPS[state.face - 1]) {
        ctx.beginPath();
        ctx.arc(x + px * size * 0.25, y - py * size * 0.25, size * 0.065, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (stage !== 'stroke') return;
    this.segments.forEach((segment, index) => {
      const ax = (segment.a.x + 0.5) * w;
      const ay = (0.5 - segment.a.y) * h;
      const bx = (segment.b.x + 0.5) * w;
      const by = (0.5 - segment.b.y) * h;
      ctx.strokeStyle = `hsl(${205 - segment.speed * 180} 90% 65%)`;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = Math.max(2, unit * 0.07 * segment.thickness);
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      if (ax === bx && ay === by) { ctx.beginPath(); ctx.arc(ax, ay, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); }
      if (index % 8 !== 0 || Math.hypot(bx - ax, by - ay) < 0.5) return;
      const angle = Math.atan2(by - ay, bx - ax);
      ctx.save(); ctx.translate(bx, by); ctx.rotate(angle);
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill();
      ctx.restore();
    });
  }
  dispose() { this.canvas.remove(); }
}
