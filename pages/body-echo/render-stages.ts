import { createStepper } from '../../common/stepper';

export const renderStages = [
  { id: 'line', label: 'Line', stage: 0 },
  { id: 'chromatic', label: 'Chromatic', stage: 1 },
  { id: 'pull', label: 'Pull', stage: 2 },
  { id: 'wave', label: 'Wave', stage: 3 },
  { id: 'dissolve', label: 'Dissolve', stage: 4 },
  { id: 'interact', label: 'Interact', stage: 5 },
] as const;

export type RenderStage = 0 | 1 | 2 | 3 | 4 | 5;

export const renderStageState = {
  current: 5 as RenderStage,
};

export function setupRenderStageControls(onChange: (stage: RenderStage) => void): void {
  createStepper({
    ariaLabel: 'Rendering stages',
    steps: renderStages,
    initialStep: 'interact',
    onChange: (stepId) => {
      const selectedStep = renderStages.find((step) => step.id === stepId);
      if (!selectedStep) return;
      renderStageState.current = selectedStep.stage;
      onChange(selectedStep.stage);
    },
  });
}
