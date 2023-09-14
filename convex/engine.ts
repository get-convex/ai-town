import { v } from 'convex/values';
import { DatabaseReader, DatabaseWriter, mutation } from './_generated/server';
import { COLLISION_THRESHOLD, map, world } from './schema';
import { Path, Point, Vector, point } from './schema/types';
import { Doc, Id, TableNames } from './_generated/dataModel';
import {
  distance,
  manhattanDistance,
  orientationDegrees,
  pathPosition,
  pointsEqual,
} from './util/geometry';
import { MinHeap } from './util/minheap';
import { movementSpeed } from './data/characters';
import { api } from './_generated/api';
import { PositionBuffer } from './util/positionBuffer';
import { MAX_STEP, TICK, PATHFINDING_TIMEOUT, PATHFINDING_BACKOFF } from './constants';
import { PlayerInput, playerInput } from './schema/input';
import { assertNever } from './util/assertNever';

export const addPlayerInput = mutation({
  args: {
    playerId: v.id('players'),
    input: playerInput,
  },
  handler: async (ctx, args) => {
    await insertInput(ctx.db, args.playerId, args.input);
  },
});

export async function insertInput(
  db: DatabaseWriter,
  playerId: Id<'players'>,
  payload: PlayerInput,
) {
  const serverTimestamp = Date.now();
  const lastInput = await db
    .query('inputQueue')
    .withIndex('clientTimestamp', (q) => q.eq('playerId', playerId))
    .order('desc')
    .first();
  if (lastInput !== null) {
    if (lastInput.serverTimestamp >= serverTimestamp) {
      throw new Error('Time not moving forwards');
    }
  }
  await db.insert('inputQueue', {
    playerId,
    serverTimestamp,
    payload,
  });
}

export const step = mutation({
  handler: async (ctx) => {
    const now = Date.now();

    const lastStep = await ctx.db.query('steps').withIndex('endTs').order('desc').first();
    if (lastStep && lastStep.endTs >= now) {
      throw new Error(`Time moving backwards!`);
    }
    const lastServerTs = lastStep ? lastStep.endTs : -1;
    const startTs = lastStep ? lastStep.endTs : now;
    const endTs = Math.min(now, startTs + MAX_STEP);
    console.log(`Simulating ${startTs} -> ${endTs}: (${Math.round(endTs - startTs)}ms)`);

    // Load the game state.
    const gameState = await GameState.load(startTs, ctx.db);

    // Collect player inputs since the last step, sorted by (serverTimestamp, playerId, _id)
    const stepInputs = [];
    for (const player of Object.values(gameState.players)) {
      const playerInputs = await ctx.db
        .query('inputQueue')
        .withIndex('clientTimestamp', (q) =>
          q
            .eq('playerId', player._id)
            .gt('serverTimestamp', lastServerTs)
            .lte('serverTimestamp', endTs),
        )
        .collect();
      stepInputs.push(...playerInputs);
    }
    stepInputs.sort((a, b) => {
      if (a.serverTimestamp !== b.serverTimestamp) {
        return a.serverTimestamp - b.serverTimestamp;
      }
      if (a.playerId !== b.playerId) {
        return a.playerId.localeCompare(b.playerId);
      }
      return a._id.localeCompare(b._id);
    });

    let inputIndex = 0;
    let currentTs;
    for (currentTs = startTs; currentTs <= endTs; currentTs += TICK) {
      while (inputIndex < stepInputs.length) {
        const input = stepInputs[inputIndex];
        if (input.serverTimestamp > currentTs) {
          break;
        }
        inputIndex += 1;
        gameState.handleInput(input);
      }
      gameState.tick(currentTs);
    }
    // "Commit" the update by writing back the game state and a new steps checkpoint.
    await gameState.save(ctx.db, currentTs);
    await ctx.db.insert('steps', { startTs, endTs: currentTs });
  },
});

class MappedTable<T extends TableNames> {
  data: Map<Id<T>, Doc<T>> = new Map();
  modified: Set<Id<T>> = new Set();

  constructor(
    private writer: DatabaseWriter,
    rows: Doc<T>[],
  ) {
    for (const row of rows) {
      this.data.set(row._id, row);
    }
  }
}

export class GameState {
  playersModified: Set<Id<'players'>> = new Set();
  playersMoved: Map<Id<'players'>, PositionBuffer> = new Map();

  constructor(
    public startTs: number,
    public players: Record<Id<'players'>, Doc<'players'>>,
  ) {}

  static async load(startTs: number, db: DatabaseReader) {
    const players: Record<Id<'players'>, Doc<'players'>> = {};
    for await (const player of db.query('players')) {
      players[player._id] = player;
    }
    return new GameState(startTs, players);
  }

  handleInput({ playerId, payload }: Doc<'inputQueue'>) {
    const player = this.players[playerId];
    if (!player) {
      console.warn(`Invalid player ID: ${playerId}`);
      return;
    }
    switch (payload.kind) {
      case 'moveTo':
        this.handleMoveTo(player, payload.destination);
        break;
      case 'startConversation':
        break;
      case 'acceptInvite':
        break;
      case 'rejectInvite':
        break;
      case 'startTyping':
        break;
      case 'writeMessage':
        break;
      case 'leaveConversation':
        break;
      default:
        assertNever(payload);
    }
  }

  handleStartConversation(player: Doc<'players'>, invite: Id<'players'>) {}

