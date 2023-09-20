import { v } from 'convex/values';
import { Doc, Id } from '../../_generated/dataModel';
import {
  ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from '../../_generated/server';
import { LLMMessage, chatCompletion } from '../lib/openai';
import * as memory from './memory';
import { api, internal } from '../../_generated/api';
import { defineTable } from 'convex/server';

const selfInternal = internal.agent.classic.conversation;
const DEBUG_PROMPTS = false;

export async function startConversation(
  ctx: ActionCtx,
  conversation: Doc<'conversations'>,
  player: Doc<'players'>,
  otherPlayer: Doc<'players'>,
) {
  const { identity, otherIdentity, previousConversation, previousSummaries } = await loadPromptData(
    ctx,
    conversation,
    player,
    otherPlayer,
  );
  const prompt = [
    `You are ${player.name}, and you just started a conversation with ${otherPlayer.name}.`,
  ];
  prompt.push(...identityPrompt(otherPlayer, identity, otherIdentity));
  prompt.push(...previousConversationPrompt(otherPlayer, previousConversation));
  prompt.push(...conversationMemoriesPrompt(otherPlayer, previousSummaries));
  if (previousSummaries.length > 0) {
    prompt.push(
      `Be sure to include some detail or question about a previous conversation in your greeting.`,
    );
  }
  prompt.push(`${player.name}:`);

  debugPrompt(prompt);
  const { content } = await chatCompletion({
    messages: [
      {
        role: 'user',
        content: prompt.join('\n'),
      },
    ],
    max_tokens: 300,
    stop: stopWords(otherPlayer),
  });
  return await content.readAll();
}

export async function continueConversation(
  ctx: ActionCtx,
  conversation: Doc<'conversations'>,
  player: Doc<'players'>,
  otherPlayer: Doc<'players'>,
) {
  const { identity, otherIdentity, previousSummaries } = await loadPromptData(
    ctx,
    conversation,
    player,
    otherPlayer,
  );
  const now = Date.now();
  const started = new Date(conversation._creationTime);
  const prompt = [
    `You are ${player.name}, and you're currently in a conversation with ${otherPlayer.name}.`,
    `The conversation started at ${started.toLocaleString()}. It's now ${now.toLocaleString()}.`,
  ];
  prompt.push(...identityPrompt(otherPlayer, identity, otherIdentity));
  prompt.push(...conversationMemoriesPrompt(otherPlayer, previousSummaries));
  prompt.push(
    `Below is the current chat history between you and ${otherPlayer.name}.`,
    `DO NOT greet them again. Do NOT use the word "Hey" too often. Your response should be brief and within 200 characters.`,
  );
  debugPrompt(prompt);

  const llmMessages: LLMMessage[] = [
    {
      role: 'user',
      content: prompt.join('\n'),
    },
    ...(await previousMessages(ctx, player, otherPlayer, conversation._id)),
  ];
  llmMessages.push({ role: 'user', content: `${player.name}:` });
  const { content } = await chatCompletion({
    messages: llmMessages,
    max_tokens: 300,
    stop: stopWords(otherPlayer),
  });
  return await content.readAll();
}

export async function leaveConversation(
  ctx: ActionCtx,
  conversation: Doc<'conversations'>,
  player: Doc<'players'>,
  otherPlayer: Doc<'players'>,
) {
  const { identity, otherIdentity, previousSummaries } = await loadPromptData(
    ctx,
    conversation,
    player,
    otherPlayer,
  );
  const now = Date.now();
  const started = new Date(conversation._creationTime);
  const prompt = [
    `You are ${player.name}, and you're currently in a conversation with ${otherPlayer.name}.`,
    `You've decided to leave the question and would like to politely tell them you're leaving the conversation.`,
  ];
  prompt.push(...identityPrompt(otherPlayer, identity, otherIdentity));
  prompt.push(
    `Below is the current chat history between you and ${otherPlayer.name}.`,
    `How would you like to tell them that you're leaving? Your response should be brief and within 200 characters.`,
  );
  debugPrompt(prompt);
  const llmMessages: LLMMessage[] = [
    {
      role: 'user',
      content: prompt.join('\n'),
    },
    ...(await previousMessages(ctx, player, otherPlayer, conversation._id)),
  ];
  llmMessages.push({ role: 'user', content: `${player.name}:` });
  const { content } = await chatCompletion({
    messages: llmMessages,
    max_tokens: 300,
    stop: stopWords(otherPlayer),
  });
  return await content.readAll();
}

async function loadPromptData(
  ctx: ActionCtx,
  conversation: Doc<'conversations'>,
  player: Doc<'players'>,
  otherPlayer: Doc<'players'>,
) {
  const identity = await ctx.runQuery(selfInternal.loadIdentity, { playerId: player._id });
  const otherIdentity = await ctx.runQuery(selfInternal.loadIdentity, {
    playerId: otherPlayer._id,
  });
  const previousConversation = await ctx.runQuery(selfInternal.previousConversation, {
    conversationId: conversation._id,
    playerId: player._id,
    otherPlayerId: otherPlayer._id,
  });
  const previousSummaries = await memory.queryOpinionAboutPlayer(ctx, player, otherPlayer);
  return { identity, otherIdentity, previousConversation, previousSummaries };
}

function identityPrompt(
  otherPlayer: Doc<'players'>,
  identity: string | null,
  otherIdentity: string | null,
): string[] {
  const prompt = [];
  if (identity) {
    prompt.push(`About you: ${identity}`);
  }
  if (otherIdentity) {
    prompt.push(`About ${otherPlayer.name}: ${otherIdentity}`);
  }
  return prompt;
}

function previousConversationPrompt(
  otherPlayer: Doc<'players'>,
  conversation: Doc<'conversations'> | null,
): string[] {
  const prompt = [];
  if (conversation) {
    const prev = new Date(conversation._creationTime);
    const now = new Date();
    prompt.push(
      `Last time you chatted with ${
        otherPlayer.name
      } it was ${prev.toLocaleString()}. It's now ${now.toLocaleString()}.`,
    );
  }
  return prompt;
}

function conversationMemoriesPrompt(otherPlayer: Doc<'players'>, summaries: string[]): string[] {
  const prompt = [];
  if (summaries.length > 0) {
    prompt.push(
      `Here are some summaries of previous conversations with ${otherPlayer.name} in decreasing relevance order:`,
    );
    for (const text of summaries) {
      prompt.push(' - ' + text);
    }
  }
  return prompt;
}

async function previousMessages(
  ctx: ActionCtx,
  player: Doc<'players'>,
  otherPlayer: Doc<'players'>,
  conversationId: Id<'conversations'>,
) {
  const llmMessages: LLMMessage[] = [];
  const prevMessages = await ctx.runQuery(api.queryGameState.listConversation, { conversationId });
  for (const message of prevMessages) {
    const author = message.author === player._id ? player : otherPlayer;
    const recipient = message.author === player._id ? otherPlayer : player;
    const text = message.textFragments.map((t) => t.text).join('');
    llmMessages.push({
      role: 'user',
      content: `${author.name} to ${recipient.name}: ${text}`,
    });
  }
  return llmMessages;
}

export const loadIdentity = internalQuery({
  args: {
    playerId: v.id('players'),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.db
      .query('agentIdentity')
      .withIndex('playerId', (q) => q.eq('playerId', args.playerId))
      .first();
    return identity?.description ?? null;
  },
});

export const previousConversation = internalQuery({
  args: {
    conversationId: v.id('conversations'),
    playerId: v.id('players'),
    otherPlayerId: v.id('players'),
  },
  handler: async (ctx, args) => {
    const previousConversations = await ctx.db
      .query('conversationMembers')
      .withIndex('playerId', (q) => q.eq('playerId', args.playerId))
      .filter((q) => q.neq(q.field('conversationId'), args.conversationId))
      .collect();
    const conversations = [];
    for (const member of previousConversations) {
      const otherMember = await ctx.db
        .query('conversationMembers')
        .withIndex('conversationId', (q) =>
          q.eq('conversationId', member.conversationId).eq('playerId', args.otherPlayerId),
        )
        .first();
      if (otherMember) {
        const conversation = await ctx.db.get(member.conversationId);
        if (!conversation) {
          throw new Error(`Conversation ${member.conversationId} not found`);
        }
        if (conversation.finished) {
          conversations.push(conversation);
        }
      }
    }
    conversations.sort((a, b) => b._creationTime - a._creationTime);
    return conversations.length > 0 ? conversations[0] : null;
  },
});

function stopWords(otherPlayer: Doc<'players'>) {
  // These are the words we ask the LLM to stop on. OpenAI only supports 4.
  return [otherPlayer.name + ':', otherPlayer.name.toLowerCase() + ':'];
}

const agentIdentity = v.object({
  playerId: v.id('players'),
  description: v.optional(v.string()),
});
export const conversationTables = {
  agentIdentity: defineTable(agentIdentity).index('playerId', ['playerId']),
};

function debugPrompt(prompt: string[]) {
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
    let message;
    if (empty) {
      message = await startConversation(ctx, conversation, a, b);
    } else if (!args.leave) {
      message = await continueConversation(ctx, conversation, a, b);
    } else {
      message = await leaveConversation(ctx, conversation, a, b);
    }
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
    // if (player.human) {
    //   throw new Error(`Player ${args.playerId} is human`);
    // }
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
