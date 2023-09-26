import { api } from './_generated/api';
import { mutation } from './_generated/server';

export const init = mutation({
  handler: async (ctx) => {
    const defaultWorld = await ctx.db
      .query('worlds')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (defaultWorld) {
      throw new Error(`Default world already exists`);
    }
    const now = Date.now();
    const generationNumber = 0;
    const engineId = await ctx.db.insert('engines', {
      active: true,
      currentTime: now,
      generationNumber,
      idleUntil: now,
    });
    ctx.scheduler.runAt(now, api.game.main.runStep, {
      engineId,
      generationNumber,
    });
    const worldId = await ctx.db.insert('worlds', { engineId, isDefault: true });
    console.log(`Starting world ${worldId}...`);
  },
});
