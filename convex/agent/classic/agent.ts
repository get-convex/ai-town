import { v } from 'convex/values';
import { ActionCtx, DatabaseReader, internalQuery } from '../../_generated/server';
import { Doc, Id } from '../../_generated/dataModel';
import { internal } from '../../_generated/api';
import { world } from '../../data/world';
import { Point } from '../../util/types';
import { blocked } from '../../game/movement';
import { distance } from '../../util/geometry';
import { sendInput } from '../lib/actions';
import { FunctionReturnType } from 'convex/server';
import { continueConversation, leaveConversation, startConversation } from './conversation';
import { rememberConversation } from './memory';
import { sleep } from '../../util/sleep';
import { TickOutcome, agentContinue, agentError } from './main';
import { streamChat } from '../lib/streamChat';

const selfInternal = internal.agent.classic.agent;

export async function tickAgent(
  ctx: ActionCtx,
  now: number,
  playerId: Id<'players'>,
): Promise<TickOutcome> {
  const { player, otherPlayers, toRemember } = await ctx.runQuery(selfInternal.queryState, {
    playerId,
  });
  const conversation = player.conversation;

  // If we have a conversation to remember, do that before anything else!
  if (toRemember) {
    console.log(`Remembering conversation ${toRemember}...`);
    await rememberConversation(ctx, playerId, toRemember);
    return agentContinue;
  }

  // We're idle if we're not in a conversation and not moving.
  if (!conversation && !player.pathfinding) {
    // Wander to a random point with 50% probability.
    if (Math.random() < 0.5) {
      const candidate = {
        x: Math.random() * world.width,
        y: Math.random() * world.height,
      };
      const destination = findUnoccupied(candidate, [player, ...otherPlayers]);
      if (!destination) {
        console.warn("Couldn't find a free destination to wander to");
        return agentError;
      }
      console.log(`Wandering to ${JSON.stringify(destination)}...`);
      await sendInput(ctx, 'moveTo', {
        playerId,
        destination,
      });
      return agentContinue;
    }
    // Otherwise, try to start a conversation with someone.
    else {
      const candidate = conversationCandidate(player, otherPlayers);
      if (!candidate) {
        console.warn(`No one to talk to... :(`);
        return agentError;
      }
      console.log(`Starting conversation with ${candidate.name}`);
      await sendInput(ctx, 'startConversation', {
        playerId: player._id,
        invitee: candidate._id,
      });
      return agentContinue;
    }
  }
  // If we're currrently moving and not in a conversation, stop moving with 10% probability.
  if (!conversation && player.pathfinding) {
    console.log(`Currently moving!`);
    if (Math.random() < 0.1) {
      console.log(`Stopping movement...`);
      await sendInput(ctx, 'moveTo', {
        playerId,
        destination: null,
      });
    }
    return agentContinue;
  }
  // If we're in a conversation and currently invited, say yes with probability 75%!
  if (conversation && conversation.membership.status === 'invited') {
    if (Math.random() < 0.75) {
      console.log(`Accepting invitation for ${conversation._id}`);
      await sendInput(ctx, 'acceptInvite', {
        playerId: player._id,
        conversationId: conversation._id,
      });
    } else {
      console.log(`Declining invitation for ${conversation._id}`);
      await sendInput(ctx, 'rejectInvite', {
        playerId: player._id,
        conversationId: conversation._id,
      });
    }
    return agentContinue;
  }
  // If we're walking over, try to walk towards our conversation partner.
  if (conversation && conversation.membership.status === 'walkingOver') {
    const otherPlayer = otherPlayers.find(
      (p) => p.conversation && p.conversation._id == conversation._id,
    );
    if (!otherPlayer) {
      throw new Error(`Couldn't find other participant in ${conversation._id}`);
    }
    const candidate = {
      x: (player.position.x + otherPlayer.position.x) / 2,
      y: (player.position.y + otherPlayer.position.y) / 2,
    };
    const destination = findUnoccupied(candidate, [player, ...otherPlayers]);
    if (!destination) {
      console.warn(`Couldn't find a free destination near ${JSON.stringify(otherPlayer)}`);
      return agentError;
    }
    console.log(`Moving to ${JSON.stringify(destination)} to start conversation...`);
    await sendInput(ctx, 'moveTo', {
      playerId,
      destination,
    });
    return agentContinue;
  }
  // If we're participating in the conversation, start driving it forward.
  if (conversation && conversation.membership.status === 'participating') {
    const otherPlayer = otherPlayers.find(
      (p) => p.conversation && p.conversation._id == conversation._id,
    );
    if (!otherPlayer) {
      throw new Error(`Couldn't find other participant in ${conversation._id}`);
    }
    return await tickConversation(ctx, now, player, otherPlayer, conversation);
  }
  return agentContinue;
}

