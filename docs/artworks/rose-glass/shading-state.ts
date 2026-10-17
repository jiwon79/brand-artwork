export type ShadingState = { effects: number; view: 'color' | 'weight'; region: number };
export const initialShadingState: ShadingState = { effects: 0, view: 'color', region: 0 };
export type ShadingAction =
  | { type: 'effect'; bit: number; enabled: boolean }
  | { type: 'all'; enabled: boolean }
  | { type: 'view'; value: ShadingState['view'] }
  | { type: 'region'; value: number };

export function reduceShadingState(state: ShadingState, action: ShadingAction): ShadingState {
  switch (action.type) {
    case 'effect': return { ...state, effects: action.enabled ? state.effects | action.bit : state.effects & ~action.bit };
    case 'all': return { ...state, effects: action.enabled ? 7 : 0 };
    case 'view': return { ...state, view: action.value };
    case 'region': return { ...state, region: Math.max(0, Math.min(7, action.value)) };
  }
}
