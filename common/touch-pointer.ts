const CURSOR_SELECTOR = '[data-touch-pointer-cursor]';
const IGNORE_ATTRIBUTE = 'data-touch-cursor-ignore';

const styles = `
  :root {
    --touch-pointer-color: #0d99ff;
    --touch-pointer-outline: #ffffff;
    --touch-pointer-size: 30px;
    --touch-pointer-z-index: 99999;
  }

  .touch-pointer-cursor {
    position: fixed;
    inset: 0 auto auto 0;
    z-index: var(--touch-pointer-z-index);
    width: var(--touch-pointer-size);
    height: var(--touch-pointer-size);
    overflow: visible;
    pointer-events: none;
    transform: translate3d(var(--touch-pointer-x), var(--touch-pointer-y), 0);
    will-change: transform;
  }

  .touch-pointer-cursor__glyph {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
    color: var(--touch-pointer-color);
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.22));
    transform-origin: 2px 2px;
    animation: touch-pointer-in 120ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  .touch-pointer-cursor__shape {
    fill: currentColor;
    stroke: var(--touch-pointer-outline);
    stroke-linejoin: round;
    stroke-width: 1.75;
    vector-effect: non-scaling-stroke;
  }

  .touch-pointer-cursor--releasing .touch-pointer-cursor__glyph {
    animation: touch-pointer-out 120ms ease-out forwards;
  }

  @keyframes touch-pointer-in {
    from {
      opacity: 0;
      transform: scale(0.78);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @keyframes touch-pointer-out {
    from {
      opacity: 1;
      transform: scale(1);
    }
    to {
      opacity: 0;
      transform: scale(0.88);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .touch-pointer-cursor__glyph,
    .touch-pointer-cursor--releasing .touch-pointer-cursor__glyph {
      animation-duration: 1ms;
    }
  }
`;

interface ActiveCursor {
  element: HTMLDivElement;
  releaseTimer: number | null;
}

export interface TouchPointerController {
  destroy(): void;
  readonly activeCount: number;
}

declare global {
  interface Window {
    __touchPointerController?: TouchPointerController;
  }
}

function ignoresTouchPointer(event: PointerEvent): boolean {
  return event.composedPath().some((target) => (
    target instanceof Element && target.hasAttribute(IGNORE_ATTRIBUTE)
  ));
}

function positionCursor(element: HTMLElement, x: number, y: number): void {
  element.style.setProperty('--touch-pointer-x', `${x}px`);
  element.style.setProperty('--touch-pointer-y', `${y}px`);
}

function createCursorElement(x: number, y: number): HTMLDivElement {
  const element = document.createElement('div');
  element.className = 'touch-pointer-cursor';
  element.dataset.touchPointerCursor = '';
  element.setAttribute('aria-hidden', 'true');
  element.innerHTML = `
    <svg class="touch-pointer-cursor__glyph" viewBox="0 0 28 30" aria-hidden="true">
      <path
        class="touch-pointer-cursor__shape"
        d="M2 2.2v22.1l6.05-5.85 4.72 9.65 4.15-2.03-4.65-9.37h8.18L2 2.2Z"
      />
    </svg>
  `;
  positionCursor(element, x, y);
  return element;
}

export function createTouchPointer(): TouchPointerController {
  const style = document.createElement('style');
  style.dataset.touchPointerStyles = '';
  style.textContent = styles;
  document.head.appendChild(style);

  const cursors = new Map<number, ActiveCursor>();
  const elements = new Set<HTMLDivElement>();

  function removeCursor(pointerId: number, animate: boolean): void {
    const cursor = cursors.get(pointerId);
    if (!cursor) return;

    cursors.delete(pointerId);

    if (!animate) {
      cursor.element.remove();
      elements.delete(cursor.element);
      return;
    }

    cursor.element.classList.add('touch-pointer-cursor--releasing');
    const cleanup = (): void => {
      if (cursor.releaseTimer !== null) window.clearTimeout(cursor.releaseTimer);
      cursor.element.remove();
      elements.delete(cursor.element);
    };
    cursor.element.addEventListener('animationend', cleanup, { once: true });
    cursor.releaseTimer = window.setTimeout(cleanup, 180);
  }

  function removeAllCursors(): void {
    for (const pointerId of [...cursors.keys()]) removeCursor(pointerId, false);
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.pointerType !== 'touch' || ignoresTouchPointer(event)) return;

    removeCursor(event.pointerId, false);
    const element = createCursorElement(event.clientX, event.clientY);
    document.body.appendChild(element);
    elements.add(element);
    cursors.set(event.pointerId, { element, releaseTimer: null });
  }

  function onPointerMove(event: PointerEvent): void {
    const cursor = cursors.get(event.pointerId);
    if (!cursor) return;
    positionCursor(cursor.element, event.clientX, event.clientY);
  }

  function onPointerUp(event: PointerEvent): void {
    const cursor = cursors.get(event.pointerId);
    if (!cursor) return;
    positionCursor(cursor.element, event.clientX, event.clientY);
    removeCursor(event.pointerId, true);
  }

  function onPointerCancel(event: PointerEvent): void {
    removeCursor(event.pointerId, false);
  }

  document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
  document.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
  document.addEventListener('pointerup', onPointerUp, { capture: true, passive: true });
  document.addEventListener('pointercancel', onPointerCancel, { capture: true, passive: true });
  window.addEventListener('blur', removeAllCursors);
  window.addEventListener('pagehide', removeAllCursors);

  return {
    destroy(): void {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerCancel, true);
      window.removeEventListener('blur', removeAllCursors);
      window.removeEventListener('pagehide', removeAllCursors);
      removeAllCursors();
      elements.forEach((element) => element.remove());
      elements.clear();
      style.remove();
    },
    get activeCount(): number {
      return cursors.size;
    },
  };
}

// Direct module loading mirrors common/touch-cursor.ts and keeps adoption to a
// one-line script swap. Tear down an earlier Vite/HMR instance before starting.
window.__touchPointerController?.destroy();
document.querySelectorAll(CURSOR_SELECTOR).forEach((element) => element.remove());
window.__touchPointerController = createTouchPointer();
