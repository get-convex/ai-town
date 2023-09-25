import { v } from 'convex/values';
import { mutation } from '../_generated/server';
import { AiTown } from './aiTown';
import { api } from '../_generated/api';
import { Id } from '../_generated/dataModel';
import { insertInput } from '../engine/game';

export const runStep = mutation({
  args: {
    engineId: v.id('engines'),
    generationNumber: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    const game = await AiTown.load(ctx.db, args.engineId);
    const { idleUntil, generationNumber } = await game.runStep(ctx, args.generationNumber);
    await ctx.scheduler.runAt(idleUntil, api.game.main.runStep, {
      engineId: args.engineId,
      generationNumber,
    });
  },
});

export const sendInput = mutation({
  args: {
    engineId: v.id('engines'),
    name: v.string(),
    args: v.any(),
  },
  handler: async (ctx, args) => {
    return await insertInput(ctx, args.engineId, args.name, args.args);
  },
});
