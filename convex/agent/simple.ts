import { v } from 'convex/values';
import { DatabaseReader, action, query } from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';
import { distance } from '../util/geometry';
import { blocked } from '../game/movement';
import { world } from '../data/world';
import { api } from '../_generated/api';
import { FunctionReturnType } from 'convex/server';
import { sendInput } from './lib/actions';

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
    // @ts-expect-error
    const humans = await ctx.db.query('humans').collect();
    const players = await ctx.db.query('players').collect();
    // @ts-expect-error
    return players.filter((p) => !humans.find((h) => h.playerId === p._id));
  },
});

export const simpleAgent = action({
  args: {
    playerId: v.id('players'),
  },
  handler: async (ctx, args) => {
    const { player, otherPlayers, blocks } = await ctx.runQuery(api.agent.simple.queryState, args);
    // const conversation = player.conversation;

    const carriedBlock = blocks.filter(
      (b) => b.metadata.state === 'carried' && b.metadata.player === player._id,
    )[0];

    // If we're carrying a block, find somewhere to set it down
    if (carriedBlock) {
      if (Math.random() < 0.5) {
        const destination = {
          x: Math.floor(Math.random() * world.width),
          y: Math.floor(Math.random() * world.height),
        };
        await sendInput(ctx, 'moveTo', {
          playerId: player._id,
          destination,
        });
        return;
      }
      await sendInput(ctx, 'setDownBlock', {
        playerId: player._id,
        blockId: carriedBlock._id,
      });
      const destination = {
        x: Math.floor(Math.random() * world.width),
        y: Math.floor(Math.random() * world.height),
      };
      await sendInput(ctx, 'moveTo', {
        playerId: player._id,
        destination,
      });
      return;
    }

    const freeBlocks = blocks.filter((b) => b.metadata.state !== 'carried');
    if (freeBlocks.length === 0) {
      const destination = {
        x: Math.floor(Math.random() * world.width),
        y: Math.floor(Math.random() * world.height),
      };
      await sendInput(ctx, 'moveTo', {
        playerId: player._id,
        destination,
      });
      return;
    }
    const block = freeBlocks[Math.floor(Math.random() * freeBlocks.length)];
    await sendInput(ctx, 'moveTo', {
      playerId: player._id,
      // @ts-expect-error ugh
      destination: block.metadata.position,
    });
    await sendInput(ctx, 'pickUpBlock', {
      playerId: player._id,
      blockId: block._id,
    });
    return;
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
    const blocks = await ctx.db.query('blocks').collect();
    return {
      player: { conversation, ...player },
      otherPlayers,
      blocks,
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
  blocks: Array<Doc<'blocks'>>,
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
      if (blocked(allPlayers, blocks, candidate, player._id)) {
        continue;
      }
      candidates.push(candidate);
    }
  }
  candidates.sort((a, b) => distance(midpoint, a) - distance(midpoint, b));
  return candidates[0] ?? null;
}
