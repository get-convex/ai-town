import { defineSchema, defineTable } from 'convex/server';
import { engineTables } from './schema/engine';
import { playersTables } from './schema/players';
import { conversationsTables } from './schema/conversations';
import { classicAgentTables } from './agent/classic/schema';
import { embeddingsCacheTables } from './agent/lib/embeddingsCache';
import { v } from 'convex/values';
import { blocksTable } from './schema/blocks';

export default defineSchema({
  engine: defineTable({
    stopped: v.boolean(),
  }),
  ...engineTables,
  ...playersTables,
  ...conversationsTables,
  ...classicAgentTables,
  ...embeddingsCacheTables,
  ...blocksTable,
});
