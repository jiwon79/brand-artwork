type HideableGui = {
  hide: () => unknown;
  show: () => unknown;
};

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable);
}

/** Debug tooling is opt-in so artwork pages stay presentation-ready by default. */
export function isDebugMode(): boolean {
  return new URLSearchParams(window.location.search).has('debug');
}

/** Shows debug tooling for `?debug` URLs or while toggled with the D key. */
export function exposeGuiInDebugMode<T extends HideableGui>(gui: T, onVisibilityChange?: (visible: boolean) => void): T {
  let visible = isDebugMode();
  if (!visible) gui.hide();
  onVisibilityChange?.(visible);
  window.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() !== 'd' || event.repeat || isTypingTarget(event.target)) return;
    visible = !visible;
    if (visible) gui.show();
    else gui.hide();
    onVisibilityChange?.(visible);
  });
  return gui;
}
