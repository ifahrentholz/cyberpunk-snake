/**
 * Core game reducer for Cyberpunk Snake.
 *
 * `createGame` / `step` are pure: same inputs always produce the same
 * output, no clocks, no randomness beyond the injected `Rng`, no
 * side effects. `GameState` is plain, serializable data.
 */

export type Direction = 'up' | 'down' | 'left' | 'right'

export type GameStatus = 'ready' | 'running' | 'paused' | 'over'

export interface Position {
  readonly x: number
  readonly y: number
}

export interface GameConfig {
  readonly gridWidth: number
  readonly gridHeight: number
  /** Length of the snake at creation time. Defaults to 3. */
  readonly initialSnakeLength?: number
}

/** Injected randomness: returns a number in [0, 1). Never `Math.random`. */
export type Rng = () => number

export interface GameSnapshot {
  readonly snake: readonly Position[]
  readonly direction: Direction
  readonly food: Position
}

export interface GameState {
  readonly status: GameStatus
  readonly config: GameConfig
  readonly snake: readonly Position[]
  readonly direction: Direction
  /** Pending direction, checked against `direction` at the next tick. */
  readonly queuedDirection: Direction | null
  readonly food: Position
  readonly score: number
  /** Snapshot restart resets to. Not consulted for anything else. */
  readonly initial: GameSnapshot
}

export type GameAction =
  | { readonly type: 'direction'; readonly direction: Direction }
  // `rng` is mandatory, not optional: food respawn needs randomness at tick
  // time, and `GameState` must stay serializable (it cannot carry an `Rng`
  // itself). Making it required turns a forgotten argument into a compile
  // error at every call site instead of a silent runtime gap. No internal
  // fallback (no default, no `Math.random`) exists anywhere in this module.
  | { readonly type: 'tick'; readonly rng: Rng }
  | { readonly type: 'pause' }
  | { readonly type: 'resume' }
  | { readonly type: 'restart' }

const OPPOSITE: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
}

const DELTA: Record<Direction, Position> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

function isOpposite(a: Direction, b: Direction): boolean {
  return OPPOSITE[a] === b
}

function isWithinGrid(position: Position, config: GameConfig): boolean {
  return (
    position.x >= 0 &&
    position.x < config.gridWidth &&
    position.y >= 0 &&
    position.y < config.gridHeight
  )
}

function isOccupied(position: Position, cells: readonly Position[]): boolean {
  return cells.some((cell) => cell.x === position.x && cell.y === position.y)
}

function samePosition(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y
}

function buildInitialSnake(config: GameConfig): readonly Position[] {
  const length = config.initialSnakeLength ?? 3
  const headX = Math.floor(config.gridWidth / 2)
  const headY = Math.floor(config.gridHeight / 2)
  const cells: Position[] = []
  for (let i = 0; i < length; i += 1) {
    cells.push({ x: headX - i, y: headY })
  }
  return cells
}

function pickFoodPosition(
  config: GameConfig,
  occupied: readonly Position[],
  rng: Rng,
): Position {
  const emptyCells: Position[] = []
  for (let y = 0; y < config.gridHeight; y += 1) {
    for (let x = 0; x < config.gridWidth; x += 1) {
      const candidate = { x, y }
      if (!isOccupied(candidate, occupied)) {
        emptyCells.push(candidate)
      }
    }
  }
  if (emptyCells.length === 0) {
    throw new Error('No empty cell available for food placement')
  }
  const index = Math.min(
    emptyCells.length - 1,
    Math.floor(rng() * emptyCells.length),
  )
  const cell = emptyCells[index]
  if (!cell) {
    throw new Error('No empty cell available for food placement')
  }
  return cell
}

