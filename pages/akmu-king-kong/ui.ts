const handDotEl = document.getElementById('hand-dot')!;
const statAngleEl = document.getElementById('stat-angle')!;
const statRotationEl = document.getElementById('stat-rotation')!;
const statTimeEl = document.getElementById('stat-time')!;
const progressFillEl = document.getElementById('progress-fill')!;
const rotRingEl = document.getElementById('rotation-ring')!;

export function updateUI({
  angle,
  accumulated,
  currentTime,
  duration,
  handDetected,
}: {
  angle: number | null;
  accumulated: number;
  currentTime: number;
  duration: number;
  handDetected: boolean;
}) {
  handDotEl.classList.toggle('active', handDetected);

  statAngleEl.textContent =
    angle !== null ? Math.round(angle) + '°' : '—';

  statRotationEl.textContent = Math.round(accumulated) + '°';

  statTimeEl.textContent = currentTime.toFixed(1) + 's';

  const pct =
    duration > 0 ? ((currentTime / duration) * 100).toFixed(1) : '0';
  progressFillEl.style.width = pct + '%';

  rotRingEl.style.transform = `rotate(${accumulated}deg)`;
}
