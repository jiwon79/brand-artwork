import '../../common/touch-pointer';

const preview = document.querySelector<HTMLElement>('[data-preview-surface]');
const coordinates = document.querySelector<HTMLOutputElement>('[data-pointer-coordinates]');
const swatches = [...document.querySelectorAll<HTMLButtonElement>('[data-pointer-color]')];

if (!preview || !coordinates) throw new Error('Touch pointer preview markup is incomplete.');

const syntheticPointerId = 10_001;
let syntheticPointerActive = false;
let syntheticTarget: Element = preview;
let lastX = 0;
let lastY = 0;

function emitSyntheticTouch(
  type: 'pointerdown' | 'pointermove' | 'pointercancel',
  pressure = 0,
  buttons = 0,
): void {
  syntheticTarget.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    composed: true,
    pointerId: syntheticPointerId,
    pointerType: 'touch',
    clientX: lastX,
    clientY: lastY,
    pressure,
    buttons,
  }));
}

function stopSyntheticPointer(): void {
  if (!syntheticPointerActive) return;
  emitSyntheticTouch('pointercancel');
  syntheticPointerActive = false;
}

preview.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'mouse') return;

  lastX = event.clientX;
  lastY = event.clientY;
  coordinates.value = `${String(lastX).padStart(3, '0')}, ${String(lastY).padStart(3, '0')}`;

  const target = document.elementFromPoint(lastX, lastY);
  if (!target || target.closest('[data-touch-cursor-ignore="true"]')) {
    stopSyntheticPointer();
    return;
  }

  syntheticTarget = target;
  const pressure = event.buttons > 0 ? 0.5 : 0;
  if (!syntheticPointerActive) {
    syntheticPointerActive = true;
    emitSyntheticTouch('pointerdown', pressure, event.buttons);
    return;
  }

  emitSyntheticTouch('pointermove', pressure, event.buttons);
});

function forwardMousePress(event: PointerEvent): void {
  if (event.pointerType !== 'mouse' || !syntheticPointerActive) return;

  lastX = event.clientX;
  lastY = event.clientY;
  emitSyntheticTouch('pointermove', event.buttons > 0 ? 0.5 : 0, event.buttons);
}

preview.addEventListener('pointerdown', forwardMousePress);
preview.addEventListener('pointerup', forwardMousePress);

preview.addEventListener('pointerleave', stopSyntheticPointer);
window.addEventListener('blur', stopSyntheticPointer);

swatches.forEach((swatch) => {
  swatch.addEventListener('click', () => {
    const color = swatch.dataset.pointerColor;
    if (!color) return;

    document.documentElement.style.setProperty('--touch-pointer-color', color);
    swatches.forEach((item) => {
      const selected = item === swatch;
      item.classList.toggle('is-selected', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
  });
});
