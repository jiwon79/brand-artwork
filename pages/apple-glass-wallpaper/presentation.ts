import { createStepper } from '../../common/stepper';

const stages = [
  { id: '0', label: '00 배경' }, { id: '1', label: '01 형태' },
  { id: '2', label: '02 음영' }, { id: '3', label: '03 외곽' },
  { id: '4', label: '04 조명' }, { id: '5', label: '05 질감' },
  { id: '6', label: '06 완성' },
] as const;
type Stage = typeof stages[number]['id'];
const definitions = [
  ['upper', 1], ['lower', 1], ['front', 1],
  ['material', 2], ['shadows', 2], ['edges', 3],
  ['lighting', 4], ['grain', 5], ['blur', 6],
] as const;
export const layers = { upper: true, lower: true, front: true, material: true,
  shadows: true, edges: true, lighting: true, grain: true, blur: true };

// Stage selection, URL state and pointer/keyboard activation belong to the
// shared stepper. This adapter only applies Rose Glass's shader contributions.
export function createPresentation(wake: () => void) {
  function apply(id: Stage) {
    definitions.forEach(([key,from]) => { layers[key] = Number(id) >= from; });
    wake();
  }
  createStepper({
    steps: stages, initialStep: '6', onChange: apply,
    ariaLabel: '렌더링 누적 단계', keyboard: false,
  });
}
