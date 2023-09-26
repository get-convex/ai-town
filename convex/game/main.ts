import { v } from 'convex/values';
import { mutation, query } from '../_generated/server';
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
    const preempt = true;
    const { inputId, preemption } = await insertInput(
      ctx,
      args.engineId,
      args.name,
      args.args,
      preempt,
    );
    if (preemption) {
      const { now, generationNumber } = preemption;
      await ctx.scheduler.runAt(now, api.game.main.runStep, {
        engineId: args.engineId,
        generationNumber,
      });
    }
    return inputId;
  },
});

export const inputStatus = query({
  args: {
    inputId: v.id('inputs'),
  },
  handler: async (ctx, args) => {
    const input = await ctx.db.get(args.inputId);
    if (!input) {
      throw new Error(`Invalid input ID: ${args.inputId}`);
    }
    return input.returnValue ?? null;
  },
});
