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
  | { readonly type: 'tick' }
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

function advance(state: GameState): GameState {
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

  const body = state.snake.slice(0, state.snake.length - 1)
  if (isOccupied(nextHead, body)) {
    return { ...state, status: 'over' }
  }

  const nextSnake = [nextHead, ...body]

  return {
    ...state,
    status: 'running',
    snake: nextSnake,
    direction,
    queuedDirection: null,
  }
}

/** Advances the game by one action. Pure: no clock, no randomness. */
export function step(state: GameState, action?: GameAction): GameState {
  const effectiveAction: GameAction = action ?? { type: 'tick' }

  if (effectiveAction.type === 'restart') {
    return restart(state)
  }

  if (state.status === 'over') {
    return state
  }

  if (effectiveAction.type === 'direction') {
    return { ...state, queuedDirection: effectiveAction.direction }
  }

  if (effectiveAction.type === 'pause') {
    return state.status === 'running' ? { ...state, status: 'paused' } : state
  }

  if (effectiveAction.type === 'resume') {
    return state.status === 'paused' ? { ...state, status: 'running' } : state
  }

  // effectiveAction.type === 'tick'
  if (state.status === 'paused') {
    return state
  }
  return advance(state)
}
