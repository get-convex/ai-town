import { v } from 'convex/values';
import { DatabaseReader, DatabaseWriter, mutation } from './_generated/server';
import { world } from './data/world';
import { insertInput } from './engine';
import { Id, TableNames } from './_generated/dataModel';
import { GameState } from './game/state';
import { blocked } from './game/movement';
import { api } from './_generated/api';

// export const addManyPlayers = mutation({
//   handler: async (ctx) => {
//     const orig = await ctx.db.query('players').collect();
//     for (let j = 0; j < 10; j++) {
//       await insertInput(ctx.db, Date.now(), {
//         kind: 'join',
//         args: {
//           name: `robot${orig.length + j}`,
//           description: "Hi! I'm a robot 🤖",
//         },
//       });
//     }
//   },
// });

export const addManyBlocks = mutation({
  handler: async (ctx) => {
    for (let j = 0; j < 10; j++) {
      await insertInput(ctx.db, Date.now(), {
        kind: 'addBlock',
        args: {},
      });
    }
  },
});

const getRandomEmptyPosition = async (db: DatabaseReader, playerId?: Id<'players'>) => {
  const allPlayers = await db.query('players').collect();
  const allBlocks = await db.query('blocks').collect();
  for (let i = 0; i < 10; i++) {
    const candidate = {
      x: Math.floor(Math.random() * world.width),
      y: Math.floor(Math.random() * world.height),
    };
    const collision = blocked(allPlayers, allBlocks, candidate);
    if (collision !== null) {
      console.warn(`Candidate ${JSON.stringify(candidate)} failed: ${collision}`);
      continue;
    }
    return candidate;
  }
  return null;
};

export const randomPositions = mutation({
  args: {
    max: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const gameState = await GameState.load(Date.now(), ctx.db);
    let inserted = 0;
    const allPlayers = await ctx.db.query('players').collect();
    for (const playerId of gameState.players.allIds()) {
      if (args.max && inserted >= args.max) {
        break;
      }
      const player = gameState.players.lookup(playerId);
      if (player.human) {
        continue;
      }
      const position = await getRandomEmptyPosition(ctx.db, playerId);
      if (!position) {
        console.error(`Failed to find a free position for ${player.name}!`);
        continue;
      }
      await insertInput(ctx.db, Date.now(), {
        kind: 'moveTo',
        args: {
          destination: position,
          playerId,
        },
      });
      inserted += 1;
    }
  },
});

export const acceptAllInvites = mutation({
  handler: async (ctx) => {
    const members = await ctx.db.query('conversationMembers').collect();
    for (const member of members) {
      if (member.status === 'invited') {
        await ctx.db.patch(member._id, { status: 'participating' });
      }
    }
  },
});

export const clear = mutation({
  handler: async (ctx, args) => {
    const tables: Array<TableNames> = [
      'conversationMembers',
      'conversationMemories',
      'conversations',
      'embeddingsCache',
      'inputs',
      'messages',
      'messageText',
      'players',
      'steps',
      'agentLeases',
      'classicAgents',
      'blocks',
      'steps',
    ];
    const maxRows = 512;
    let deleted = 0;
    try {
      for (const table of tables) {
        deleted += await deleteBatch(ctx.db, table, maxRows - deleted);
      }
    } catch (e: unknown) {
      if (e instanceof HasMoreError) {
        ctx.scheduler.runAfter(0, api.debug.clear, {});
        return 'hasMore';
      }
      throw e;
    }
    return 'ok!';
  },
});

async function deleteBatch<TableName extends TableNames>(
  db: DatabaseWriter,
  table: TableName,
  max: number,
): Promise<number> {
  let deleted = 0;
  while (true) {
    if (deleted >= max) {
      throw new HasMoreError();
    }
    const batch = await db.query(table).take(max - deleted);
    for (const row of batch) {
      await db.delete(row._id);
      deleted += 1;
    }
    if (!batch.length) {
      break;
    }
  }
  return deleted;
}

class HasMoreError extends Error {}
