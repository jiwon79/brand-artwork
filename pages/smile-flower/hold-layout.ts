import { TILES } from './reference-layout';

type Point = { x: number; y: number };
type HoldFocus = Point & { strength: number; held: boolean };

export function createHoldLayout() {
  const focuses = new Map<number, HoldFocus>();
  const tileLayouts = TILES.map(tile => ({ x: tile.x, y: tile.y, scale: 1 }));
  function reset() {
    focuses.clear();
    tileLayouts.forEach((tileLayout, i) => Object.assign(tileLayout, { x: TILES[i].x, y: TILES[i].y, scale: 1 }));
  }
  return {
    tileLayouts,
    hold(pointerId: number, index: number) {
      focuses.set(pointerId, { x: TILES[index].x, y: TILES[index].y, strength: 1, held: true });
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
      let focusStrength = 0;
      for (const focus of focuses.values()) focusStrength = Math.max(focusStrength, focus.strength);
      const previousLayouts = tileLayouts.map(tileLayout => ({ ...tileLayout }));
      for (const [index, tile] of TILES.entries()) {
        let influence = 0;
        let nearestFocus: HoldFocus | undefined;
        let nearestWeight = 0;
        for (const focus of focuses.values()) {
          const distanceSquared = (tile.x - focus.x) ** 2 + (tile.y - focus.y) ** 2;
          const localInfluence = focus.strength * Math.exp(-distanceSquared / 2.7);
          influence = Math.max(influence, localInfluence);
          const weight = focus.strength * Math.exp(-distanceSquared / 12);
          if (weight > nearestWeight) { nearestWeight = weight; nearestFocus = focus; }
        }
        // A continuous radial profile keeps the first ring visible. The broader
        // displacement profile opens a little room instead of erasing neighbors.
        const targetLayout = {
          scale: 1 - 0.45 * focusStrength + 1.85 * influence,
          x: tile.x + (nearestFocus ? (tile.x - nearestFocus.x) * 1.08 * nearestWeight : 0),
          y: tile.y + (nearestFocus ? (tile.y - nearestFocus.y) * 1.08 * nearestWeight : 0),
        };
        const tileLayout = tileLayouts[index];
        for (const key of ['x', 'y', 'scale'] as const) {
          const next = tileLayout[key] + (targetLayout[key] - tileLayout[key]) * blend;
          tileLayout[key] = Math.abs(next - targetLayout[key]) < 0.0001 ? targetLayout[key] : next;
        }
      }
      // Preserve every scale; only resolve remaining contacts (mostly where two
      // finger regions meet). Large central models resist displacement more.
      if (focusStrength > 0 || tileLayouts.some(tileLayout => tileLayout.scale !== 1)) {
        for (let pass = 0; pass < 40; pass++) {
          let worst = 0;
          for (let i = 0; i < tileLayouts.length; i++) for (let j = i + 1; j < tileLayouts.length; j++) {
            const a = tileLayouts[i], b = tileLayouts[j];
            const dx = b.x - a.x, dy = b.y - a.y;
            const distance = Math.hypot(dx, dy);
            const overlap = (0.98 + 0.02 * focusStrength) * (a.scale + b.scale) + 0.04 * focusStrength - distance;
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
      tileLayouts.forEach((tileLayout, index) => {
        if (tileLayout.scale !== previousLayouts[index].scale || tileLayout.x !== previousLayouts[index].x || tileLayout.y !== previousLayouts[index].y) changed = true;
      });
      return changed;
    },
  };
}
