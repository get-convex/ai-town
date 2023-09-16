import { v } from 'convex/values';
import { DatabaseWriter, mutation } from './_generated/server';
import { characters, world } from './schema';
import { objmap } from './data/map';
import { distance } from './util/geometry';
import { insertInput } from './engine';
import { TableNames } from './_generated/dataModel';
import { point } from './schema/types';
import { GameState } from './game/state';
import { blocked } from './game/movement';

export const addManyPlayers = mutation({
  handler: async (ctx) => {
    const orig = await ctx.db.query('players').collect();
    for (let j = 0; j < 10; j++) {
      const otherPlayers = await ctx.db.query('players').collect();
      let position;
      for (let i = 0; i < 100; i++) {
        const candidate = {
          x: Math.floor(Math.random() * world.width),
          y: Math.floor(Math.random() * world.height),
        };
        if (objmap[candidate.y][candidate.x] !== -1) {
          continue;
        }
        for (const player of otherPlayers) {
          if (distance(candidate, player.position) < 1) {
            continue;
          }
        }
        position = candidate;
        break;
      }
      if (!position) {
        throw new Error(`Failed to find a free position!`);
      }
      await ctx.db.insert('players', {
        name: `robot${orig.length + j}`,
        description: "Hi! I'm a robot 🤖",
        character: Math.floor(Math.random() * characters.length),
        position,
        facing: { dx: 1, dy: 0 },
      });
    }
  },
});

export const randomPositions = mutation({
  args: {
    max: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const gameState = await GameState.load(Date.now(), ctx.db);
    let inserted = 0;
    const humans = await ctx.db.query('humans').collect();
    for (const playerId of gameState.players.allIds()) {
      if (args.max && inserted >= args.max) {
        break;
      }
      if (humans.find((p) => p.playerId === playerId)) {
        continue;
      }
      const player = gameState.players.lookup(playerId);
      let position;
      for (let i = 0; i < 10; i++) {
        const candidate = {
          x: Math.floor(Math.random() * world.width),
          y: Math.floor(Math.random() * world.height),
        };
        const collision = blocked(gameState, candidate, player);
        if (collision !== null) {
          console.warn(
            `Candidate ${JSON.stringify(candidate)} failed for ${player.name}: ${collision}`,
          );
          continue;
        }
        position = candidate;
        break;
      }
      if (!position) {
        console.error(`Failed to find a free position for ${player.name}!`);
        continue;
      }
      await insertInput(ctx.db, player._id, {
        kind: 'moveTo',
        destination: position,
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
      'conversations',
      'humans',
      'inputQueue',
      'messages',
      'messageText',
      'players',
      'steps',
    ];
    const maxRows = 1024;
    let deleted = 0;
    try {
      for (const table of tables) {
        deleted += await deleteBatch(ctx.db, table, maxRows - deleted);
      }
    } catch (e: unknown) {
      if (e instanceof HasMoreError) {
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
