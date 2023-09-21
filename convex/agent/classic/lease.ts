import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../../_generated/server';
import { defineTable } from 'convex/server';
import { api } from '../../_generated/api';

export const SOFT_LEASE_EXPIRATION = 10 * 1000;
export const HARD_LEASE_EXPIRATION = 90 * 1000;

// Atomically acquire the lease and schedule a loop iteration
// to pick up if we crash.
export const acquireLease = internalMutation({
  args: {
    playerId: v.id('players'),
    expectedGeneration: v.number(),
    scheduleRecovery: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const nextGeneration = args.expectedGeneration + 1;
    const nextExpiration = now + HARD_LEASE_EXPIRATION;
    const existing = await ctx.db
      .query('agentLeases')
      .withIndex('playerId', (q) => q.eq('playerId', args.playerId))
      .unique();
    if (!existing) {
      await ctx.db.insert('agentLeases', {
        playerId: args.playerId,
        generation: nextGeneration,
      });
    } else {
      if (existing.generation !== args.expectedGeneration) {
        return null;
      }
      existing.generation = nextGeneration;
      await ctx.db.replace(existing._id, existing);
    }
    // Run a job after the lease expires to pick up if we crash (and don't bump the generation number after the soft deadline expires).
    if (args.scheduleRecovery) {
      await ctx.scheduler.runAfter(HARD_LEASE_EXPIRATION, api.agent.classic.main.agentLoop, {
        playerId: args.playerId,
        expectedGeneration: nextGeneration,
        reschedule: true,
      });
    }
    return nextGeneration;
  },
});

export const leaseHeld = internalQuery({
  args: {
    playerId: v.id('players'),
    expectedGeneration: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('agentLeases')
      .withIndex('playerId', (q) => q.eq('playerId', args.playerId))
      .unique();
    return existing && existing.generation === args.expectedGeneration;
  },
});

const agentLeases = v.object({
  playerId: v.id('players'),
  generation: v.number(),
});
export const leaseTables = {
  agentLeases: defineTable(agentLeases).index('playerId', ['playerId']),
};
