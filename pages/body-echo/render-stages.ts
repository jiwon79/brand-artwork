export const renderStageLabels = [
  'LINE',
  'CHROMATIC',
  'PULL',
  'WAVE',
  'DISSOLVE',
  'INTERACT',
] as const;

export type RenderStage = 0 | 1 | 2 | 3 | 4 | 5;

export const renderStageState = {
  current: 5 as RenderStage,
};

export function setupRenderStageControls(onChange: (stage: RenderStage) => void): void {
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[data-render-stage]'),
  );

  function selectStage(stage: RenderStage): void {
    renderStageState.current = stage;
    buttons.forEach((button) => {
      const selected = Number(button.dataset.renderStage) === stage;
      button.classList.toggle('active', selected);
      if (selected) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    onChange(stage);
  }

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      selectStage(Number(button.dataset.renderStage) as RenderStage);
    });
  });
  window.addEventListener('keydown', (event) => {
    if (/^[1-6]$/.test(event.key)) selectStage((Number(event.key) - 1) as RenderStage);
    if (event.key === 'ArrowLeft') {
      selectStage(Math.max(0, renderStageState.current - 1) as RenderStage);
    }
    if (event.key === 'ArrowRight') {
      selectStage(Math.min(renderStageLabels.length - 1, renderStageState.current + 1) as RenderStage);
    }
  });
}
