/**
 * Input layer — maps keyboard events to logic inputs.
 *
 * May import from `logic` only. The real keydown-to-direction binding
 * (issue #5) lives in `./keyboard` and is re-exported below, alongside the
 * pre-existing placeholder kept for `main.ts` and the import-boundary test.
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

export { keyToAction, bindKeyboard } from './keyboard';
export type { KeyboardBindingOptions } from './keyboard';
