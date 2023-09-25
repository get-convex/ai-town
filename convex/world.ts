import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { characters } from './data/characters';
import { insertInput } from './engine/game';
import { defineTable } from 'convex/server';

export const worlds = defineTable({
  isDefault: v.boolean(),
  engineId: v.id('engines'),
  lastViewed: v.optional(v.number()),
});

export const defaultWorld = query({
  handler: async (ctx) => {
    const world = await ctx.db
      .query('worlds')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    return world;
  },
});

export const heartbeatWorld = mutation({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`Invalid world ID: ${args.worldId}`);
    }
    const now = Date.now();
    world.lastViewed = Math.max(world.lastViewed ?? now, now);
    await ctx.db.replace(world._id, world);
  },
});

export const userStatus = query({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`Invalid world ID: ${args.worldId}`);
    }
    const player = await ctx.db
      .query('players')
      .withIndex('active', (q) =>
        q.eq('engineId', world.engineId).eq('active', true).eq('human', identity.tokenIdentifier),
      )
      .first();
    return player?._id ?? null;
  },
});

export const joinWorld = mutation({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error(`Not logged in`);
    }
    if (!identity.givenName) {
      throw new Error(`Missing givenName on ${JSON.stringify(identity)}`);
    }
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`Invalid world ID: ${args.worldId}`);
    }
    const { tokenIdentifier } = identity;
    const existingPlayer = await ctx.db
      .query('players')
      .withIndex('active', (q) =>
        q.eq('engineId', world.engineId).eq('active', true).eq('human', identity.tokenIdentifier),
      )
      .first();
    if (existingPlayer) {
      throw new Error(`Already joined as ${existingPlayer._id}`);
    }
    await insertInput(ctx, world.engineId, 'join', {
      name: identity.givenName,
      character: characters[Math.floor(Math.random() * characters.length)].name,
      description: `${identity.givenName} is a human player`,
      tokenIdentifier,
    });
  },
});

export const leaveWorld = mutation({
  args: {
    engineId: v.id('engines'),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error(`Not logged in`);
    }
    const { tokenIdentifier } = identity;
    const existingPlayer = await ctx.db
      .query('players')
      .withIndex('active', (q) =>
        q.eq('engineId', args.engineId).eq('active', true).eq('human', tokenIdentifier),
      )
      .first();
    if (!existingPlayer) {
      return;
    }
    await insertInput(ctx, args.engineId, 'leave', {
      playerId: existingPlayer._id,
    });
  },
});
