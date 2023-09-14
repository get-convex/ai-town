import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { point } from './types';
import { playerInput } from './input';

// The input queue is a combination of generic
// engine state (the playerId and serverTimestamp)
// and the game-specific payload.
const inputQueue = defineTable({
  playerId: v.id('players'),
  serverTimestamp: v.number(),
  payload: playerInput,
});

// The steps table is entirely engine-specific and
// records how server time has advanced. Eventually,
// this could also include PRNG seeds to ensure
// determinism.
const steps = defineTable({
  startTs: v.number(),
  endTs: v.number(),
});

export const engineTables = {
  inputQueue: inputQueue.index('clientTimestamp', ['playerId', 'serverTimestamp']),
  steps: steps.index('endTs', ['endTs']),
};
