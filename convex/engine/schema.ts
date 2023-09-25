import { defineTable } from 'convex/server';
import { v } from 'convex/values';

const inputs = v.object({
  // Inputs are scoped to a single world.
  worldId: v.id('worlds'),

  // Monotonically increasing input number within a world starting at 0.
  number: v.number(),

  // Name of the input handler to run.
  name: v.string(),
  // Dynamically typed arguments and return value for the input handler. We'll
  // provide type safety at a higher layer.
  args: v.any(),
  returnValue: v.optional(
    v.union(
      v.object({
        kind: v.literal('ok'),
        value: v.any(),
      }),
      v.object({
        kind: v.literal('error'),
        message: v.string(),
      }),
    ),
  ),

  // Timestamp when the server received the input. This timestamp is best-effort,
  // since we don't guarantee strict monotonicity here. So, an input may not get
  // assigned to the engine step whose time interval contains this timestamp.
  received: v.number(),
});

const worlds = v.object({
  // What is the current simulation time for the engine? Monotonically increasing.
  currentTime: v.optional(v.number()),

  // Should the engine be running this world? If this is set to false,
  // the engine will quickly stop simulating the world.
  active: v.boolean(),

  // Monotonically increasing counter that allows inputs to restart the engine
  // when it's sleeping. In particular, every scheduled run of the engine
  // is predicated on a generation number, and bumping that number will
  // atomically cancel that future execution. This provides mutual exclusion
  // for our core event loop.
  generationNumber: v.number(),

  // How far has the engine processed in the input queue?
  processedInputNumber: v.optional(v.number()),
});

export const engineTables = {
  inputs2: defineTable(inputs).index('byInputNumber', ['worldId', 'number']),
  worlds: defineTable(worlds),
};
