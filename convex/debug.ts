import { v } from 'convex/values';
import { DatabaseReader, DatabaseWriter, mutation } from './_generated/server';
import { world } from './data/world';
import { insertInput } from './engine';
import { Id, TableNames } from './_generated/dataModel';
import { GameState } from './game/state';
import { blocked } from './game/movement';

export const addManyPlayers = mutation({
  handler: async (ctx) => {
    const orig = await ctx.db.query('players').collect();
    for (let j = 0; j < 10; j++) {
      await insertInput(ctx.db, Date.now(), {
        kind: 'join',
        args: {
          name: `robot${orig.length + j}`,
          description: "Hi! I'm a robot 🤖",
        },
      });
    }
  },
});

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

export const randomBlockActions = mutation({
  args: {},
  handler: async (ctx, args) => {
    const gameState = await GameState.load(Date.now(), ctx.db);
    const players = gameState.enabledPlayers();
    for (const player of players) {
      const carriedBlock = gameState.blocks.filter(
        (b) => b.metadata.state === 'carried' && b.metadata.player === player._id,
      )[0];

      // If we're carrying a block, find somewhere to set it down
      if (carriedBlock) {
        if (Math.random() < 0.25) {
          const destination = await getRandomEmptyPosition(ctx.db, player._id);
          await insertInput(ctx.db, Date.now(), {
            kind: 'moveTo',
            args: {
              playerId: player._id,
              destination,
            },
          });
          break;
        }
        await insertInput(ctx.db, Date.now(), {
          kind: 'setDownBlock',
          args: {
            playerId: player._id,
            blockId: carriedBlock._id,
          },
        });

        const destination = await getRandomEmptyPosition(ctx.db, player._id);
        await insertInput(ctx.db, Date.now(), {
          kind: 'moveTo',
          args: {
            playerId: player._id,
            destination,
          },
        });
        break;
      }

      const freeBlocks = gameState.freeBlocks();
      if (freeBlocks.length === 0) {
        const destination = await getRandomEmptyPosition(ctx.db, player._id);
        await insertInput(ctx.db, Date.now(), {
          kind: 'moveTo',
          args: {
            playerId: player._id,
            destination,
          },
        });
        break;
      }
      const block = freeBlocks[Math.floor(Math.random() * freeBlocks.length)];
      await insertInput(ctx.db, Date.now(), {
        kind: 'moveTo',
        args: {
          playerId: player._id,
          // @ts-expect-error ugh
          destination: block.metadata.position,
        },
      });

      await insertInput(ctx.db, Date.now(), {
        kind: 'pickUpBlock',
        args: {
          playerId: player._id,
          blockId: block._id,
        },
      });
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
      'embeddings',
      'inputs',
      'messages',
      'messageText',
      'players',
      'steps',
      'blocks',
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