  handleMoveTo(player: Doc<'players'>, destination: Point | null) {
    if (destination === null) {
      delete player.pathfinding;
      this.playersModified.add(player._id);
      return;
    }
    if (
      Math.floor(destination.x) !== destination.x ||
      Math.floor(destination.y) !== destination.y
    ) {
      console.warn(`Non-integral destination: ${JSON.stringify(destination)}`);
      return;
    }
    // Close enough to current position or destination => no-op.
    if (pointsEqual(player.position, destination)) {
      return;
    }
    player.pathfinding = {
      destination: destination,
      started: Date.now(),
      state: {
        kind: 'needsPath',
      },
    };
    this.playersModified.add(player._id);
  }

  tick(now: number) {
    for (const player of Object.values(this.players)) {
      const { pathfinding } = player;
      if (!pathfinding) {
        continue;
      }

      // Stop pathfinding if we've reached our destination.
      if (
        pathfinding.state.kind === 'moving' &&
        pointsEqual(pathfinding.destination, player.position)
      ) {
        delete player.pathfinding;
        this.playersModified.add(player._id);
      }

      // Stop pathfinding if we've timed out.
      if (pathfinding.started + PATHFINDING_TIMEOUT < now) {
        console.warn(`Timing out pathfinding for ${player._id}`);
        delete player.pathfinding;
        this.playersModified.add(player._id);
      }

      // Transition from "waiting" to "needsPath" if we're past the deadline.
      if (pathfinding.state.kind === 'waiting' && pathfinding.state.until < now) {
        pathfinding.state = { kind: 'needsPath' };
        this.playersModified.add(player._id);
      }

      // Perform pathfinding if needed.
      if (pathfinding.state.kind === 'needsPath') {
        const path = this.findRoute(now, player, pathfinding.destination);
        if (typeof path === 'string') {
          console.log(`Failed to route: ${path}`);
          delete player.pathfinding;
        } else {
          pathfinding.state = { kind: 'moving', path };
        }
        this.playersModified.add(player._id);
      }

      // Try to move the player along their path, clearing the path if they'd collide into something.
      if (player.pathfinding && player.pathfinding.state.kind === 'moving') {
        const collisionReason = this.tickPosition(now, player, player.pathfinding.state.path);
        if (collisionReason !== null) {
          const backoff = Math.random() * PATHFINDING_BACKOFF;
          console.warn(
            `Stopping path for ${player._id}, waiting for ${backoff}ms: ${collisionReason}`,
          );
          player.pathfinding.state = {
            kind: 'waiting',
            until: now + backoff,
          };
          this.playersModified.add(player._id);
        }
      }
    }
  }

  findRoute(now: number, player: Doc<'players'>, destination: Point): Path | string {
    if (this.blocked(destination, player)) {
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
        if (this.blocked(pos, player)) {
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

  blocked(pos: Point, player: Doc<'players'>) {
    if (isNaN(pos.x) || isNaN(pos.y)) {
      throw new Error(`NaN position in ${JSON.stringify(pos)}`);
    }
    if (pos.x < 0 || pos.y < 0 || pos.x >= world.width || pos.y >= world.height) {
      return 'out of bounds';
    }
    if (map.objectTiles[Math.floor(pos.y)][Math.floor(pos.x)] !== -1) {
      return 'world blocked';
    }
    for (const otherPlayer of Object.values(this.players)) {
      if (otherPlayer._id === player._id) {
        continue;
      }
      if (distance(otherPlayer.position, pos) < COLLISION_THRESHOLD) {
        return 'player collision';
      }
    }
    return null;
  }

  tickPosition(now: number, player: Doc<'players'>, path: Path): null | string {
    const candidate = pathPosition(path, now);
    const collisionReason = this.blocked(candidate.position, player);
    if (collisionReason !== null) {
      return collisionReason;
    }
    const orientation = orientationDegrees(candidate.vector);
    this.movePlayer(now, player._id, candidate.position, orientation);
    this.playersModified.add(player._id);
    return null;
  }

  movePlayer(now: number, id: Id<'players'>, position: Point, orientation: number) {
    const player = this.players[id];
    let buffer = this.playersMoved.get(id);
    if (!buffer) {
      buffer = new PositionBuffer();
      buffer.push(this.startTs, player.position.x, player.position.y, player.orientation);
      if (now > this.startTs) {
        buffer.push(now - TICK, player.position.x, player.position.y, player.orientation);
      }
      this.playersMoved.set(id, buffer);
    }
    player.position = position;
    player.orientation = orientation;
    buffer.push(now, position.x, position.y, orientation);
    this.playersModified.add(id);
  }

  async save(db: DatabaseWriter, endTs: number) {
    for (const player of Object.values(this.players)) {
      if (player.previousPositions) {
        delete player.previousPositions;
        this.playersModified.add(player._id);
      }
    }
    let numMoved = 0;
    let bufferSize = 0;
    for (const [id, buffer] of this.playersMoved.entries()) {
      const player = this.players[id];
      if (buffer.maxTs()! < endTs) {
        buffer.push(endTs, player.position.x, player.position.y, player.orientation);
      }
      const packed = buffer.pack();
      player.previousPositions = packed;
      this.playersModified.add(id);
      numMoved += 1;
      bufferSize += packed.x.byteLength + packed.y.byteLength + packed.t.byteLength;
    }
    console.log(`Packed ${numMoved} moved players in ${(bufferSize / 1024).toFixed(2)}KiB`);
    for (const id of this.playersModified) {
      await db.replace(id, this.players[id]!);
    }
  }
}

type PathCandidate = {
  pos: Point;
  vector?: Vector;
  t: number;
  length: number;
  cost: number;
  prev?: PathCandidate;
};
