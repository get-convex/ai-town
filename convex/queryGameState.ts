import { query } from './_generated/server';

export default query({
  handler: async (ctx) => {
    const lastStep = await ctx.db.query('steps').withIndex('endTs').order('desc').first();
    return {
      players: await ctx.db.query('players').collect(),
      startTs: lastStep?.startTs ?? Date.now(),
      endTs: lastStep?.endTs ?? Date.now(),
    };
  },
});
