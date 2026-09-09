export function createArtworkPointer(canvas: HTMLCanvasElement) {
  const cursor = document.createElement('div');
  cursor.className = 'artwork-pointer';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.hidden = true;
  document.body.append(cursor);
  const events = new AbortController();
  const options = { signal: events.signal };
  let active: number | undefined;
  function hide() {
    active = undefined;
    cursor.hidden = true;
    cursor.classList.remove('pressed');
  }
  function place(event: PointerEvent) {
    if (!event.isPrimary) return;
    const rect = canvas.getBoundingClientRect();
    cursor.hidden = event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom;
    cursor.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
  }
  canvas.addEventListener('pointerenter', place, options);
  canvas.addEventListener('pointermove', place, options);
  canvas.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    active = event.pointerId;
    place(event);
    cursor.classList.add('pressed');
  }, options);
  canvas.addEventListener('pointerleave', () => { cursor.hidden = true; }, options);
  window.addEventListener('pointerup', event => {
    if (active !== event.pointerId) return;
    active = undefined;
    cursor.classList.remove('pressed');
    if (event.pointerType !== 'mouse') cursor.hidden = true;
  }, options);
  canvas.addEventListener('pointercancel', hide, options);
  canvas.addEventListener('lostpointercapture', () => { cursor.classList.remove('pressed'); }, options);
  window.addEventListener('blur', hide, options);
  window.addEventListener('resize', hide, options);
  document.addEventListener('visibilitychange', () => { if (document.hidden) hide(); }, options);
  return () => { events.abort(); cursor.remove(); };
}