/** Creates the initial, pure game state. Ready to run, not yet moving. */
export function createGame(config: GameConfig, rng: Rng): GameState {
  const snake = buildInitialSnake(config)
  const direction: Direction = 'right'
  const food = pickFoodPosition(config, snake, rng)
  // `snake`/`food` and `initial.snake`/`initial.food` intentionally share
  // the same array/object references here. That is safe only because every
  // mutation path in this module produces new arrays/objects (`advance`
  // builds `nextSnake` via spread, `restart` reads from `initial` without
  // ever writing into it) — nothing in `src/logic` mutates in place. If a
  // future change introduces in-place mutation, this sharing would leak
  // between live state and the restart snapshot; keep it immutable or
  // clone explicitly here.
  const initial: GameSnapshot = { snake, direction, food }

  return {
    status: 'ready',
    config,
    snake,
    direction,
    queuedDirection: null,
    food,
    score: 0,
    initial,
  }
}

function resolveMoveDirection(state: GameState): Direction {
  if (
    state.queuedDirection !== null &&
    !isOpposite(state.direction, state.queuedDirection)
  ) {
    return state.queuedDirection
  }
  return state.direction
}

function restart(state: GameState): GameState {
  return {
    ...state,
    status: 'ready',
    snake: state.initial.snake,
    direction: state.initial.direction,
    queuedDirection: null,
    food: state.initial.food,
    score: 0,
  }
}

function advance(state: GameState, rng: Rng): GameState {
  const direction = resolveMoveDirection(state)
  const delta = DELTA[direction]
  const currentHead = state.snake[0]
  if (!currentHead) {
    throw new Error('Snake has no segments')
  }
  const nextHead: Position = {
    x: currentHead.x + delta.x,
    y: currentHead.y + delta.y,
  }

  if (!isWithinGrid(nextHead, state.config)) {
    return { ...state, status: 'over' }
  }

  // AC7 fixes this order: self collision is judged against the snake with
  // its tail already dropped (the tail is about to vacate that cell on a
  // normal move) — BEFORE it is known whether this tick eats food. That is
  // deliberate, not an oversight: see the tail/food edge case note below.
  const body = state.snake.slice(0, state.snake.length - 1)
  if (isOccupied(nextHead, body)) {
    return { ...state, status: 'over' }
  }

  const ateFood = samePosition(nextHead, state.food)

  // Edge case: a new head landing exactly on the *current* tail cell is
  // never a self collision (checked above, against `body`, tail excluded)
  // regardless of whether this tick also eats food. If it turns out food
  // is eaten in the same tick, the tail is not dropped (the snake grows),
  // so `nextSnake` below would contain that tail cell twice for exactly
  // one snapshot (as the new head, and still as the retained old tail) —
  // an overlap, not a collision, self-correcting on the following tick
  // once a non-eating tick drops that tail cell again. This is reachable
  // only by directly constructing a state (see the dedicated test); it
  // cannot arise from normal play, because food placement always avoids
  // every cell of the snake at the moment it is placed (including the
  // tail), and the head necessarily revisits any given cell before the
  // tail can lag its way back onto it — so a live game can never have
  // food sitting on the current tail's cell to begin with. Handled here,
  // faithfully, per the mandated AC7 order; not reordered.
  const nextSnake = ateFood ? [nextHead, ...state.snake] : [nextHead, ...body]
  const food = ateFood ? pickFoodPosition(state.config, nextSnake, rng) : state.food
  const score = ateFood ? state.score + 1 : state.score

  return {
    ...state,
    status: 'running',
    snake: nextSnake,
    direction,
    queuedDirection: null,
    food,
    score,
  }
}

/** Advances the game by one action. Pure: no clock, no randomness of its own. */
export function step(state: GameState, action: GameAction): GameState {
  if (action.type === 'restart') {
    return restart(state)
  }

  if (state.status === 'over') {
    return state
  }

  if (action.type === 'direction') {
    // AC11: direction inputs are not silently buffered while paused — a
    // resume must not surprise the player with a turn they queued blind.
    // A direction queued *before* pausing stays valid and is unaffected:
    // `pause` never touches `queuedDirection` (see below).
    if (state.status === 'paused') {
      return state
    }
    return { ...state, queuedDirection: action.direction }
  }

  if (action.type === 'pause') {
    return state.status === 'running' ? { ...state, status: 'paused' } : state
  }

  if (action.type === 'resume') {
    return state.status === 'paused' ? { ...state, status: 'running' } : state
  }

  // action.type === 'tick'
  if (state.status === 'paused') {
    return state
  }
  return advance(state, action.rng)
}
