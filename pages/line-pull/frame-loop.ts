type FrameRequest = (callback: (now: number) => void) => unknown;

// Input events only invalidate. Keep at most one frame queued, and sleep when
// neither the input nor the spring needs another update.
export function createFrameLoop(
  drawFrame: (dt: number) => boolean,
  requestFrame: FrameRequest = callback => requestAnimationFrame(callback),
  clock: () => number = () => performance.now(),
): () => void {
  let pending = false;
  let previousTime = 0;

  function tick(now: number): void {
    pending = false;
    const dt = Math.min(Math.max((now - previousTime) / 1000, 0), 0.064);
    previousTime = now;
    if (drawFrame(dt) && !pending) {
      pending = true;
      requestFrame(tick);
    }
  }

  return () => {
    if (pending) return;
    previousTime = clock();
    pending = true;
    requestFrame(tick);
  };
}
