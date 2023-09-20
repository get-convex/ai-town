import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { point } from '../util/types';

// The players table has game-specific public state, like
// the player's name and position, some internal state,
// like its current pathfinding state, and some engine
// specific state, like a position buffer of the player's
// positions over the last step. Eventually we can pull this
// out into something engine managed.
const blocks = defineTable({
  metadata: v.union(
    v.object({
      state: v.literal('waitingForNearby'),
      player: v.id('players'),
      position: point,
    }),
    v.object({
      state: v.literal('carried'),
      player: v.id('players'),
    }),
    v.object({
      state: v.literal('placed'),
      position: point,
    }),
  ),
});

export const blocksTable = {
  blocks: blocks,
};
