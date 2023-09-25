import { v } from 'convex/values';
import { mutation } from '../_generated/server';
import { AiTown } from './aiTown';
import { api } from '../_generated/api';

export const runStep = mutation({
  args: {
    worldId: v.id('worlds'),
    generationNumber: v.number(),
  },
  handler: async (ctx, args) => {
    const game = await AiTown.load(ctx.db, args.worldId);
    const { toSleep, generationNumber } = await game.runStep(ctx, args.generationNumber);
    await ctx.scheduler.runAfter(toSleep, api.game.main.runStep, {
      worldId: args.worldId,
      generationNumber,
    });
  },
});
