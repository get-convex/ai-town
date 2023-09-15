import { defineTable } from 'convex/server';
import { v } from 'convex/values';

const conversations = defineTable({
  creator: v.id('players'),
  typing: v.optional(
    v.object({
      playerId: v.id('players'),
      started: v.number(),
    }),
  ),
  finished: v.optional(v.number()),
});

// Invariants:
// A player is in at most one conversation.
// At most two players are in one conversation.
// Two players in a conversation are close together if they're both participating.
const conversationMembers = defineTable({
  conversationId: v.id('conversations'),
  playerId: v.id('players'),
  status: v.union(v.literal('invited'), v.literal('walkingOver'), v.literal('participating')),
});

const messages = defineTable({
  conversationId: v.id('conversations'),
  author: v.id('players'),
  streamed: v.boolean(),
  doneWriting: v.boolean(),
});

// Separate out the actual message text to be state not managed by the game engine. This way we can
// append chunks to it out of band when streaming in tokens from OpenAI.
const messageText = defineTable({
  messageId: v.id('messages'),
  text: v.string(),
});

export const conversationsTables = {
  conversations: conversations.index('finished', ['finished']),
  conversationMembers: conversationMembers
    .index('playerId', ['playerId'])
    .index('conversationId', ['conversationId', 'playerId']),
  messages: messages.index('conversationId', ['conversationId']),
  messageText: messageText.index('messageId', ['messageId']),
};
