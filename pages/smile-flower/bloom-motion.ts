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
        for (const focus of focuses.values()) {
          const distance = Math.hypot(cell.x - focus.x, cell.y - focus.y);
          influence = Math.max(influence, focus.strength * Math.exp(-(distance ** 2) / 7));
        }
        const scale = 1 - 0.45 * strength + 1.85 * influence;
        const pose = layout[index];
        const target = { x: cell.x, y: cell.y, scale };
        for (const key of ['x', 'y', 'scale'] as const) {
          const next = pose[key] + (target[key] - pose[key]) * blend;
          pose[key] = Math.abs(next - target[key]) < 0.0001 ? target[key] : next;
        }
      }
      // Resolve actual displayed circles every frame, including movement and release.
      // Larger models move less, so neighboring petals make room around the focus.
      if (strength > 0 || layout.some(pose => pose.scale !== 1)) {
        for (let pass = 0; pass < 80; pass++) {
          let overlap = 0;
          for (let i = 0; i < layout.length; i++) for (let j = i + 1; j < layout.length; j++) {
            const a = layout[i], b = layout[j];
            const dx = b.x - a.x, dy = b.y - a.y;
            const distance = Math.hypot(dx, dy);
            const separation = (0.98 + 0.06 * strength) * (a.scale + b.scale) + 0.07 * strength;
            const penetration = separation - distance;
            if (penetration <= 0.00001) continue;
            overlap = Math.max(overlap, penetration);
            const nx = distance > 1e-8 ? dx / distance : 1;
            const ny = distance > 1e-8 ? dy / distance : 0;
            const weightA = 1 / a.scale ** 4, weightB = 1 / b.scale ** 4;
            const pushA = penetration * weightA / (weightA + weightB);
            const pushB = penetration - pushA;
            a.x -= nx * pushA; a.y -= ny * pushA;
            b.x += nx * pushB; b.y += ny * pushB;
          }
          if (overlap < 0.0001) break;
        }
      }
      layout.forEach((pose, index) => {
        if (Math.abs(pose.x - before[index].x) + Math.abs(pose.y - before[index].y)
          + Math.abs(pose.scale - before[index].scale) > 0.000001) changed = true;
      });
      return changed;
    },
  };
}
