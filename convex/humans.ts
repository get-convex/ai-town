import { mutation, query } from './_generated/server';
import { insertInput } from './engine';

export const humanStatus = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }
    const player = await ctx.db
      .query('players')
      .withIndex('enabled', (q) => q.eq('enabled', true).eq('human', identity.tokenIdentifier))
      .first();
    return player?._id ?? null;
  },
});

export const join = mutation({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error(`Not logged in`);
    }
    if (!identity.givenName) {
      throw new Error(`Missing givenName on ${JSON.stringify(identity)}`);
    }
    const { tokenIdentifier } = identity;
    const existingPlayer = await ctx.db
      .query('players')
      .withIndex('enabled', (q) => q.eq('enabled', true).eq('human', tokenIdentifier))
      .first();
    if (existingPlayer) {
      throw new Error(`Already joined as ${existingPlayer._id}`);
    }
    await insertInput(ctx.db, Date.now(), {
      kind: 'join',
      args: {
        name: identity.givenName,
        description: `${identity.givenName} is a human player`,
        tokenIdentifier,
      },
    });
  },
});

export const leave = mutation({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error(`Not logged in`);
    }
    const { tokenIdentifier } = identity;
    const existingPlayer = await ctx.db
      .query('players')
      .withIndex('enabled', (q) => q.eq('enabled', true).eq('human', tokenIdentifier))
      .first();
    if (!existingPlayer) {
      return;
    }
    await insertInput(ctx.db, Date.now(), {
      kind: 'leave',
      args: { playerId: existingPlayer._id },
    });
  },
});
