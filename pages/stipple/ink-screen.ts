/** A periodic Poisson-disk distribution with a minimum separation, in paper units. */
export function makeInkPoints(period = 128, separation = 3.1, seed = 197) {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const count = Math.ceil(period / (separation / Math.SQRT2));
  const cell = period / count;
  const grid = new Int32Array(count * count).fill(-1);
  const points: { x: number; y: number }[] = [];
  const active: number[] = [];
  const wrap = (n: number) => (n % count + count) % count;
  const add = (x: number, y: number) => {
    const index = points.length;
    points.push({ x, y });
    active.push(index);
    grid[Math.floor(y / cell) * count + Math.floor(x / cell)] = index;
  };
  add(random() * period, random() * period);
  while (active.length) {
    const activeIndex = Math.floor(random() * active.length);
    const origin = points[active[activeIndex]];
    let found = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const angle = random() * Math.PI * 2;
      const radius = separation * Math.sqrt(1 + random() * 3);
      const x = (origin.x + Math.cos(angle) * radius + period) % period;
      const y = (origin.y + Math.sin(angle) * radius + period) % period;
      const gx = Math.floor(x / cell);
      const gy = Math.floor(y / cell);
      let available = true;
      for (let dy = -2; dy <= 2 && available; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const index = grid[wrap(gy + dy) * count + wrap(gx + dx)];
          if (index < 0) continue;
          const point = points[index];
          const px = Math.min(Math.abs(point.x - x), period - Math.abs(point.x - x));
          const py = Math.min(Math.abs(point.y - y), period - Math.abs(point.y - y));
          if (px * px + py * py < separation * separation) { available = false; break; }
        }
      }
      if (available) { add(x, y); found = true; break; }
    }
    if (!found) active.splice(activeIndex, 1);
  }
  return points;
}

/** Rank nearest-dot distances so a tone of 0.7 covers exactly 70% of a screen. */
export function makeInkScreen(period = 128, resolution = 512, separation = 3.1) {
  const points = makeInkPoints(period, separation);
  const cellCount = Math.ceil(period / separation);
  const cellSize = period / cellCount;
  const grid: number[][] = Array.from({ length: cellCount * cellCount }, () => []);
  points.forEach((point, index) => grid[Math.floor(point.y / cellSize) * cellCount + Math.floor(point.x / cellSize)].push(index));
  const distances = new Float32Array(resolution * resolution);
  const wrap = (n: number) => (n % cellCount + cellCount) % cellCount;
  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const px = (x + 0.5) / resolution * period;
      const py = (y + 0.5) / resolution * period;
      const gx = Math.floor(px / cellSize);
      const gy = Math.floor(py / cellSize);
      let nearest = Infinity;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          for (const index of grid[wrap(gy + dy) * cellCount + wrap(gx + dx)]) {
            const point = points[index];
            const distanceX = Math.min(Math.abs(point.x - px), period - Math.abs(point.x - px));
            const distanceY = Math.min(Math.abs(point.y - py), period - Math.abs(point.y - py));
            nearest = Math.min(nearest, distanceX * distanceX + distanceY * distanceY);
          }
        }
      }
      distances[y * resolution + x] = nearest;
    }
  }
  const order = Uint32Array.from(distances, (_, index) => index).sort((a, b) => distances[a] - distances[b]);
  const pixels = new Uint8Array(resolution * resolution * 4);
  for (let rank = 0; rank < order.length; rank++) {
    const threshold = Math.round((rank + 0.5) / order.length * 65535);
    const pixel = order[rank] * 4;
    pixels[pixel] = threshold >>> 8;
    pixels[pixel + 1] = threshold & 255;
    pixels[pixel + 3] = 255;
  }
  return pixels;
}
