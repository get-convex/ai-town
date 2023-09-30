import { TableNames } from './_generated/dataModel';
import { internal } from './_generated/api';
import { DatabaseWriter, internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { insertInput } from './game/main';
import { mapHeight, mapWidth } from './data/map';

export const wipeAllTables = internalMutation({
  handler: async (ctx) => {
    // Clear all of the tables except for the embeddings cache.
    const tables: Array<TableNames> = [
      'conversationMembers',
      'conversations',
      'inputs',
      'players',
      'engines',
      'locations',
      'worlds',
      'agents',
      'conversationMemories',
      'messages',
      'typingIndicator',
    ];
    const maxRows = 128;
    let deleted = 0;
    try {
      for (const table of tables) {
        deleted += await deleteBatch(ctx.db, table, maxRows - deleted);
      }
    } catch (e: unknown) {
      if (e instanceof HasMoreError) {
        ctx.scheduler.runAfter(0, internal.testing.wipeAllTables, {});
        return 'continuing...';
      }
      throw e;
    }
    return 'ok!';
  },
});
class HasMoreError extends Error {}

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

export const debugCreatePlayers = internalMutation({
  args: {
    numPlayers: v.number(),
  },
  handler: async (ctx, args) => {
    const world = await ctx.db
      .query('worlds')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!world) {
      throw new Error('No default world');
    }
    for (let i = 0; i < args.numPlayers; i++) {
      const inputId = await insertInput(ctx, world?.engineId, 'join', {
        name: `Robot${i}`,
        description: `This player is a robot.`,
        character: `f${1 + (i % 8)}`,
      });
    }
  },
});

export const randomPositions = internalMutation({
  handler: async (ctx) => {
    const world = await ctx.db
      .query('worlds')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!world) {
      throw new Error('No default world');
    }
    const players = await ctx.db
      .query('players')
      .withIndex('active', (q) => q.eq('engineId', world.engineId).eq('active', true))
      .collect();
    for (const player of players) {
      await insertInput(ctx, world.engineId, 'moveTo', {
        playerId: player._id,
        destination: {
          x: 1 + Math.floor(Math.random() * (mapWidth - 2)),
          y: 1 + Math.floor(Math.random() * (mapHeight - 2)),
        },
      });
    }
  },
});
