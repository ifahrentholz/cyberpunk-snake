/**
 * Persistence layer — encapsulates highscore read/write against
 * `localStorage`. Deliberately independent of the other layers.
 */
export interface PersistencePlaceholder {
  readonly note: string;
}

export const persistencePlaceholder: PersistencePlaceholder = {
  note: 'Highscore persistence lands in a later ticket.',
};

export function readHighscorePlaceholder(): number {
  return 0;
}
