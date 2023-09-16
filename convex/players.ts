import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { characters, world } from './schema';
import { objmap } from './data/map';
import { distance } from './util/geometry';

export const addPlayer = mutation({
  args: {
    name: v.string(),
    description: v.string(),
  },
  handler: async (ctx, args) => {
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
    return ctx.db.insert('players', {
      name: args.name,
      description: args.description,
      character: Math.floor(Math.random() * characters.length),
      position,
      facing: { dx: 1, dy: 0 },
    });
  },
});
