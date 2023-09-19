import { defineSchema } from 'convex/server';
import { engineTables } from './schema/engine';
import { playersTables } from './schema/players';
import { conversationsTables } from './schema/conversations';
import { embeddingsTables } from './agent/classic/embeddings';

export default defineSchema({
  ...engineTables,
  ...playersTables,
  ...conversationsTables,
  ...embeddingsTables,
});
