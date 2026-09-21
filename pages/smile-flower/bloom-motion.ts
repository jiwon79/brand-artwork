import { CELLS } from './reference-layout';

type Point = { x: number; y: number };
type Focus = Point & { strength: number; held: boolean };

export function createBloomMotion() {
  const focuses = new Map<number, Focus>();
  const layout = CELLS.map(cell => ({ x: cell.x, y: cell.y, scale: 1 }));
  function reset() {
    focuses.clear();
    layout.forEach((pose, i) => Object.assign(pose, { x: CELLS[i].x, y: CELLS[i].y, scale: 1 }));
  }
  return {
    layout,
    hold(pointerId: number, index: number) {
      focuses.set(pointerId, { x: CELLS[index].x, y: CELLS[index].y, strength: 1, held: true });
    },
    move(pointerId: number, point: Point) {
      const focus = focuses.get(pointerId);
      if (focus?.held) { focus.x = point.x; focus.y = point.y; }
    },
    release(pointerId: number) {
      const focus = focuses.get(pointerId);
      if (focus) focus.held = false;
    },
    reset,
    advance(delta: number, reducedMotion: boolean) {
      let changed = false;
      const blend = reducedMotion ? 1 : -Math.expm1(-8 * delta);
      for (const [id, focus] of focuses) {
        if (focus.held) continue;
        focus.strength *= reducedMotion ? 0 : Math.exp(-1.7 * delta);
        if (focus.strength < 0.0001) focuses.delete(id);
      }
      let strength = 0;
      for (const focus of focuses.values()) strength = Math.max(strength, focus.strength);
      const before = layout.map(pose => ({ ...pose }));
      for (const [index, cell] of CELLS.entries()) {
        let influence = 0;
        let closest: Focus | undefined;
        let best = 0;
        for (const focus of focuses.values()) {
          const distanceSquared = (cell.x - focus.x) ** 2 + (cell.y - focus.y) ** 2;
          const local = focus.strength * Math.exp(-distanceSquared / 2.7);
          influence = Math.max(influence, local);
          const weight = focus.strength * Math.exp(-distanceSquared / 12);
          if (weight > best) { best = weight; closest = focus; }
        }
        // A continuous radial profile keeps the first ring visible. The broader
        // displacement profile opens a little room instead of erasing neighbors.
        const target = {
          scale: 1 - 0.45 * strength + 1.85 * influence,
          x: cell.x + (closest ? (cell.x - closest.x) * 1.08 * best : 0),
          y: cell.y + (closest ? (cell.y - closest.y) * 1.08 * best : 0),
        };
        const pose = layout[index];
        for (const key of ['x', 'y', 'scale'] as const) {
          const next = pose[key] + (target[key] - pose[key]) * blend;
          pose[key] = Math.abs(next - target[key]) < 0.0001 ? target[key] : next;
        }
      }
      // Preserve every scale; only resolve remaining contacts (mostly where two
      // finger regions meet). Large central models resist displacement more.
      if (strength > 0 || layout.some(pose => pose.scale !== 1)) {
        for (let pass = 0; pass < 40; pass++) {
          let worst = 0;
          for (let i = 0; i < layout.length; i++) for (let j = i + 1; j < layout.length; j++) {
            const a = layout[i], b = layout[j];
            const dx = b.x - a.x, dy = b.y - a.y;
            const distance = Math.hypot(dx, dy);
            const overlap = (0.98 + 0.02 * strength) * (a.scale + b.scale) + 0.04 * strength - distance;
            if (overlap <= 0.00001) continue;
            worst = Math.max(worst, overlap);
            const nx = distance > 1e-8 ? dx / distance : 1;
            const ny = distance > 1e-8 ? dy / distance : 0;
            const weightA = 1 / a.scale ** 4, weightB = 1 / b.scale ** 4;
            const shiftA = overlap * weightA / (weightA + weightB);
            const shiftB = overlap - shiftA;
            a.x -= nx * shiftA; a.y -= ny * shiftA;
            b.x += nx * shiftB; b.y += ny * shiftB;
          }
          if (worst < 0.0001) break;
        }
      }
      layout.forEach((pose, index) => {
        if (pose.scale !== before[index].scale || pose.x !== before[index].x || pose.y !== before[index].y) changed = true;
      });
      return changed;
    },
  };
}
