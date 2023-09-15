import { v } from 'convex/values';
import { Doc, Id } from './_generated/dataModel';
import { DatabaseReader, query } from './_generated/server';

export default query({
  handler: async (ctx) => {
    const lastStep = await ctx.db.query('steps').withIndex('endTs').order('desc').first();
    const identity = await ctx.auth.getUserIdentity();

    // Query the active conversations and all their members as game state.
    // The client can load the messages and their content on demand.
    const conversationRows = await ctx.db
      .query('conversations')
      .withIndex('finished', (q) => q.gt('finished', null as any))
      .collect();
    const conversations = [];
    for (const row of conversationRows) {
      const members = await ctx.db
        .query('conversationMembers')
        .withIndex('conversationId', (q) => q.eq('conversationId', row._id))
        .collect();
      conversations.push({ members, ...row });
    }
    return {
      startTs: lastStep?.startTs ?? Date.now(),
      endTs: lastStep?.endTs ?? Date.now(),

      players: await ctx.db.query('players').collect(),
      conversations,
    };
  },
});

export const playerMetadata = query({
  args: {
    playerId: v.id('players'),
  },
  handler: async (ctx, args) => {
    const player = await ctx.db.get(args.playerId);
    if (!player) {
      console.warn(`Invalid player ID: ${args.playerId}`);
      return null;
    }
    // Check if the player is a conversation.
    const member = await ctx.db
      .query('conversationMembers')
      .withIndex('playerId', (q) => q.eq('playerId', player._id))
      .first();
    let conversation: Doc<'conversations'> | null = null;
    if (member) {
      const row = await ctx.db.get(member.conversationId);
      if (row && !row.finished) {
        conversation = row;
      }
    }
    return {
      _id: args.playerId,
      name: player.name,
      member,
      conversation,
    };
  },
});

export const userPlayerId = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }
    const human = await ctx.db
      .query('humans')
      .withIndex('tokenIdentifier', (q) => q.eq('tokenIdentifier', identity.tokenIdentifier))
      .unique();
    return human?.playerId ?? null;
  },
});

export const listConversation = query({
  args: {
    conversationId: v.id('conversations'),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('conversationId', (q) => q.eq('conversationId', args.conversationId))
      .collect();
    const withText = [];
    for (const message of messages) {
      const author = await ctx.db.get(message.author);
      if (!author) {
        throw new Error(`Invalid author ID: ${JSON.stringify(message)}`);
      }
      const textFragments = await ctx.db
        .query('messageText')
        .withIndex('messageId', (q) => q.eq('messageId', message._id))
        .collect();
      withText.push({ authorName: author?.name, textFragments, ...message });
    }
    return withText;
  },
});
