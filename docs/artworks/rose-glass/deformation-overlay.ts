import { applyDeformation, foregroundGlassShape, glassBodyWidthAt, rotate, type Point } from '../../../pages/rose-glass/deformation';
import type { GlassBodyMotion } from '../../../pages/rose-glass/interaction';
import { outlinePoint } from './outline-demo';

export function drawDeformationOverlay(canvas: HTMLCanvasElement, motion: GlassBodyMotion, zoom = 1) {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return;
  const ratio = Math.min(devicePixelRatio, 2); canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d')!; ctx.scale(ratio, ratio);
  const scale = Math.min(width / 590, height / 1280) * zoom;
  const screen = (p: Point) => ({ x: width / 2 + (p.x + foregroundGlassShape.x - 295) * scale, y: height / 2 + (p.y + foregroundGlassShape.y - 640) * scale });
  const moved = (p: Point) => { const q = rotate(applyDeformation(p, motion), motion.angle); return { x: q.x + motion.x, y: q.y + motion.y }; };
  const inside = (p: Point) => {
    const v = p.y / foregroundGlassShape.height, u = (p.x - p.y * foregroundGlassShape.shear) / glassBodyWidthAt(2, v);
    return Math.abs(u) ** foregroundGlassShape.exponent + Math.abs(v) ** foregroundGlassShape.exponent <= 1;
  };
  ctx.strokeStyle = '#645c4f'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.beginPath();
  for (let i = 0; i <= 180; i++) {
    const p = screen(outlinePoint(i / 180 * 2 * Math.PI, foregroundGlassShape.exponent, 3));
    if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke(); ctx.setLineDash([]); ctx.strokeStyle = '#235c9a77';
  for (const vertical of [true, false]) for (let fixed = -375; fixed <= 375; fixed += 75) {
    ctx.beginPath(); let pen = false;
    for (let variable = -390; variable <= 390; variable += 6) {
      const p = vertical ? { x: fixed, y: variable } : { x: variable, y: fixed };
      if (!inside(p)) { pen = false; continue; }
      const q = screen(moved(p)); if (pen) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); pen = true;
    }
    ctx.stroke();
  }
  const center = motion.deformationFields[0]?.center;
  if (!center) return;
  for (const offset of [{ x: 0, y: 0 }, { x: -100, y: -140 }, { x: -280, y: 140 }]) {
    const p = { x: center.x + offset.x, y: center.y + offset.y };
    if (!inside(p)) continue;
    const a = screen(p), b = screen(moved(p));
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = 'white'; ctx.lineWidth = 4; ctx.stroke(); ctx.strokeStyle = '#235c9a'; ctx.lineWidth = 2; ctx.stroke();
    for (const [q, filled] of [[a, false], [b, true]] as const) {
      ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, 2 * Math.PI); ctx.fillStyle = filled ? '#235c9a' : 'white'; ctx.fill(); ctx.stroke();
    }
  }
}
