import { defineSchema, defineTable } from 'convex/server';
import { classicAgentTables } from './agent/classic/schema';
import { embeddingsCacheTables } from './agent/lib/embeddingsCache';
import { v } from 'convex/values';
import { gameTables } from './game/schema';

export default defineSchema({
  engine: defineTable({
    stopped: v.boolean(),
  }),
  ...classicAgentTables,
  ...embeddingsCacheTables,
  ...gameTables,
});
