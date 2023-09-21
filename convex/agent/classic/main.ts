import { v } from 'convex/values';
import {
  ActionCtx,
  DatabaseReader,
  action,
  internalMutation,
  internalQuery,
} from '../../_generated/server';
import { Doc, Id } from '../../_generated/dataModel';
import { api, internal } from '../../_generated/api';
import { world } from '../../data/world';
import { Point } from '../../util/types';
import { blocked } from '../../game/movement';
import { distance } from '../../util/geometry';
import { sendInput } from '../lib/actions';
import { FunctionReturnType } from 'convex/server';
import { continueConversation, leaveConversation, startConversation } from './conversation';
import { rememberConversation } from './memory';
import { ChatCompletionContent } from '../lib/openai';
import { sleep } from '../../util/sleep';

export const agent = action({
  args: {
    playerId: v.id('players'),
  },
  handler: async (ctx, args) => {
    const { player, otherPlayers } = await ctx.runQuery(internal.agent.classic.main.queryState, {
      playerId: args.playerId,
    });
    const conversation = player.conversation;

    // If we're not in a conversation...
    if (!conversation) {
      console.log(`Not in a conversation.`);
      // and currently idle...
      if (!player.pathfinding) {
        console.log(`Not moving.`);
        // ...wander to a random point with 50% probability.
        if (Math.random() < 0.5) {
          const candidate = {
            x: Math.random() * world.width,
            y: Math.random() * world.height,
          };
          const destination = findUnoccupied(candidate, [player, ...otherPlayers]);
          if (!destination) {
            console.warn("Couldn't find a free destination to wander to");
            return;
          }
          console.log(`Wandering to ${JSON.stringify(destination)}...`);
          await sendInput(ctx, 'moveTo', {
            playerId: args.playerId,
            destination,
          });
        }
        // Otherwise, try to start a conversation with someone.
        else {
          const candidate = conversationCandidate(player, otherPlayers);
          if (!candidate) {
            console.warn(`No one to talk to... :(`);
            return;
          }
          console.log(`Starting conversation with ${candidate.name}`);
          await sendInput(ctx, 'startConversation', {
            playerId: player._id,
            invitee: candidate._id,
          });
        }
      }
      // If we're currently moving, decide to stop moving with 10% probability.
      else {
        console.log(`Currently moving!`);
        if (Math.random() < 0.1) {
          console.log(`Stopping movement...`);
          await sendInput(ctx, 'moveTo', {
            playerId: args.playerId,
            destination: null,
          });
        }
      }
    }
    // If we're in a conversation...
    else {
      console.log(`In a conversation:`, conversation);
      // and currently invited, say yes with probability 75%!
      if (conversation.membership.status === 'invited') {
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
        return;
      }
      // If we're walking over, try to walk towards our conversation partner.
      if (conversation.membership.status === 'walkingOver') {
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
        console.log(
          `Our position: ${JSON.stringify(player.position)} -> other position: ${JSON.stringify(
            otherPlayer.position,
          )} -> candidate position: ${JSON.stringify(candidate)}`,
        );
        const destination = findUnoccupied(candidate, [player, ...otherPlayers]);
        if (!destination) {
          console.warn(`Couldn't find a free destination near ${JSON.stringify(otherPlayer)}`);
          return;
        }
        console.log(`Moving to ${JSON.stringify(destination)} to start conversation...`);
        await sendInput(ctx, 'moveTo', {
          playerId: args.playerId,
          destination,
        });
        return;
      }
      // If we're participating in the conversation, start driving it forward.
      if (conversation.membership.status === 'participating') {
        const otherPlayer = otherPlayers.find(
          (p) => p.conversation && p.conversation._id == conversation._id,
        );
        if (!otherPlayer) {
          throw new Error(`Couldn't find other participant in ${conversation._id}`);
        }
        await participateInConversation(ctx, conversation._id, args.playerId);
      }
    }
  },
});

