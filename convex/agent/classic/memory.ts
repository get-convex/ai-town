import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
  ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from '../../_generated/server';
import { Id } from '../../_generated/dataModel';
import { internal } from '../../_generated/api';
import { LLMMessage, chatCompletion } from '../lib/openai';
import * as embeddings from './embeddings';

const selfInternal = internal.agent.classic.memory;

export const debugRememberConversation = internalAction({
  args: {
    playerId: v.id('players'),
    conversationId: v.id('conversations'),
  },
  handler: async (ctx, args) => {
    return await rememberConversation(ctx, args.playerId, args.conversationId);
  },
});

export async function rememberConversation(
  ctx: ActionCtx,
  playerId: Id<'players'>,
  conversationId: Id<'conversations'>,
) {
  const { player, otherPlayer } = await ctx.runQuery(selfInternal.loadConversation, {
    playerId,
    conversationId,
  });
  const messages = await ctx.runQuery(selfInternal.loadMessages, { conversationId });
  if (!messages.length) {
    return;
  }
  const llmMessages: LLMMessage[] = [
    {
      role: 'user',
      content: `You are ${player.name} (identity: ${player._id}), and you just finished a conversation with
      ${otherPlayer.name} (identity: ${otherPlayer._id}). I would like you to summarize the conversation
      from ${player.name}'s (identity: ${player._id}) perspective, using first-person pronouns like "I," and
      add if you liked or disliked this interaction.`,
    },
  ];
  for (const message of messages) {
    const author = message.author === player._id ? player : otherPlayer;
    const recipient = message.author === player._id ? otherPlayer : player;
    llmMessages.push({
      role: 'user',
      content: `${author.name} (identity: ${author._id}) to ${recipient.name} (identity: ${recipient._id}): ${message.text}`,
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
    player._id,
    `${player._id}:${otherPlayer._id}`,
  );
  await ctx.runMutation(selfInternal.insertMemory, {
    owner: player._id,
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

export const insertMemory = internalMutation({
  args: {
    owner: v.id('players'),
    talkingTo: v.id('players'),
    embedding: v.id('embeddings'),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('conversationMemories', args);
  },
});

export const memoryTables = {
  conversationMemories: defineTable({
    owner: v.id('players'),
    talkingTo: v.id('players'),
    embedding: v.id('embeddings'),
  }),
};
