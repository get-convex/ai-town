import { Doc } from '../_generated/dataModel';
import { movementSpeed } from '../data/characters';
import { COLLISION_THRESHOLD, map, world } from '../schema';
import { Path, Point, Vector } from '../schema/types';
import { distance, manhattanDistance, pointsEqual } from '../util/geometry';
import { MinHeap } from '../util/minheap';
import { GameState } from './state';

type PathCandidate = {
  position: Point;
  facing?: Vector;
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
  const allPlayers = game.players.allIds().map((id) => game.players.lookup(id));
  if (blocked(allPlayers, destination, player)) {
    return 'destination blocked';
  }
  const minDistances: PathCandidate[][] = [];
  const explore = (current: PathCandidate): Array<PathCandidate> => {
    const { x, y } = current.position;
    const neighbors = [];

    // If we're not on a grid point, first try to move horizontally
    // or vertically to a grid point. Note that this can create very small
    // deltas between the current position and the nearest grid point so
    // be careful to preserve the `facing` vectors rather than trying to
    // derive them anew.
    if (x !== Math.floor(x)) {
      neighbors.push(
        { position: { x: Math.floor(x), y }, facing: { dx: -1, dy: 0 } },
        { position: { x: Math.floor(x) + 1, y }, facing: { dx: 1, dy: 0 } },
      );
    }
    if (y !== Math.floor(y)) {
      neighbors.push(
        { position: { x, y: Math.floor(y) }, facing: { dx: 0, dy: -1 } },
        { position: { x, y: Math.floor(y) + 1 }, facing: { dx: 0, dy: 1 } },
      );
    }
    // Otherwise, just move to adjacent grid points.
    if (x == Math.floor(x) && y == Math.floor(y)) {
      neighbors.push(
        { position: { x: x + 1, y }, facing: { dx: 1, dy: 0 } },
        { position: { x: x - 1, y }, facing: { dx: -1, dy: 0 } },
        { position: { x, y: y + 1 }, facing: { dx: 0, dy: 1 } },
        { position: { x, y: y - 1 }, facing: { dx: 0, dy: -1 } },
      );
    }
    const next = [];
    for (const { position, facing } of neighbors) {
      const segmentLength = distance(current.position, position);
      const length = current.length + segmentLength;
      if (blocked(allPlayers, position, player)) {
        continue;
      }
      const remaining = manhattanDistance(position, destination);
      const path = {
        position,
        facing,
        // Movement speed is in tiles per second.
        t: current.t + (segmentLength / movementSpeed) * 1000,
        length,
        cost: length + remaining,
        prev: current,
      };
      const existingMin = minDistances[position.y]?.[position.x];
      if (existingMin && existingMin.cost <= path.cost) {
        continue;
      }
      minDistances[position.y] ??= [];
      minDistances[position.y][position.x] = path;
      next.push(path);
    }
    return next;
  };

  let current: PathCandidate | undefined = {
    position: { ...player.position },
    // We'll set the facing vector based on where we go to next.
    facing: undefined,
    t: now,
    length: 0,
    cost: manhattanDistance(player.position, destination),
    prev: undefined,
  };
  const minheap = MinHeap<PathCandidate>((p0, p1) => p0.cost > p1.cost);
  while (current) {
    if (pointsEqual(current.position, destination)) {
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
  let facing = current.facing!;
  while (current) {
    densePath.push({ position: current.position, t: current.t, facing });
    facing = current.facing!;
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

export function blocked(allPlayers: Doc<'players'>[], pos: Point, player: Doc<'players'>) {
  if (isNaN(pos.x) || isNaN(pos.y)) {
    throw new Error(`NaN position in ${JSON.stringify(pos)}`);
  }
  if (pos.x < 0 || pos.y < 0 || pos.x >= world.width || pos.y >= world.height) {
    return 'out of bounds';
  }
  if (map.objectTiles[Math.floor(pos.y)][Math.floor(pos.x)] !== -1) {
    return 'world blocked';
  }
  for (const otherPlayer of allPlayers) {
    if (otherPlayer._id === player._id) {
      continue;
    }
    if (distance(otherPlayer.position, pos) < COLLISION_THRESHOLD) {
      return 'player collision';
    }
  }
  return null;
}
