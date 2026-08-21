export type StepValue = string | number;

export type StepDefinition<T extends StepValue> = {
  value: T;
  label: string;
};

export type StepperOptions<T extends StepValue> = {
  steps: readonly StepDefinition<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  keyboard?: boolean;
};

export type Stepper<T extends StepValue> = {
  readonly element: HTMLElement;
  readonly value: T;
  select: (value: T) => void;
  previous: () => void;
  next: () => void;
  destroy: () => void;
};

const stepperStyles = `
  :host {
    position: fixed;
    z-index: var(--stepper-z-index, 10);
    left: 50%;
    bottom: var(--stepper-bottom, max(10px, env(safe-area-inset-bottom)));
    display: block;
    width: min(var(--stepper-max-width, 520px), calc(100vw - 24px));
    transform: translateX(-50%);
    pointer-events: none;
  }

  nav {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    gap: clamp(10px, 4vw, 28px);
  }

  button {
    position: relative;
    min-width: 44px;
    min-height: 44px;
    padding: 8px 0;
    border: 0;
    background: transparent;
    color: var(--stepper-muted-color, rgba(37, 36, 34, 0.36));
    font: var(--stepper-font, 600 10px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
    letter-spacing: var(--stepper-letter-spacing, 0.045em);
    text-transform: uppercase;
    text-shadow: var(--stepper-text-shadow, 0 1px 8px rgba(251, 251, 250, 0.96));
    touch-action: none;
    pointer-events: auto;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
    transition: color 140ms ease, transform 140ms ease;
  }

  button::after {
    position: absolute;
    right: 0;
    bottom: 3px;
    left: 0;
    height: 1px;
    background: currentColor;
    content: '';
    transform: scaleX(0);
    transition: transform 140ms ease;
  }

  button[aria-current='step'] {
    color: var(--stepper-color, #252422);
  }

  button[aria-current='step']::after {
    transform: scaleX(1);
  }

  button:active {
    transform: scale(0.97);
  }

  button:focus-visible {
    outline: 2px solid var(--stepper-focus-color, #655ef4);
    outline-offset: 2px;
  }

  @media (max-width: 560px) {
    nav {
      gap: 10px;
    }

    button {
      min-width: 40px;
      font-size: 9px;
    }
  }
`;

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable);
}

/**
 * Mounts an always-visible artwork stepper. Pointer-down selection lets a
 * second touch change steps while another pointer remains captured by the artwork.
 */
export function createStepper<T extends StepValue>(options: StepperOptions<T>): Stepper<T> {
  if (options.steps.length === 0) throw new Error('Stepper requires at least one step.');
  if (new Set(options.steps.map((step) => step.value)).size !== options.steps.length) {
    throw new Error('Stepper values must be unique.');
  }
  if (!options.steps.some((step) => step.value === options.value)) {
    throw new Error('Stepper value must match one of its steps.');
  }

  const host = document.createElement('artwork-stepper');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  const nav = document.createElement('nav');
  const buttons = new Map<T, HTMLButtonElement>();
  let selectedValue = options.value;

  style.textContent = stepperStyles;
  nav.setAttribute('aria-label', options.ariaLabel ?? 'Artwork stages');

  const updateSelection = (): void => {
    for (const [value, button] of buttons) {
      if (value === selectedValue) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    }
  };

  const select = (value: T): void => {
    if (!buttons.has(value)) return;
    selectedValue = value;
    updateSelection();
    options.onChange(value);
  };

  for (const step of options.steps) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = step.label;
    button.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'mouse') event.preventDefault();
      event.stopPropagation();
      select(step.value);
    });
    button.addEventListener('click', (event) => {
      // Physical pointers already selected on pointerdown. Retain click for
      // keyboard and assistive-technology activation.
      if (event.detail === 0) select(step.value);
    });
    buttons.set(step.value, button);
    nav.appendChild(button);
  }

  const move = (offset: number): void => {
    const index = options.steps.findIndex((step) => step.value === selectedValue);
    const nextIndex = Math.max(0, Math.min(options.steps.length - 1, index + offset));
    select(options.steps[nextIndex].value);
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (options.keyboard === false || isTypingTarget(event.target)) return;
    if (/^[1-9]$/.test(event.key)) {
      const index = Number(event.key) - 1;
      if (index < options.steps.length) select(options.steps[index].value);
    } else if (event.key === 'ArrowLeft') move(-1);
    else if (event.key === 'ArrowRight') move(1);
  };

  shadow.append(style, nav);
  document.body.appendChild(host);
  window.addEventListener('keydown', handleKeyDown);
  updateSelection();
  options.onChange(selectedValue);

  return {
    element: host,
    get value() {
      return selectedValue;
    },
    select,
    previous: () => move(-1),
    next: () => move(1),
    destroy: () => {
      window.removeEventListener('keydown', handleKeyDown);
      host.remove();
    },
  };
}
