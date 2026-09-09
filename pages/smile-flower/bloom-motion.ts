import { CELLS } from './reference-layout';

// Multiple held flowers form a bounded union of focus regions, never multiplied scales.
export function createBloomMotion() {
  const focuses = new Map<number, number>();
  const layout = CELLS.map(cell => ({ x: cell.x, y: cell.y, scale: 1 }));
  function reset() {
    focuses.clear();
    layout.forEach((pose, i) => Object.assign(pose, { x: CELLS[i].x, y: CELLS[i].y, scale: 1 }));
  }
  return {
    layout,
    hold(pointerId: number, index: number) { focuses.set(pointerId, index); },
    release(pointerId: number) { focuses.delete(pointerId); },
    reset,
    advance(delta: number, reducedMotion: boolean) {
      let changed = false;
      const blend = reducedMotion ? 1 : -Math.expm1(-9 * delta);
      for (const [index, cell] of CELLS.entries()) {
        let distance = Infinity;
        let center = cell;
        for (const focus of focuses.values()) {
          const candidate = CELLS[focus];
          const d = Math.hypot(cell.x - candidate.x, cell.y - candidate.y);
          if (d < distance) { distance = d; center = candidate; }
        }
        const active = focuses.size > 0;
        const scale = active ? 0.60 + 1.10 * Math.exp(-(distance ** 2) / 11) : 1;
        // Give the enlarged petals room without displacing the selected center.
        const push = active && distance > 0 ? 1.12 * (1 - Math.exp(-(distance ** 2) / 1.5)) * Math.exp(-(distance ** 2) / 32) / distance : 0;
        const target = { x: cell.x + (cell.x - center.x) * push, y: cell.y + (cell.y - center.y) * push, scale };
        const pose = layout[index];
        for (const key of ['x', 'y', 'scale'] as const) {
          if (pose[key] === target[key]) continue;
          changed = true;
          const next = pose[key] + (target[key] - pose[key]) * blend;
          pose[key] = Math.abs(next - target[key]) < 0.0001 ? target[key] : next;
        }
      }
      return changed;
    },
  };
}
