import { query } from "./_generated/server";

export default query({
    handler: async (ctx) => {
        const lastStep = await ctx.db.query("steps").withIndex("serverTimestamp").order("desc").first();
        return {
            players: await ctx.db.query("players").collect(),
            serverTimestamp: lastStep?.serverTimestamp ?? null,
        };
    }
})