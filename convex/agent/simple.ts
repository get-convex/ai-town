import { v } from 'convex/values';
import { DatabaseReader, action, mutation, query } from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';
import { Point } from '../schema/types';
import { distance } from '../util/geometry';
import { addPlayerInput } from '../engine';
import { blocked } from '../game/movement';
import { map, world } from '../schema';
import { api } from '../_generated/api';
import { FunctionReturnType } from 'convex/server';

// (Ideas for) design principles:
// 1. Agents have unlimited readonly access to game engine state. Run whatever queries you want.
// 2. Agents *cannot* mutate game engine state. They can only send inputs.

export const debugRunAll = action({
  handler: async (ctx) => {
    const allPlayers = await ctx.runQuery(api.agent.simple.debugAllPlayers);
    for (const player of allPlayers) {
      await simpleAgent(ctx, { playerId: player._id });
    }
  },
});
export const debugAllPlayers = query({
  handler: async (ctx) => {
    const humans = await ctx.db.query('humans').collect();
    const players = await ctx.db.query('players').collect();
    return players.filter((p) => !humans.find((h) => h.playerId === p._id));
  },
});

export const simpleAgent = action({
  args: {
    playerId: v.id('players'),
  },
  handler: async (ctx, args) => {
    const { player, otherPlayers } = await ctx.runQuery(api.agent.simple.queryState, args);
    const conversation = player.conversation;

    const isWalking = player.pathfinding !== undefined;

    // If we're not in a conversation, try to start one.
    if (!conversation) {
      const candidate = await conversationCandidate(player, otherPlayers);
      if (candidate) {
        console.log(`Starting conversation with ${candidate.name}`);
        await ctx.runMutation(api.engine.addPlayerInput, {
          playerId: player._id,
          input: {
            kind: 'startConversation',
            invite: candidate._id,
          },
        });
      }
    }
    // If we are in a conversation...
    if (conversation) {
      // ...and currently invited, say yes with probability 75%!
      if (conversation.membership.status === 'invited') {
        if (Math.random() < 0.75) {
          console.log(`Accepting invitation for ${conversation._id}`);
          await ctx.runMutation(api.engine.addPlayerInput, {
            playerId: player._id,
            input: {
              kind: 'acceptInvite',
              conversationId: conversation._id,
            },
          });
        } else {
          console.log(`Declining invitation for ${conversation._id}`);
          await ctx.runMutation(api.engine.addPlayerInput, {
            playerId: player._id,
            input: {
              kind: 'rejectInvite',
              conversationId: conversation._id,
            },
          });
        }
      }
      // If we're walking over, try to walk towards our conversation partner.
      if (conversation.membership.status === 'walkingOver' && !isWalking) {
        // Find a free spot somewhere near our midpoint.
        const destination = await conversationDestination(conversation._id, player, otherPlayers);
        if (destination) {
          console.log(`Walking to conversation buddy at ${JSON.stringify(destination)}`);
          await ctx.runMutation(api.engine.addPlayerInput, {
            playerId: player._id,
            input: {
              kind: 'moveTo',
              destination,
            },
          });
        }
      }
      // Otherwise, we're in a conversation.
      if (conversation.membership.status === 'participating') {
        // Try to "grab the lock" if no one is typing
        if (!conversation.typing) {
          console.log(`Starting typing for ${conversation._id}`);
          await ctx.runMutation(api.engine.addPlayerInput, {
            playerId: player._id,
            input: {
              kind: 'startTyping',
              conversationId: conversation._id,
            },
          });
        }
        // Say a message if we're the ones typing.
        if (conversation.typing && conversation.typing.playerId === player._id) {
          console.log(`Sending message for ${conversation._id}`);
          await ctx.runMutation(api.engine.addPlayerInput, {
            playerId: player._id,
            input: {
              kind: 'writeMessage',
              conversationId: conversation._id,
              doneWriting: true,
              text: 'hello world!',
            },
          });
        }
        // If it's been at least a minute since the conversation started, leave with 50% probability.
        if (conversation._creationTime + 60_000 < Date.now() && Math.random() < 0.5) {
          console.log(`Leaving conversation ${conversation._id}`);
          await ctx.runMutation(api.engine.addPlayerInput, {
            playerId: player._id,
            input: {
              kind: 'leaveConversation',
              conversationId: conversation._id,
            },
          });
        }
      }
    }
  },
});

export const queryState = query({
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
type OtherPlayers = FunctionReturnType<typeof api.agent.simple.queryState>['otherPlayers'];

async function activeConversation(db: DatabaseReader, playerId: Id<'players'>) {
  const membership = await db
    .query('conversationMembers')
    .withIndex('playerId', (q) => q.eq('playerId', playerId))
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

async function conversationCandidate(player: Doc<'players'>, otherPlayers: OtherPlayers) {
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
  return candidates[0] ?? null;
}

async function conversationDestination(
  conversationId: Id<'conversations'>,
  player: Doc<'players'>,
  otherPlayers: OtherPlayers,
) {
  const otherPlayer = otherPlayers.find(
    (p) => p.conversation && p.conversation._id == conversationId,
  );
  if (!otherPlayer) {
    return null;
  }
  const midpoint = {
    x: Math.floor((player.position.x + otherPlayer.position.x) / 2),
    y: Math.floor((player.position.y + otherPlayer.position.y) / 2),
  };
  const candidates = [];
  const allPlayers = [player, ...otherPlayers];
  for (let x = 0; x < world.width; x++) {
    for (let y = 0; y < world.height; y++) {
      const candidate = { x, y };
      if (blocked(allPlayers, candidate, player)) {
        continue;
      }
      candidates.push(candidate);
    }
  }
  candidates.sort((a, b) => distance(midpoint, a) - distance(midpoint, b));
  return candidates[0] ?? null;
}
