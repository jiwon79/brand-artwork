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

// Variant accents follow the source silhouette's width at the same measured frame.
export function variantGesture(frame: number, widths: readonly number[]) {
  if (widths.length < 2) return 0;
  const first = Math.max(0, Math.min(Math.floor(frame), widths.length - 1));
  const second = Math.min(first + 1, widths.length - 1);
  const width = widths[first] + (widths[second] - widths[first]) * (frame - first);
  const minimum = Math.min(...widths);
  const maximum = Math.max(...widths);
  return maximum > minimum ? (width - minimum) / (maximum - minimum) : 0;
}
