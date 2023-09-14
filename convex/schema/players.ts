import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { packedPositionBuffer } from '../util/positionBuffer';
import { path, point } from './types';

const pathfinding = v.object({
  destination: point,
  started: v.number(),
  state: v.union(
    v.object({
      kind: v.literal('needsPath'),
    }),
    v.object({
      kind: v.literal('waiting'),
      until: v.number(),
    }),
    v.object({
      kind: v.literal('moving'),
      path,
    }),
  ),
});
export type Pathfinding = typeof pathfinding.type;

// The players table has game-specific public state, like
// the player's name and position, some internal state,
// like its current pathfinding state, and some engine
// specific state, like a position buffer of the player's
// positions over the last step. Eventually we can pull this
// out into something engine managed.
const players = defineTable({
  name: v.string(),
  character: v.number(),

  position: point,
  // Degrees counterclockwise from east/right.
  orientation: v.number(),

  pathfinding: v.optional(pathfinding),

  previousPositions: v.optional(packedPositionBuffer),
});

// We currently manage this table outside the game engine, but
// we could move it (and auth) in if we want to prevent cheating.
const humans = defineTable({
  tokenIdentifier: v.string(),
  joined: v.number(),
  playerId: v.optional(v.id('players')),
});

export const playersTables = {
  players,
  humans: humans.index('tokenIdentifier', ['tokenIdentifier']),
};
