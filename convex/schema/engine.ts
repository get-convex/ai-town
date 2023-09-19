import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { args, returnValue } from './input';

// The steps table is entirely engine-specific and
// records how server time has advanced. Eventually,
// this could also include PRNG seeds to ensure
// determinism.
const steps = defineTable({
  startTs: v.number(),
  endTs: v.number(),
});

export const engineTables = {
  inputs: defineTable({
    serverTimestamp: v.number(),
    args,
    returnValue: v.optional(returnValue),
  }).index('serverTimestamp', ['serverTimestamp']),
  steps: steps.index('endTs', ['endTs']),
};
