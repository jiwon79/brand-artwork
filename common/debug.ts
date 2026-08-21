type HideableGui = {
  hide: () => unknown;
};

/** Debug tooling is opt-in so artwork pages stay presentation-ready by default. */
export function isDebugMode(): boolean {
  return new URLSearchParams(window.location.search).has('debug');
}

/** Keeps an existing GUI setup intact while hiding it outside `?debug` mode. */
export function exposeGuiInDebugMode<T extends HideableGui>(gui: T): T {
  if (!isDebugMode()) gui.hide();
  return gui;
}
