import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
  ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from '../../_generated/server';
import { Doc, Id } from '../../_generated/dataModel';
import { internal } from '../../_generated/api';
import { LLMMessage, chatCompletion } from '../lib/openai';
import * as embeddings from './embeddings';

const selfInternal = internal.agent.classic.memory;

export async function rememberConversation(
  ctx: ActionCtx,
  playerId: Id<'players'>,
  conversationId: Id<'conversations'>,
) {
  const data = await ctx.runQuery(selfInternal.loadConversation, {
    playerId,
    conversationId,
  });
  if (data === null) {
    console.log(`Conversation ${conversationId} already remembered`);
    return;
  }
  const { player, otherPlayer } = data;
  const messages = await ctx.runQuery(selfInternal.loadMessages, { conversationId });
  if (!messages.length) {
    return;
  }
  const llmMessages: LLMMessage[] = [
    {
      role: 'user',
      content: `You are ${player.name}, and you just finished a conversation with ${otherPlayer.name}. I would
      like you to summarize the conversation from ${player.name}'s perspective, using first-person pronouns like
      "I," and add if you liked or disliked this interaction.`,
    },
  ];
  for (const message of messages) {
    const author = message.author === player._id ? player : otherPlayer;
    const recipient = message.author === player._id ? otherPlayer : player;
    llmMessages.push({
      role: 'user',
      content: `${author.name} to ${recipient.name}: ${message.text}`,
    });
  }
  llmMessages.push({ role: 'user', content: 'Summary:' });
  const { content: description } = await chatCompletion({
    messages: llmMessages,
    max_tokens: 500,
  });
  const summary = await description.readAll();
  const embeddingId = await embeddings.insert(
    ctx,
    summary,
    tag1(player._id),
    tag2(player._id, otherPlayer._id),
  );
  await ctx.runMutation(selfInternal.insertMemory, {
    owner: player._id,
    conversation: conversationId,
    talkingTo: otherPlayer._id,
    embedding: embeddingId,
  });
  return summary;
}

export const loadConversation = internalQuery({
  args: {
    playerId: v.id('players'),
    conversationId: v.id('conversations'),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('conversationMemories')
      .withIndex('owner', (q) =>
        q.eq('owner', args.playerId).eq('conversation', args.conversationId),
      )
      .first();
    if (existing) {
      return null;
    }
    const player = await ctx.db.get(args.playerId);
    if (!player) {
      throw new Error(`Player ${args.playerId} not found`);
    }
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${args.conversationId} not found`);
    }
    const conversationMembers = await ctx.db
      .query('conversationMembers')
      .withIndex('conversationId', (q) => q.eq('conversationId', args.conversationId))
      .filter((q) => q.neq(q.field('playerId'), args.playerId))
      .collect();
    if (conversationMembers.length !== 1) {
      throw new Error(`Conversation ${args.conversationId} not with exactly one other player`);
    }
    const otherPlayer = await ctx.db.get(conversationMembers[0].playerId);
    if (!otherPlayer) {
      throw new Error(`Conversation ${args.conversationId} other player not found`);
    }
    return {
      player,
      conversation,
      otherPlayer,
    };
  },
});

export async function queryOpinionAboutPlayer(
  ctx: ActionCtx,
  player: Doc<'players'>,
  otherPlayer: Doc<'players'>,
) {
  // Store our cached embedding under tag1 (i.e. for just our player).
  const { embedding } = await embeddings.fetch(
    ctx,
    `What do you think about ${otherPlayer.name}?`,
    { tag1: tag1(player._id) },
  );
  const results = await embeddings.query(ctx, embedding, 10, {
    // Only query for memories that have tag2 set (i.e. are for our player and conversation).
    tag2: tag2(player._id, otherPlayer._id),
  });
  const summaries = await ctx.runQuery(selfInternal.loadTexts, {
    embeddingIds: results.map((r) => r._id),
  });
  return summaries;
}

export const loadMessages = internalQuery({
  args: {
    conversationId: v.id('conversations'),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('conversationId', (q) => q.eq('conversationId', args.conversationId))
      .collect();
    const out = [];
    for (const message of messages) {
      const textDocuments = await ctx.db
        .query('messageText')
        .withIndex('messageId', (q) => q.eq('messageId', message._id))
        .collect();
      const text = textDocuments.map((d) => d.text).join(' ');
      out.push({ text, ...message });
    }
    return out;
  },
});

export const loadTexts = internalQuery({
  args: {
    embeddingIds: v.array(v.id('embeddings')),
  },
  handler: async (ctx, args) => {
    const out = [];
    for (const embeddingId of args.embeddingIds) {
      const embedding = await ctx.db.get(embeddingId);
      if (!embedding) {
        throw new Error(`Embedding ${embeddingId} not found`);
      }
      out.push(embedding.text);
    }
    return out;
  },
});

export const insertMemory = internalMutation({
  args: {
    owner: v.id('players'),
    conversation: v.id('conversations'),
    talkingTo: v.id('players'),
    embedding: v.id('embeddings'),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('conversationMemories', args);
  },
});

export function tag1(playerId: Id<'players'>) {
  return playerId;
}

export function tag2(playerId: Id<'players'>, otherPlayerId: Id<'players'>) {
  return `${playerId}:${otherPlayerId}`;
}

const conversationMemories = v.object({
  owner: v.id('players'),
  conversation: v.id('conversations'),
  talkingTo: v.id('players'),
  embedding: v.id('embeddings'),
});

export const memoryTables = {
  conversationMemories: defineTable(conversationMemories).index('owner', ['owner', 'conversation']),
};

export const debugRememberConversation = internalAction({
  args: {
    playerId: v.id('players'),
    conversationId: v.id('conversations'),
  },
  handler: async (ctx, args) => {
    return await rememberConversation(ctx, args.playerId, args.conversationId);
  },
});
