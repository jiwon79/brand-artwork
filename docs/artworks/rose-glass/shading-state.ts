export type ShadingState = { effects: number; view: 'color' | 'weight'; inspect: 1 | 2 | 3; region: number };
export const initialShadingState: ShadingState = { effects: 0, view: 'color', inspect: 1, region: 0 };
export type ShadingAction =
  | { type: 'effect'; bit: number; enabled: boolean }
  | { type: 'all'; enabled: boolean }
  | { type: 'view'; value: ShadingState['view'] }
  | { type: 'inspect'; value: ShadingState['inspect'] }
  | { type: 'region'; value: number };

export function reduceShadingState(state: ShadingState, action: ShadingAction): ShadingState {
  switch (action.type) {
    case 'effect': return { ...state, effects: action.enabled ? state.effects | action.bit : state.effects & ~action.bit };
    case 'all': return { ...state, effects: action.enabled ? 7 : 0 };
    case 'view': return { ...state, view: action.value };
    case 'inspect': return { ...state, inspect: action.value };
    case 'region': return { ...state, region: Math.max(0, Math.min(7, action.value)) };
  }
}
