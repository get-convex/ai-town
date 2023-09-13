import { mutation, query } from "./_generated/server";
import { addPlayer } from "./players";

export const humanStatus = query({
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return null;
        }
        const human = await ctx.db
            .query("humans")
            .withIndex("tokenIdentifier", q => q.eq("tokenIdentifier", identity.tokenIdentifier))
            .unique();
        if (!human) {
            return null;
        }
        return human.playerId ?? null;
    },
})

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
        let human = await ctx.db
            .query("humans")
            .withIndex("tokenIdentifier", q => q.eq("tokenIdentifier", tokenIdentifier))
            .unique();
        if (human === null) {
            const humanId = await ctx.db.insert("humans", { tokenIdentifier, joined: Date.now() });
            human = await ctx.db.get(humanId);
        }
        if (human!.playerId) {
            return human!.playerId;
        }
        const playerId = await addPlayer(ctx, { name: identity.givenName });
        await ctx.db.patch(human!._id, { playerId, joined: Date.now() });
        return playerId;
    }
})

export const leave = mutation({
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error(`Not logged in`);
        }
        const { tokenIdentifier } = identity;
        const human = await ctx.db
            .query("humans")
            .withIndex("tokenIdentifier", q => q.eq("tokenIdentifier", tokenIdentifier))
            .unique();
        if (human === null) {
            return;
        }
        if (!human.playerId) {
            return;
        }
        await ctx.db.patch(human._id, { playerId: undefined });
        await ctx.db.delete(human.playerId);
    }
})