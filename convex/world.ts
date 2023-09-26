import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { characters } from './data/characters';
import { defineTable } from 'convex/server';
import { sendInput } from './game/main';

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
    await sendInput(ctx, {
      engineId: world.engineId,
      name: 'join',
      args: {
        name: identity.givenName,
        character: characters[Math.floor(Math.random() * characters.length)].name,
        description: `${identity.givenName} is a human player`,
        tokenIdentifier,
      },
    });
  },
});

export const leaveWorld = mutation({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error(`Not logged in`);
    }
    const { tokenIdentifier } = identity;
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`Invalid world ID: ${args.worldId}`);
    }
    const existingPlayer = await ctx.db
      .query('players')
      .withIndex('active', (q) =>
        q.eq('engineId', world.engineId).eq('active', true).eq('human', tokenIdentifier),
      )
      .first();
    if (!existingPlayer) {
      return;
    }
    await sendInput(ctx, {
      engineId: world.engineId,
      name: 'leave',
      args: {
        playerId: existingPlayer._id,
      },
    });
  },
});

export const sendWorldInput = mutation({
  args: {
    worldId: v.id('worlds'),
    name: v.string(),
    args: v.any(),
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`Invalid world ID: ${args.worldId}`);
    }
    return await sendInput(ctx, {
      engineId: world.engineId,
      name: args.name,
      args: args.args,
    });
  },
});

export const activePlayers = query({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`Invalid world ID: ${args.worldId}`);
    }
    const players = await ctx.db
      .query('players')
      .withIndex('active', (q) => q.eq('engineId', world.engineId).eq('active', true))
      .collect();
    return players;
  },
});

export const playerLocation = query({
  args: {
    playerId: v.id('players'),
  },
  handler: async (ctx, args) => {
    const player = await ctx.db.get(args.playerId);
    if (!player) {
      throw new Error(`Invalid player ID: ${args.playerId}`);
    }
    const location = await ctx.db.get(player.locationId);
    if (!location) {
      throw new Error(`Invalid location ID: ${player.locationId}`);
    }
    return location;
  },
});
