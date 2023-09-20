import { defineSchema } from 'convex/server';
import { engineTables } from './schema/engine';
import { playersTables } from './schema/players';
import { conversationsTables } from './schema/conversations';
import { embeddingsTables } from './agent/classic/embeddings';
import { memoryTables } from './agent/classic/memory';

export default defineSchema({
  ...engineTables,
  ...playersTables,
  ...conversationsTables,
  ...embeddingsTables,
  ...memoryTables,
});
