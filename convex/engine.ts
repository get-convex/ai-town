import { v } from 'convex/values';
import { DatabaseWriter, mutation } from './_generated/server';
import { Id } from './_generated/dataModel';
import { MAX_STEP, TICK } from './constants';
import { PlayerInput, playerInput, handleInput } from './game/input';
import { GameState } from './game/state';
import { tick } from './game/tick';

export const addPlayerInput = mutation({
  args: {
    playerId: v.id('players'),
    input: playerInput,
  },
  handler: async (ctx, args) => {
    await insertInput(ctx.db, args.playerId, args.input);
  },
});

export async function insertInput(
  db: DatabaseWriter,
  playerId: Id<'players'>,
  payload: PlayerInput,
) {
  const serverTimestamp = Date.now();
  const lastInput = await db
    .query('inputQueue')
    .withIndex('clientTimestamp', (q) => q.eq('playerId', playerId))
    .order('desc')
    .first();
  if (lastInput !== null) {
    if (lastInput.serverTimestamp >= serverTimestamp) {
      throw new Error('Time not moving forwards');
    }
  }
  await db.insert('inputQueue', {
    playerId,
    serverTimestamp,
    payload,
  });
}

export const step = mutation({
  handler: async (ctx) => {
    const now = Date.now();

    const lastStep = await ctx.db.query('steps').withIndex('endTs').order('desc').first();
    if (lastStep && lastStep.endTs >= now) {
      throw new Error(`Time moving backwards!`);
    }
    const lastServerTs = lastStep ? lastStep.endTs : -1;
    const startTs = lastStep ? lastStep.endTs : now;
    const endTs = Math.min(now, startTs + MAX_STEP);
    console.log(`Simulating ${startTs} -> ${endTs}: (${Math.round(endTs - startTs)}ms)`);

    // Load the game state.
    const gameState = await GameState.load(startTs, ctx.db);

    // Collect player inputs since the last step, sorted by (serverTimestamp, playerId, _id)
    const stepInputs = [];
    for (const playerId of gameState.players.allIds()) {
      const playerInputs = await ctx.db
        .query('inputQueue')
        .withIndex('clientTimestamp', (q) =>
          q
            .eq('playerId', playerId)
            .gt('serverTimestamp', lastServerTs)
            .lte('serverTimestamp', endTs),
        )
        .collect();
      stepInputs.push(...playerInputs);
    }
    stepInputs.sort((a, b) => {
      if (a.serverTimestamp !== b.serverTimestamp) {
        return a.serverTimestamp - b.serverTimestamp;
      }
      if (a.playerId !== b.playerId) {
        return a.playerId.localeCompare(b.playerId);
      }
      return a._id.localeCompare(b._id);
    });

    let inputIndex = 0;
    let currentTs;
    for (currentTs = startTs; currentTs <= endTs; currentTs += TICK) {
      while (inputIndex < stepInputs.length) {
        const input = stepInputs[inputIndex];
        if (input.serverTimestamp > currentTs) {
          break;
        }
        inputIndex += 1;
        await handleInput(gameState, currentTs, input);
      }
      tick(gameState, currentTs);
    }
    // "Commit" the update by writing back the game state and a new steps checkpoint.
    await gameState.save(currentTs);
    await ctx.db.insert('steps', { startTs, endTs: currentTs });
  },
});
