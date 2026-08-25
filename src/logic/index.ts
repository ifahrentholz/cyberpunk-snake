/**
 * Pure game-logic layer.
 *
 * This module must never import from `input`, `renderer`, `persistence` or
 * the composition entry point, and must never touch the DOM, `Math.random`
 * or a clock — see issue #1 (Implementation Decisions). The real reducer
 * (`createGame` / `step`) lands in issue #3; this is a placeholder so the
 * three-layer structure exists and the toolchain can build/test/lint it.
 */
export interface LogicPlaceholder {
  readonly note: string;
}

export const logicPlaceholder: LogicPlaceholder = {
  note: 'Game logic (createGame/step) lands in issue #3.',
};
