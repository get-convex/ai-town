import { conversationTables } from './conversation';
import { embeddingsTables } from './embeddings';
import { memoryTables } from './memory';

export const classicAgentTables = {
  ...conversationTables,
  ...embeddingsTables,
  ...memoryTables,
};
