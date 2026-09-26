// Travel through the measured motion and back, easing only near each turn.
// The source's last silhouette differs from its first, so a direct wrap jumps.
export function loopFrame(seconds: number, frameCount: number, fps = 24) {
  const end = frameCount - 1;
  const period = end * 2;
  const phase = ((seconds * fps) % period + period) % period;
  const position = Math.min(phase, period - phase);
  const easeFrames = Math.min(8, end / 4);
  const ease = (distance: number) => {
    const unit = distance / easeFrames;
    return easeFrames * (2 * unit * unit - unit * unit * unit);
  };
  if (position < easeFrames) return ease(position);
  if (position > end - easeFrames) return end - ease(end - position);
  return position;
}

// One quick extension and slower release; the value and speed both meet at zero.
export function variantGesture(seconds: number, frameCount: number, fps = 24) {
  const period = (frameCount - 1) / fps;
  const progress = (((seconds % period) + period) % period) / period;
  const smooth = (value: number) => value * value * (3 - 2 * value);
  return progress < 0.38
    ? smooth(progress / 0.38)
    : 1 - smooth((progress - 0.38) / 0.62);
}
