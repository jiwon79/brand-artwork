const handDotEl = document.getElementById('hand-dot')!;
const statDistanceEl = document.getElementById('stat-distance')!;
const statSpeedEl = document.getElementById('stat-speed')!;
const statTimeEl = document.getElementById('stat-time')!;
const progressFillEl = document.getElementById('progress-fill')!;

export function updateUI({
  distance,
  rate,
  currentTime,
  duration,
  handsDetected,
}: {
  distance: number;
  rate: number;
  currentTime: number;
  duration: number;
  handsDetected: boolean;
}) {
  handDotEl.classList.toggle('active', handsDetected);

  statDistanceEl.textContent = handsDetected
    ? distance.toFixed(2)
    : '—';

  statSpeedEl.textContent = rate.toFixed(1) + 'x';

  statTimeEl.textContent = currentTime.toFixed(1) + 's';

  const pct =
    duration > 0 ? ((currentTime / duration) * 100).toFixed(1) : '0';
  progressFillEl.style.width = pct + '%';
}
