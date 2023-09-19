import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const memoryTables = {
  conversationMemories: defineTable({
    playerId: v.id('players'),
    embedding: v.id('embeddings'),
    conversationWith: v.id('players'),
  }),
};
