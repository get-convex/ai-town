import { v } from 'convex/values';
import { Doc, Id } from '../../_generated/dataModel';
import { ActionCtx, internalAction, internalQuery } from '../../_generated/server';
import { LLMMessage, chatCompletion } from '../lib/openai';
import * as memory from './memory';
import { api, internal } from '../../_generated/api';
import { debugPrompt } from './debug';

const selfInternal = internal.agent.classic.conversation;

export const debugStartConversation = internalAction({
  handler: async (ctx, args) => {
    const { conversation, player, otherPlayer } = await ctx.runQuery(selfInternal.debugSCQuery, {});
    const content = await startConversation(
      ctx,
      conversation as any,
      player as any,
      otherPlayer as any,
    );
    return await content.readAll();
  },
});

export const debugSCQuery = internalQuery({
  handler: async (ctx, args) => {
    const conversationId = '63v102xkzgrhqs9adjemjcqc9jjtrqr';
    const playerId = '5jxs85qnhcmqssazhp70zdpc9jjse10'; // lucky
    const otherPlayerId = '5ha0e7p9taqtxkptvw3vrk249jjphk8'; // bob
    const conversation = await ctx.db.get(conversationId as any);
    const player = await ctx.db.get(playerId as any);
    const otherPlayer = await ctx.db.get(otherPlayerId as any);
    return { conversation, player, otherPlayer };
  },
});

export async function startConversation(
  ctx: ActionCtx,
  conversation: Doc<'conversations'>,
  player: Doc<'players'>,
  otherPlayer: Doc<'players'>,
) {
  const { agent, otherAgent, previousConversation, previousSummaries } = await loadPromptData(
    ctx,
    conversation,
    player,
    otherPlayer,
  );
  const prompt = [
    `You are ${player.name}, and you just started a conversation with ${otherPlayer.name}.`,
  ];
  prompt.push(...agentPrompts(otherPlayer, agent, otherAgent));
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
  return content;
}

export async function continueConversation(
  ctx: ActionCtx,
  conversation: Doc<'conversations'>,
  player: Doc<'players'>,
  otherPlayer: Doc<'players'>,
) {
  const { agent, otherAgent, previousSummaries } = await loadPromptData(
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
  prompt.push(...agentPrompts(otherPlayer, agent, otherAgent));
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
  return content;
}

export async function leaveConversation(
  ctx: ActionCtx,
  conversation: Doc<'conversations'>,
  player: Doc<'players'>,
  otherPlayer: Doc<'players'>,
) {
  const { agent, otherAgent } = await loadPromptData(ctx, conversation, player, otherPlayer);
  const now = Date.now();
  const started = new Date(conversation._creationTime);
  const prompt = [
    `You are ${player.name}, and you're currently in a conversation with ${otherPlayer.name}.`,
    `You've decided to leave the question and would like to politely tell them you're leaving the conversation.`,
  ];
  prompt.push(...agentPrompts(otherPlayer, agent, otherAgent));
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
  return content;
}

async function loadPromptData(
  ctx: ActionCtx,
  conversation: Doc<'conversations'>,
  player: Doc<'players'>,
  otherPlayer: Doc<'players'>,
) {
  const agent = await ctx.runQuery(selfInternal.loadAgent, { playerId: player._id });
  const otherAgent = await ctx.runQuery(selfInternal.loadAgent, {
    playerId: otherPlayer._id,
  });
  const previousConversation = await ctx.runQuery(selfInternal.previousConversation, {
    conversationId: conversation._id,
    playerId: player._id,
    otherPlayerId: otherPlayer._id,
  });
  const previousSummaries = await memory.queryOpinionAboutPlayer(ctx, player, otherPlayer);
  return { agent, otherAgent, previousConversation, previousSummaries };
}

function agentPrompts(
  otherPlayer: Doc<'players'>,
  agent: Doc<'classicAgents'> | null,
  otherAgent: Doc<'classicAgents'> | null,
): string[] {
  const prompt = [];
  if (agent) {
    prompt.push(`About you: ${agent.identity}`);
    prompt.push(`Your goals for the conversation: ${agent.plan}`);
  }
  if (otherAgent) {
    prompt.push(`About ${otherPlayer.name}: ${otherAgent.identity}`);
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

export const loadAgent = internalQuery({
  args: {
    playerId: v.id('players'),
  },
  handler: async (ctx, args) => {
    const agent = await ctx.db
      .query('classicAgents')
      .withIndex('playerId', (q) => q.eq('playerId', args.playerId))
      .first();
    return agent;
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
