import { defineTable } from 'convex/server';
import { Infer, v } from 'convex/values';
import { packedPositionBuffer } from '../util/positionBuffer';
import { path, point, vector } from '../util/types';

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
export type Pathfinding = Infer<typeof pathfinding>;

// The players table has game-specific public state, like
// the player's name and position, some internal state,
// like its current pathfinding state, and some engine
// specific state, like a position buffer of the player's
// positions over the last step. Eventually we can pull this
// out into something engine managed.
const players = defineTable({
  name: v.string(),
  description: v.string(),
  character: v.number(),

  // If present, it's the auth tokenIdentifier of the owning player.
  human: v.optional(v.string()),

  // Is the player active?
  enabled: v.boolean(),

  position: point,
  // Normalized vector indicating which way they're facing.
  // Degrees counterclockwise from east/right.
  facing: vector,

  pathfinding: v.optional(pathfinding),

  previousPositions: v.optional(packedPositionBuffer),
});

export const playersTables = {
  players: players.index('enabled', ['enabled', 'human']),
};
