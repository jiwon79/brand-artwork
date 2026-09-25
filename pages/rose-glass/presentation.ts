import { createStepper } from '../../common/stepper';

const stages = [
  { id: '0', label: '00 배경' }, { id: '1', label: '01 형태' },
  { id: '2', label: '02 음영' }, { id: '3', label: '03 외곽' },
  { id: '4', label: '04 조명' }, { id: '5', label: '05 질감' },
  { id: '6', label: '06 완성' },
] as const;
type Stage = typeof stages[number]['id'];
const definitions = [
  ['upperGlass', 1], ['lowerGlass', 1], ['foregroundGlass', 1],
  ['shading', 2], ['shadows', 2], ['edgeOptics', 3],
  ['lighting', 4], ['frost', 5], ['diffusion', 6],
] as const;
export const renderLayers = { upperGlass: true, lowerGlass: true, foregroundGlass: true,
  shading: true, shadows: true, edgeOptics: true, lighting: true, frost: true,
  diffusion: true };

// Stage selection, URL state and pointer/keyboard activation belong to the
// shared stepper. This adapter only applies Rose Glass's shader contributions.
export function createPresentation(wake: () => void) {
  let debug = false;
  function apply(id: Stage) {
    definitions.forEach(([key,from]) => { renderLayers[key] = !debug || Number(id) >= from; });
    wake();
  }
  const stepper = createStepper({
    steps: stages, initialStep: '6', onChange: apply,
    ariaLabel: '렌더링 누적 단계', keyboard: false,
  });
  return {
    setDebug(visible: boolean) {
      debug = visible;
      stepper.element.hidden = !visible;
      apply(stepper.currentStep);
    },
  };
}
