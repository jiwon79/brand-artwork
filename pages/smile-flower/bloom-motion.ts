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
      const before = layout.map(pose => pose.scale);
      for (const [index, cell] of CELLS.entries()) {
        let influence = 0;
        for (const focus of focuses.values()) {
          const distance = Math.hypot(cell.x - focus.x, cell.y - focus.y);
          influence = Math.max(influence, focus.strength * Math.exp(-(distance ** 2) / 7));
        }
        const target = 1 - 0.45 * strength + 1.85 * influence;
        const next = layout[index].scale + (target - layout[index].scale) * blend;
        layout[index].scale = Math.abs(next - target) < 0.0001 ? target : next;
      }
      // Centers never move. Allocate the available radius to larger models first,
      // shrinking their neighbors instead. A covered neighbor can reach zero scale.
      // Sorting the displayed sizes lets a moving focus shrink before another grows.
      if (strength > 0 || layout.some(pose => pose.scale !== 1)) {
        const ordered = layout.map((pose, index) => ({ pose, index }))
          .sort((a, b) => b.pose.scale - a.pose.scale || a.index - b.index);
        const visible: typeof layout = [];
        const radius = 0.98 + 0.06 * strength;
        for (const { pose } of ordered) {
          for (const other of visible) {
            const distance = Math.hypot(pose.x - other.x, pose.y - other.y);
            const available = (distance - 0.07 * strength) / radius - other.scale;
            pose.scale = Math.max(0, Math.min(pose.scale, available));
          }
          if (pose.scale < 0.0001) pose.scale = 0;
          else visible.push(pose);
        }
      }
      layout.forEach((pose, index) => {
        if (pose.scale !== before[index]) changed = true;
      });
      return changed;
    },
  };
}
