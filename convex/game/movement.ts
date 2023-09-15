import { Doc } from '../_generated/dataModel';
import { movementSpeed } from '../data/characters';
import { COLLISION_THRESHOLD, map, world } from '../schema';
import { Path, Point, Vector } from '../schema/types';
import { distance, manhattanDistance, pointsEqual } from '../util/geometry';
import { MinHeap } from '../util/minheap';
import { GameState } from './state';

type PathCandidate = {
  pos: Point;
  vector?: Vector;
  t: number;
  length: number;
  cost: number;
  prev?: PathCandidate;
};

export function findRoute(
  game: GameState,
  now: number,
  player: Doc<'players'>,
  destination: Point,
): Path | string {
  if (blocked(game, destination, player)) {
    return 'destination blocked';
  }
  const minDistances: PathCandidate[][] = [];
  const explore = (current: PathCandidate): Array<PathCandidate> => {
    let deltas: { vector: Vector; dx: number; dy: number }[] = [];

    // Initial condition: Try to move to an adjacent grid point.
    const xSnap = Math.floor(current.pos.x);
    const ySnap = Math.floor(current.pos.y);
    if (xSnap !== current.pos.x) {
      deltas = [
        { vector: { dx: -1, dy: 0 }, dx: xSnap - current.pos.x, dy: 0 },
        { vector: { dx: 1, dy: 0 }, dx: xSnap + 1 - current.pos.x, dy: 0 },
      ];
    } else if (ySnap !== current.pos.y) {
      deltas = [
        { vector: { dx: 0, dy: -1 }, dx: 0, dy: ySnap - current.pos.y },
        { vector: { dx: 0, dy: 1 }, dx: 0, dy: ySnap + 1 - current.pos.y },
      ];
    }

    // Otherwise: Explore in each of the grid directions.
    else {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        deltas.push({ vector: { dx, dy }, dx, dy });
      }
    }
    const next = [];
    for (const { vector, dx, dy } of deltas) {
      const length = current.length + 1;
      const pos = { x: current.pos.x + dx, y: current.pos.y + dy };
      if (blocked(game, pos, player)) {
        continue;
      }
      const remaining = manhattanDistance(pos, destination);
      const path = {
        pos,
        vector,
        // Movement speed is in tiles per second.
        t: current.t + 1000 / movementSpeed,
        length,
        cost: length + remaining,
        prev: current,
      };
      const existingMin = minDistances[pos.y]?.[pos.x];
      if (!existingMin) {
        minDistances[pos.y] ??= [];
        minDistances[pos.y][pos.x] = path;
      } else if (path.cost >= existingMin.cost) {
        continue;
      }
      next.push(path);
    }
    return next;
  };

  let current: PathCandidate | undefined = {
    pos: { ...player.position },
    vector: undefined,
    t: now,
    length: 0,
    cost: manhattanDistance(player.position, destination),
    prev: undefined,
  };
  const minheap = MinHeap<PathCandidate>((more, less) => more.cost > less.cost);
  while (current) {
    if (pointsEqual(current.pos, destination)) {
      break;
    }
    for (const candidate of explore(current)) {
      minheap.push(candidate);
    }
    current = minheap.pop();
  }
  if (!current) {
    return "couldn't find path";
  }
  const densePath = [];
  let vector = { dx: 0, dy: 0 };
  while (current) {
    densePath.push({ position: current.pos, t: current.t, vector });
    vector = current.vector!;
    current = current.prev;
  }
  densePath.reverse();

  const pathStr = densePath.map((p) => JSON.stringify(p.position)).join(', ');
  console.log(
    `Routing between ${JSON.stringify(player.position)} and ${JSON.stringify(
      destination,
    )}: ${pathStr}`,
  );
  return densePath;
}

export function blocked(game: GameState, pos: Point, player: Doc<'players'>) {
  if (isNaN(pos.x) || isNaN(pos.y)) {
    throw new Error(`NaN position in ${JSON.stringify(pos)}`);
  }
  if (pos.x < 0 || pos.y < 0 || pos.x >= world.width || pos.y >= world.height) {
    return 'out of bounds';
  }
  if (map.objectTiles[Math.floor(pos.y)][Math.floor(pos.x)] !== -1) {
    return 'world blocked';
  }
  for (const otherPlayerId of game.players.allIds()) {
    if (otherPlayerId === player._id) {
      continue;
    }
    const otherPlayer = game.players.lookup(otherPlayerId);
    if (distance(otherPlayer.position, pos) < COLLISION_THRESHOLD) {
      return 'player collision';
    }
  }
  return null;
}
