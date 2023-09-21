import { v } from 'convex/values';
import { api, internal } from '../../_generated/api';
import { action, internalMutation, internalQuery } from '../../_generated/server';
import { Descriptions } from '../../data/characters';
import { sendInput } from '../lib/actions';

const selfInternal = internal.agent.classic.init;

export const initializeAgents = action({
  args: {
    count: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const isInitialized = await ctx.runQuery(selfInternal.isInitialized, {});
    if (isInitialized) {
      throw new Error(`Agents already started!`);
    }
    let initialized = 0;
    for (const data of Descriptions) {
      if (args.count && initialized >= args.count) {
        break;
      }
      // Create the player in the game engine first.
      const playerId = await sendInput(ctx, 'join', {
        name: data.name,
        character: data.character,
        description: data.identity,
      });
      // Initialize the agent stae and start the agent loop.
      await ctx.runMutation(selfInternal.initializeAgent, {
        playerId,
        identity: data.identity,
        plan: data.plan,
      });
      await ctx.scheduler.runAfter(0, api.agent.classic.main.agentLoop, {
        playerId,
        expectedGeneration: 0,
        reschedule: true,
      });
      initialized += 1;
    }
  },
});

export const isInitialized = internalQuery({
  args: {},
  handler: async (ctx) => {
    const players = await ctx.db.query('classicAgents').collect();
    return players.length > 0;
  },
});

export const initializeAgent = internalMutation({
  args: {
    playerId: v.id('players'),
    identity: v.string(),
    plan: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('classicAgents', {
      playerId: args.playerId,
      identity: args.identity,
      plan: args.plan,
    });
  },
});
