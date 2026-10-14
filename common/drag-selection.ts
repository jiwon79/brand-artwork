/** Keep captured drags from selecting text when the pointer leaves the canvas. */
export function preventDragSelection(element: HTMLElement) {
  element.style.userSelect = 'none';
  element.style.setProperty('-webkit-user-select', 'none');
  element.style.setProperty('-webkit-touch-callout', 'none');
  element.addEventListener('dragstart', event => event.preventDefault());
  const pointers = new Set<number>();
  let release: (() => void) | undefined;
  element.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointers.add(event.pointerId);
    if (release) return;
    const select = (event: Event) => event.preventDefault();
    document.addEventListener('selectstart', select);
    release = () => { document.removeEventListener('selectstart', select); release = undefined; };
  });
  const end = (event: Event) => {
    pointers.delete((event as PointerEvent).pointerId);
    if (!pointers.size) release?.();
  };
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) window.addEventListener(name, end);
  window.addEventListener('blur', () => { pointers.clear(); release?.(); });
}
