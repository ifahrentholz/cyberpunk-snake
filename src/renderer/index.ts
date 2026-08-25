/**
 * Renderer layer — reads game state and draws to a Canvas 2D context.
 *
 * May import from `logic` only, and must stay read-only with respect to
 * game state. The real renderer lands in issue #6; this is a placeholder so
 * the layer boundary exists.
 */
import { logicPlaceholder, type LogicPlaceholder } from '../logic';

export interface RendererPlaceholder {
  readonly note: string;
  readonly logic: LogicPlaceholder;
}

export const rendererPlaceholder: RendererPlaceholder = {
  note: 'Canvas rendering lands in issue #6.',
  logic: logicPlaceholder,
};
