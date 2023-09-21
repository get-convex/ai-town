import { startConversation, continueConversation, leaveConversation } from './conversation';

import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { rememberConversation } from './memory';

const selfInternal = internal.agent.classic.debug;

const DEBUG_PROMPTS = false;
export function debugPrompt(prompt: string[]) {
  if (!DEBUG_PROMPTS) {
    return;
  }
  for (const line of prompt) {
    console.log(`Prompt: ${line}`);
  }
}

export const debugRun = internalAction({
  args: {
    playerId: v.id('players'),
    doOther: v.boolean(),
    leave: v.boolean(),
  },
  handler: async (ctx, args): Promise<string> => {
    const { player, otherPlayer, conversation, empty } = await ctx.runQuery(
      selfInternal.debugRunLoad,
      { playerId: args.playerId },
    );
    const a = args.doOther ? otherPlayer : player;
    const b = args.doOther ? player : otherPlayer;
    let content;
    if (empty) {
      content = await startConversation(ctx, conversation, a, b);
    } else if (!args.leave) {
      content = await continueConversation(ctx, conversation, a, b);
    } else {
      content = await leaveConversation(ctx, conversation, a, b);
    }
    const message = await content.readAll();
    await ctx.runMutation(selfInternal.debugSendMessage, {
      conversationId: conversation._id,
      playerId: player._id,
      message,
    });
    return message;
  },
});

export const debugSendMessage = internalMutation({
  args: {
    conversationId: v.id('conversations'),
    playerId: v.id('players'),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const messageId = await ctx.db.insert('messages', {
      conversationId: args.conversationId,
      author: args.playerId,
      streamed: false,
      doneWriting: true,
    });
    await ctx.db.insert('messageText', {
      messageId,
      text: args.message,
    });
  },
});

export const debugRunLoad = internalQuery({
  args: {
    playerId: v.id('players'),
  },
  handler: async (ctx, args) => {
    const player = await ctx.db.get(args.playerId);
    if (!player) {
      throw new Error(`Player ${args.playerId} not found`);
    }
    const member = await ctx.db
      .query('conversationMembers')
      .withIndex('playerId', (q) => q.eq('playerId', args.playerId))
      .filter((q) => q.eq(q.field('status'), 'participating'))
      .first();
    if (!member) {
      throw new Error(`Player ${args.playerId} is not in a conversation`);
    }
    const conversation = await ctx.db.get(member.conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${member.conversationId} not found`);
    }
    const otherPlayerMember = await ctx.db
      .query('conversationMembers')
      .withIndex('conversationId', (q) => q.eq('conversationId', conversation._id))
      .filter((q) => q.neq(q.field('playerId'), args.playerId))
      .first();
    if (!otherPlayerMember) {
      throw new Error(`Conversation ${conversation._id} has no other player`);
    }
    const otherPlayer = await ctx.db.get(otherPlayerMember.playerId);
    if (!otherPlayer) {
      throw new Error(`Player ${otherPlayerMember.playerId} not found`);
    }
    const lastMessage = await ctx.db
      .query('messages')
      .withIndex('conversationId', (q) => q.eq('conversationId', conversation._id))
      .order('desc')
      .first();
    const empty = lastMessage === null;
    return { player, otherPlayer, conversation, empty };
  },
});

export const debugRememberConversation = internalAction({
  args: {
    playerId: v.id('players'),
    conversationId: v.id('conversations'),
  },
  handler: async (ctx, args) => {
    return await rememberConversation(ctx, args.playerId, args.conversationId);
  },
});

export const clearAllLeases = internalMutation({
  args: {},
  handler: async (ctx) => {
    const leases = await ctx.db.query('agentLeases').collect();
    for (const lease of leases) {
      lease.generation = -1;
      await ctx.db.replace(lease._id, lease);
    }
  },
});
