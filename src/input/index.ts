/**
 * Input layer — maps keyboard events to logic inputs.
 *
 * May import from `logic` only. The real keydown-to-direction binding lands
 * in issue #5; this is a placeholder so the layer boundary exists.
 */
import { logicPlaceholder, type LogicPlaceholder } from '../logic';

export interface InputPlaceholder {
  readonly note: string;
  readonly logic: LogicPlaceholder;
}

export const inputPlaceholder: InputPlaceholder = {
  note: 'Keyboard-to-direction binding lands in issue #5.',
  logic: logicPlaceholder,
};
