import { Infer, v } from 'convex/values';
import { DatabaseWriter, mutation, query } from './_generated/server';
import { MAX_STEP, TICK } from './constants';
import { handleInput } from './game/input';
import { GameState } from './game/state';
import { tick } from './game/tick';
import { args } from './schema/input';
import { api } from './_generated/api';

export const sendInput = mutation({
  args: {
    inputArgs: args,
  },
  handler: async (ctx, { inputArgs }) => {
    const serverTimestamp = Date.now();
    const inputId = await insertInput(ctx.db, serverTimestamp, inputArgs);
    return { inputId, serverTimestamp };
  },
});

export async function insertInput(
  db: DatabaseWriter,
  serverTimestamp: number,
  inputArgs: Infer<typeof args>,
) {
  const inputId = await db.insert('inputs', {
    serverTimestamp,
    args: inputArgs,
  });
  return inputId;
}

export const inputStatus = query({
  args: {
    inputId: v.id('inputs'),
  },
  handler: async (ctx, args) => {
    const input = await ctx.db.get(args.inputId);
    if (!input) {
      return { status: 'notFound' };
    }
    if (input.returnValue === undefined) {
      return { status: 'processing' };
    }
    return { status: 'done', returnValue: input.returnValue };
  },
});

export const step = mutation({
  args: {
    reschedule: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const engine = await ctx.db.query('engine').first();
    if (engine && engine.stopped) {
      console.warn(`Engine stopped, returning immediately.`);
      return;
    }
    const now = Date.now();

    const lastStep = await ctx.db.query('steps').withIndex('endTs').order('desc').first();
    if (lastStep && lastStep.endTs >= now) {
      throw new Error(`Time moving backwards!`);
    }
    const lastServerTs = lastStep ? lastStep.endTs : -1;
    const startTs = lastStep ? lastStep.endTs : now;
    const endTs = Math.min(now, startTs + MAX_STEP);
    console.log(`Simulating ${startTs} -> ${endTs}: (${Math.round(endTs - startTs)}ms)`);

    // Load the game state.
    const gameState = await GameState.load(startTs, ctx.db);

    // Collect player inputs since the last step.
    const stepInputs = await ctx.db
      .query('inputs')
      .withIndex('serverTimestamp', (q) =>
        q.gt('serverTimestamp', lastServerTs).lte('serverTimestamp', endTs),
      )
      .collect();

    let inputIndex = 0;
    let currentTs;
    for (currentTs = startTs; currentTs <= endTs; currentTs += TICK) {
      while (inputIndex < stepInputs.length) {
        const input = stepInputs[inputIndex];
        if (input.serverTimestamp > currentTs) {
          break;
        }
        inputIndex += 1;
        try {
          const result = await handleInput(gameState, currentTs, input.args);
          input.returnValue = { kind: input.args.kind, returnValue: { ok: result as any } };
        } catch (e: any) {
          input.returnValue = { kind: input.args.kind, returnValue: { err: e.message } };
        }
        await ctx.db.replace(input._id, input);
      }
      tick(gameState, currentTs);
    }
    // "Commit" the update by writing back the game state and a new steps checkpoint.
    await gameState.save(currentTs);
    await ctx.db.insert('steps', { startTs, endTs: currentTs });

    if (args.reschedule !== undefined) {
      ctx.scheduler.runAfter(args.reschedule, api.engine.step, { reschedule: args.reschedule });
    }
  },
});