async function tickConversation(
  ctx: ActionCtx,
  now: number,
  player: Doc<'players'>,
  otherPlayer: Doc<'players'>,
  conversation: Doc<'conversations'>,
): Promise<TickOutcome> {
  // If someone else is typing, wait for them to finish.
  if (conversation.typing && conversation.typing.playerId !== player._id) {
    const toWait = Math.max(1000, Math.random() * 5000);
    console.warn(`Other player is typing, waiting for ${toWait}ms...`);
    return { kind: 'sleep', duration: toWait };
  }
  const lastMessage = await ctx.runQuery(selfInternal.latestMessage, {
    conversationId: conversation._id,
  });
  const conversationEmpty = lastMessage === null;

  // Decide if we're going to send the first message.
  if (conversationEmpty) {
    // If we didn't start the conversation, wait for 20s after conversation start for the other player to write something.
    if (conversation.creator !== player._id) {
      if (now < conversation._creationTime + 20000) {
        console.log(`Waiting for other player to start conversation...`);
        return agentError;
      }
    }
    console.log(`Starting conversation...`);
    if (conversation.typing?.playerId !== player._id) {
      const acquiredLock = await startTyping(ctx, player._id, conversation._id);
      if (!acquiredLock) {
        return agentError;
      }
    }
    const content = await startConversation(ctx, conversation, player, otherPlayer);
    await streamChat(ctx, player._id, conversation._id, content);
    return agentContinue;
  }

  // Consider a conversation too long if it's been going on for over a minute.
  if (conversation._creationTime + 60000 <= now) {
    // Leave with probability 50%.
    if (Math.random() < 0.5) {
      console.log(`Leaving conversation...`);
      if (conversation.typing?.playerId !== player._id) {
        const acquiredLock = await startTyping(ctx, player._id, conversation._id);
        if (!acquiredLock) {
          return agentError;
        }
      }
      const content = await leaveConversation(ctx, conversation, player, otherPlayer);
      await streamChat(ctx, player._id, conversation._id, content);
      await sendInput(ctx, 'leaveConversation', {
        playerId: player._id,
        conversationId: conversation._id,
      });
      return agentContinue;
    }
  }

  // Otherwise, wait for some random time, try to grab the lock, and send a message.
  if (conversation.typing?.playerId !== player._id) {
    // If we wrote a message last, wait for 20s for the other player to respond
    // Note that we don't do this wait if we have the lock already.
    if (lastMessage.author === player._id) {
      const otherPlayerDeadline = lastMessage._creationTime + 20000;
      if (now < otherPlayerDeadline) {
        console.log(`Waiting for other player to respond...`);
        return { kind: 'sleep', duration: Math.random() * 20000 };
      }
    }
    const toSleep = Math.random() * 1000;
    console.log(`Waiting for ${toSleep}ms before starting to type...`);
    await sleep(toSleep);
    const acquiredLock = await startTyping(ctx, player._id, conversation._id);
    if (!acquiredLock) {
      return agentError;
    }
  }
  const content = await continueConversation(ctx, conversation, player, otherPlayer);
  await streamChat(ctx, player._id, conversation._id, content);

  return agentContinue;
}

