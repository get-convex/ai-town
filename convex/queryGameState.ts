import { v } from 'convex/values';
import { Doc } from './_generated/dataModel';
import { query } from './_generated/server';

export default query({
  handler: async (ctx) => {
    const lastStep = await ctx.db.query('steps').withIndex('endTs').order('desc').first();

    const blocks = await ctx.db.query('blocks').collect();

    // Query the active conversations and all their members as game state.
    // The client can load the messages and their content on demand.
    const conversationRows = await ctx.db
      .query('conversations')
      .withIndex('finished', (q) => q.gt('finished', null as any))
      .collect();
    const conversations = [];
    for (const row of conversationRows) {
      let typingName;
      if (row.typing) {
        const player = await ctx.db.get(row.typing.playerId);
        typingName = player?.name;
      }
      const members = await ctx.db
        .query('conversationMembers')
        .withIndex('conversationId', (q) => q.eq('conversationId', row._id))
        .filter((q) => q.neq(q.field('status'), 'left'))
        .collect();
      conversations.push({ members, typingName, ...row });
    }

    const players = await ctx.db
      .query('players')
      .withIndex('enabled', (q) => q.eq('enabled', true))
      .collect();

    return {
      startTs: lastStep?.startTs ?? Date.now(),
      endTs: lastStep?.endTs ?? Date.now(),

      players,
      blocks,
      conversations,
    };
  },
});

export const previousConversation = query({
  args: {
    playerId: v.id('players'),
  },
  handler: async (ctx, args) => {
    const member = await ctx.db
      .query('conversationMembers')
      .withIndex('playerId', (q) => q.eq('playerId', args.playerId))
      .filter((q) => q.eq(q.field('status'), 'left'))
      .order('desc')
      .first();
    if (!member) {
      return null;
    }
    const conversation = await ctx.db.get(member.conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${member.conversationId} not found`);
    }
    return conversation;
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
    if (!player.enabled) {
      console.warn(`Player ${args.playerId} is not enabled!`);
      return null;
    }
    const block = await ctx.db
      .query('blocks')
      .filter((q) =>
        q.and(
          q.eq(q.field('metadata.state'), 'carried'),
          q.eq(q.field('metadata.player'), player._id),
        ),
      )
      .unique();
    // Check if the player is a conversation.
    const member = await ctx.db
      .query('conversationMembers')
      .withIndex('playerId', (q) => q.eq('playerId', player._id))
      .filter((q) => q.neq(q.field('status'), 'left'))
      .first();
    let conversation: (Doc<'conversations'> & { typingName?: string }) | null = null;
    if (member) {
      const row = await ctx.db.get(member.conversationId);
      if (row && !row.finished) {
        let typingName;
        if (row.typing) {
          const player = await ctx.db.get(row.typing.playerId);
          typingName = player?.name;
        }
        conversation = { typingName, ...row };
      }
    }
    return {
      _id: args.playerId,
      name: player.name,
      description: player.description,
      member,
      conversation,
      block,
    };
  },
});

export const blockMetadata = query({
  args: {
    blockId: v.id('blocks'),
  },
  handler: async (ctx, args) => {
    return ctx.db.get(args.blockId);
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
      withText.push({ authorName: author.name, textFragments, ...message });
    }
    return withText;
  },
});
