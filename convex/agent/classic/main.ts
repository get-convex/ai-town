import { v } from 'convex/values';
import { action, mutation } from '../../_generated/server';
import { api, internal } from '../../_generated/api';
import { sleep } from '../../util/sleep';
import { SOFT_LEASE_EXPIRATION } from './lease';
import { assertNever } from '../../util/assertNever';
import { tickAgent } from './agent';

export type TickOutcome =
  | { kind: 'continue' }
  | { kind: 'error' }
  | { kind: 'sleep'; duration: number };
export const agentContinue: TickOutcome = { kind: 'continue' };
export const agentError: TickOutcome = { kind: 'error' };

export const agentLoop = action({
  args: {
    playerId: v.id('players'),
    expectedGeneration: v.number(),
    reschedule: v.boolean(),
  },
  handler: async (ctx, args) => {
    const generation = await ctx.runMutation(internal.agent.classic.lease.acquireLease, {
      playerId: args.playerId,
      expectedGeneration: args.expectedGeneration,
      scheduleRecovery: args.reschedule,
    });
    if (generation === null) {
      console.warn('Failed to acquire lease, returning...');
      return;
    }
    const deadline = Date.now() + SOFT_LEASE_EXPIRATION;
    let numErrors = 0;
    let sleepRemaining = 0;
    for (let now = Date.now(); now < deadline; now = Date.now()) {
      let outcome;
      try {
        outcome = await tickAgent(ctx, now, args.playerId);
      } catch (error: any) {
        console.error(`Error: ${error.message}`);
        outcome = agentError;
      }
      numErrors = outcome.kind === 'error' ? numErrors + 1 : 0;
      let toSleep;
      switch (outcome.kind) {
        case 'continue':
          toSleep = 750 + Math.random() * 500;
          break;
        case 'error':
          toSleep = Math.random() * (1 << numErrors) * 250;
          break;
        case 'sleep':
          toSleep = outcome.duration;
          break;
        default:
          assertNever(outcome);
      }
      const remaining = deadline - now;
      if (toSleep > remaining) {
        toSleep = remaining;
        sleepRemaining = toSleep - remaining;
      }
      console.log(`Sleeping for ${toSleep}ms...`);
      await sleep(toSleep);
      const leaseHeld = await ctx.runQuery(internal.agent.classic.lease.leaseHeld, {
        playerId: args.playerId,
        expectedGeneration: generation,
      });
      if (!leaseHeld) {
        console.warn('Lost lease, returning immediately!');
        return;
      }
    }
    // Happy path: schedule ourselves to run again immediately.
    if (args.reschedule) {
      await ctx.scheduler.runAfter(
        Math.min(sleepRemaining, SOFT_LEASE_EXPIRATION),
        api.agent.classic.main.agentLoop,
        {
          playerId: args.playerId,
          expectedGeneration: generation,
          reschedule: true,
        },
      );
    }
  },
});