export const queryState = internalQuery({
  args: {
    playerId: v.id('players'),
  },
  handler: async (ctx, args) => {
    const player = await ctx.db.get(args.playerId);
    if (!player) {
      throw new Error(`Player ${args.playerId} not found!`);
    }
    const conversation = await activeConversation(ctx.db, args.playerId);

    const otherPlayers = [];
    for (const otherPlayer of await ctx.db.query('players').collect()) {
      if (!otherPlayer.enabled) {
        continue;
      }
      if (otherPlayer._id === player._id) {
        continue;
      }
      const conversation = await activeConversation(ctx.db, args.playerId);
      otherPlayers.push({ ...otherPlayer, conversation });
    }

    let toRemember: Id<'conversations'> | null = null;
    const leftConversations = await ctx.db
      .query('conversationMembers')
      .withIndex('playerId', (q) => q.eq('playerId', args.playerId))
      .filter((q) => q.eq(q.field('status'), 'left'))
      .collect();
    for (const leftConversation of leftConversations) {
      // We don't need to form memories for empty conversations.
      const firstMessage = await ctx.db
        .query('messages')
        .withIndex('conversationId', (q) => q.eq('conversationId', leftConversation.conversationId))
        .first();
      if (!firstMessage) {
        continue;
      }
      const memory = await ctx.db
        .query('conversationMemories')
        .withIndex('owner', (q) =>
          q.eq('owner', args.playerId).eq('conversation', leftConversation.conversationId),
        )
        .first();
      if (!memory) {
        toRemember = leftConversation.conversationId;
        break;
      }
    }
    return {
      player: { conversation, ...player },
      otherPlayers,
      toRemember,
    };
  },
});

type OtherPlayers = FunctionReturnType<typeof selfInternal.queryState>['otherPlayers'];

export const latestMessage = internalQuery({
  args: {
    conversationId: v.id('conversations'),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query('messages')
      .withIndex('conversationId', (q) => q.eq('conversationId', args.conversationId))
      .order('desc')
      .first();
  },
});

async function activeConversation(db: DatabaseReader, playerId: Id<'players'>) {
  const membership = await db
    .query('conversationMembers')
    .withIndex('playerId', (q) => q.eq('playerId', playerId))
    .filter((q) => q.neq(q.field('status'), 'left'))
    .first();
  if (!membership) {
    return null;
  }
  const conversation = await db.get(membership.conversationId);
  if (!conversation) {
    throw new Error(`Conversation ${membership.conversationId} not found!`);
  }
  return { membership, ...conversation };
}

function findUnoccupied(destination: Point, allPlayers: Array<Doc<'players'>>) {
  const candidates = [];
  for (let x = 0; x < world.width; x++) {
    for (let y = 0; y < world.height; y++) {
      const candidate = { x, y };
      if (blocked(allPlayers, candidate)) {
        continue;
      }
      candidates.push(candidate);
    }
  }
  candidates.sort((a, b) => distance(destination, a) - distance(destination, b));
  return candidates.length > 0 ? candidates[0] : null;
}

function conversationCandidate(player: Doc<'players'>, otherPlayers: OtherPlayers) {
  // Find the nearest player (that isn't ourselves) that isn't in a conversation.
  const candidates = [];
  for (const otherPlayer of otherPlayers) {
    if (otherPlayer.conversation !== null) {
      continue;
    }
    candidates.push(otherPlayer);
  }
  candidates.sort(
    (a, b) => distance(player.position, a.position) - distance(player.position, b.position),
  );
  return candidates.length > 0 ? candidates[0] : null;
}

async function startTyping(
  ctx: ActionCtx,
  playerId: Id<'players'>,
  conversationId: Id<'conversations'>,
) {
  try {
    await sendInput(ctx, 'startTyping', {
      playerId,
      conversationId,
    });
    return true;
  } catch (error: any) {
    console.error(`Failed to start typing: ${error.message}`);
    return false;
  }
}