async function participateInConversation(
  ctx: ActionCtx,
  conversationId: Id<'conversations'>,
  playerId: Id<'players'>,
) {
  const start = Date.now();
  while (true) {
    if (start + 30000 < Date.now()) {
      console.log(`Returning after 30s...`);
      return;
    }
    const { player, otherPlayers } = await ctx.runQuery(internal.agent.classic.main.queryState, {
      playerId,
    });
    if (!player.conversation || player.conversation._id !== conversationId) {
      console.warn(`Conversation ${conversationId} ended!`);
      break;
    }
    const conversation = player.conversation;
    const otherPlayer = otherPlayers.find(
      (p) => p.conversation && p.conversation._id == conversation._id,
    );
    if (!otherPlayer) {
      console.warn(`Couldn't find other participant in ${conversation._id}`);
      break;
    }

    // If someone else is typing, wait for them to finish.
    if (conversation.typing && conversation.typing.playerId !== player._id) {
      const toWait = Math.max(1000, Math.random() * 5000);
      console.warn(`Other player is typing, waiting for ${toWait}ms...`);
      await sleep(toWait);
      continue;
    }
    const messages = await ctx.runQuery(api.queryGameState.listConversation, {
      conversationId: conversation._id,
    });

    if (messages.length === 0) {
      // Wait for 20s after conversation start for the other player to start the conversation.
      if (conversation.creator !== player._id) {
        if (Date.now() < conversation._creationTime + 20000) {
          console.log(`Waiting for other player to start conversation...`);
          await sleep(1000);
          continue;
        }
      }
      console.log(`Starting conversation...`);
      if (conversation.typing?.playerId !== player._id) {
        const acquiredLock = await startTyping(ctx, player._id, conversation._id);
        if (!acquiredLock) {
          continue;
        }
      }
      const content = await startConversation(ctx, conversation, player, otherPlayer);
      await streamChat(ctx, player._id, conversation._id, content);
      continue;
    }

    // Leave the conversation if it's over eight messages with 50% probability.
    if ((messages.length > 8 || Date.now() - start > 60000) && Math.random() < 0.5) {
      console.log(`Leaving conversation...`);
      if (conversation.typing?.playerId !== player._id) {
        const acquiredLock = await startTyping(ctx, player._id, conversation._id);
        if (!acquiredLock) {
          continue;
        }
      }
      const content = await leaveConversation(ctx, conversation, player, otherPlayer);
      await streamChat(ctx, player._id, conversation._id, content);
      await sendInput(ctx, 'leaveConversation', {
        playerId: player._id,
        conversationId: conversation._id,
      });
      break;
    }
    // Otherwise, wait for some random time, try to grab the lock, and send a message.
    if (conversation.typing?.playerId !== player._id) {
      const lastMessage = messages[messages.length - 1];
      // If we wrote a message last, wait for 20s for the other player to respond.
      if (lastMessage.author === playerId) {
        if (lastMessage._creationTime + 20000 > Date.now()) {
          console.log(`Waiting for other player to respond...`);
          await sleep(1000);
          continue;
        }
      }
      const toSleep = Math.random() * 1000;
      console.log(`Waiting for ${toSleep}ms before starting to type...`);
      await sleep(toSleep);
      const acquiredLock = await startTyping(ctx, player._id, conversation._id);
      if (!acquiredLock) {
        continue;
      }
    }
    const content = await continueConversation(ctx, conversation, player, otherPlayer);
    await streamChat(ctx, player._id, conversation._id, content);
  }
  const summary = await rememberConversation(ctx, playerId, conversationId);
  if (summary) {
    console.log(`Completed conversation. Summary: ${summary}`);
  }
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
      if (otherPlayer._id === player._id) {
        continue;
      }
      const conversation = await activeConversation(ctx.db, args.playerId);
      otherPlayers.push({ ...otherPlayer, conversation });
    }
    return {
      player: { conversation, ...player },
      otherPlayers,
    };
  },
});
type OtherPlayers = FunctionReturnType<
  typeof internal.agent.classic.main.queryState
>['otherPlayers'];

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
    const toWait = Math.max(Math.random() * 1000, 500);
    console.error(`Failed to start typing, sleeping for ${toWait}ms: ${error.message}`);
    await sleep(toWait);
    return false;
  }
}

async function streamChat(
  ctx: ActionCtx,
  playerId: Id<'players'>,
  conversationId: Id<'conversations'>,
  content: ChatCompletionContent,
  chunkSize: number = 4,
  chunksPerSec: number = 12,
) {
  async function* streamChunks() {
    let fragments = [];
    let fragmentsLen = 0;
    let lastEmitted = null;
    for await (const fragment of content.read()) {
      fragments.push(fragment);
      fragmentsLen += fragment.length;
      if (fragmentsLen >= chunkSize) {
        const now = Date.now();
        if (lastEmitted) {
          const deadline = lastEmitted + 1000 / chunksPerSec;
          if (now < deadline) {
            const toSleep = deadline - now;
            await sleep(toSleep);
          }
        }
        yield fragments.join('');
        fragments = [];
        fragmentsLen = 0;
        lastEmitted = now;
      }
    }
    if (fragmentsLen > 0) {
      yield fragments.join('');
    }
  }
  let messageId: Id<'messages'> | undefined;
  try {
    for await (const chunk of streamChunks()) {
      if (!messageId) {
        messageId = await sendInput(ctx, 'writeMessage', {
          conversationId,
          playerId,
          message: chunk,
          doneWriting: false,
        });
        continue;
      }
      await ctx.runMutation(internal.agent.classic.main.writeFragment, {
        messageId,
        text: chunk,
      });
    }
  } finally {
    if (messageId) {
      await sendInput(ctx, 'finishWriting', {
        playerId,
        messageId,
      });
    }
  }
}

export const writeFragment = internalMutation({
  args: {
    messageId: v.id('messages'),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('messageText', args);
  },
});
