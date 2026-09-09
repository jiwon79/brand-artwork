import { Quaternion, Vector3 } from 'three';

export function createModelRotation(canvas: HTMLCanvasElement, enabled: () => boolean, onChange: () => void) {
  const rotation = new Quaternion();
  const delta = new Quaternion();
  const axis = new Vector3();
  const events = new AbortController();
  const options = { signal: events.signal };
  const pointers = new Map<number, { x: number; y: number }>();

  function rotate(dx: number, dy: number, sensitivity: number) {
    const distance = Math.hypot(dx, dy);
    if (!distance) return;
    // Rotate around screen axes so dragging stays intuitive even when upside down.
    axis.set(dy, dx, 0).normalize();
    delta.setFromAxisAngle(axis, distance * sensitivity);
    rotation.premultiply(delta).normalize();
    onChange();
  }

  function releasePointer(id: number) {
    pointers.delete(id);
    canvas.classList.toggle('is-dragging', pointers.size > 0);
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  function release() { for (const id of [...pointers.keys()]) releasePointer(id); }

  canvas.addEventListener('pointerdown', event => {
    if (!enabled() || pointers.has(event.pointerId) || event.button !== 0) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('is-dragging');
  }, options);
  canvas.addEventListener('pointermove', event => {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    if (!enabled()) return release();
    if (event.buttons === 0) return releasePointer(event.pointerId);
    const size = Math.max(1, Math.min(canvas.clientWidth, canvas.clientHeight));
    // Average concurrent finger travel so adding a finger does not multiply speed.
    rotate(event.clientX - pointer.x, event.clientY - pointer.y, Math.PI / (size * pointers.size));
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  }, options);
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    canvas.addEventListener(name, event => { if (pointers.has(event.pointerId)) releasePointer(event.pointerId); }, options);
  }
  window.addEventListener('blur', release, options);
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); }, options);

  function reset() {
    release();
    rotation.identity();
    onChange();
  }

  canvas.addEventListener('keydown', event => {
    if (!enabled() || event.altKey || event.ctrlKey || event.metaKey) return;
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const direction = directions[event.key];
    if (direction) {
      event.preventDefault();
      rotate(...direction, Math.PI / 18);
    } else if (event.key === 'Home') {
      event.preventDefault();
      reset();
    }
  }, options);

  return { rotation, reset, dispose() { release(); events.abort(); } };
}
