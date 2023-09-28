import { v } from 'convex/values';
import { api, internal } from './_generated/api';
import {
  DatabaseReader,
  DatabaseWriter,
  MutationCtx,
  internalMutation,
  mutation,
} from './_generated/server';
import { Descriptions } from './data/characters';
import { insertInput } from './game/main';
import { initAgent, restartAgents, stopAgents } from './agent/init';
import { Id } from './_generated/dataModel';

const init = mutation({
  handler: async (ctx) => {
    if (!process.env.OPENAI_API_KEY) {
      const deploymentName = process.env.CONVEX_CLOUD_URL?.slice(8).replace('.convex.cloud', '');
      throw new Error(
        '\n  Missing OPENAI_API_KEY in environment variables.\n\n' +
          '  Get one at https://openai.com/\n\n' +
          '  Paste it on the Convex dashboard:\n' +
          '  https://dashboard.convex.dev/d/' +
          deploymentName +
          '/settings?var=OPENAI_API_KEY',
      );
    }
    const { world, engine } = await getOrCreateDefaultWorld(ctx.db);
    if (!engine.active) {
      console.warn(`Engine ${engine._id} is not active, restarting...`);
      await restartWorld(ctx, world._id);
    }
    // Send inputs to create players for all of the agents.
    if (await shouldCreateAgents(ctx.db, engine._id)) {
      for (const agent of Descriptions) {
        const inputId = await insertInput(ctx, engine._id, 'join', {
          name: agent.name,
          description: agent.identity,
          character: agent.character,
        });
        await ctx.scheduler.runAfter(1000, internal.init.completeAgentCreation, {
          engineId: engine._id,
          joinInputId: inputId,
          character: agent.character,
        });
      }
    }
    // Restart the agents if needed.
    await restartAgents(ctx, { engineId: engine._id });
  },
});
export default init;

export const stop = internalMutation({
  handler: async (ctx) => {
    const { world, engine } = await getDefaultWorld(ctx.db);
    if (!engine.active) {
      console.warn(`Engine ${engine._id} is already stopped`);
      return;
    }
    console.log(`Stopping engine ${engine._id}...`);
    await ctx.db.patch(engine._id, { active: false });
    stopAgents(ctx, { engineId: world.engineId });
  },
});

export const archive = internalMutation({
  handler: async (ctx) => {
    const { world, engine } = await getDefaultWorld(ctx.db);
    if (engine.active) {
      throw new Error(`Engine ${engine._id} is still active`);
    }
    console.log(`Archiving world ${world._id}...`);
    await ctx.db.patch(world._id, { isDefault: false });
  },
});

async function getDefaultWorld(db: DatabaseReader) {
  const world = await db
    .query('worlds')
    .filter((q) => q.eq(q.field('isDefault'), true))
    .first();
  if (!world) {
    throw new Error('No default world found');
  }
  const engine = await db.get(world.engineId);
  if (!engine) {
    throw new Error(`Engine ${world.engineId} not found`);
  }
  return { world, engine };
}

async function getOrCreateDefaultWorld(db: DatabaseWriter) {
  const now = Date.now();
  let world = await db
    .query('worlds')
    .filter((q) => q.eq(q.field('isDefault'), true))
    .first();
  if (!world) {
    const engineId = await db.insert('engines', {
      active: true,
      currentTime: now,
      generationNumber: 0,
      idleUntil: now,
    });
    const worldId = await db.insert('worlds', { engineId, isDefault: true, lastViewed: now });
    world = (await db.get(worldId))!;
  }
  const engine = await db.get(world.engineId);
  if (!engine) {
    throw new Error(`Engine ${world.engineId} not found`);
  }
  return { world, engine };
}

async function shouldCreateAgents(db: DatabaseReader, engineId: Id<'engines'>) {
  const players = await db
    .query('players')
    .withIndex('active', (q) => q.eq('engineId', engineId))
    .collect();
  for (const player of players) {
    const agent = await db
      .query('agents')
      .withIndex('playerId', (q) => q.eq('playerId', player._id))
      .first();
    if (agent) {
      return false;
    }
  }
  const unactionedJoinInputs = await db
    .query('inputs')
    .withIndex('byInputNumber', (q) => q.eq('engineId', engineId))
    .order('asc')
    .filter((q) => q.eq(q.field('name'), 'join'))
    .filter((q) => q.eq(q.field('returnValue'), undefined))
    .collect();
  if (unactionedJoinInputs.length > 0) {
    return false;
  }
  return true;
}

export const completeAgentCreation = internalMutation({
  args: {
    engineId: v.id('engines'),
    joinInputId: v.id('inputs'),
    character: v.string(),
  },
  handler: async (ctx, args) => {
    const input = await ctx.db.get(args.joinInputId);
    if (!input || input.name !== 'join') {
      throw new Error(`Invalid input ID ${args.joinInputId}`);
    }
    const { returnValue } = input;
    if (!returnValue) {
      console.warn(`Input ${input._id} not ready, waiting...`);
      ctx.scheduler.runAfter(5000, internal.init.completeAgentCreation, args);
      return;
    }
    if (returnValue.kind === 'error') {
      throw new Error(`Error creating agent: ${returnValue.message}`);
    }
    const playerId = returnValue.value;
    const existingAgent = await ctx.db
      .query('agents')
      .withIndex('playerId', (q) => q.eq('playerId', playerId))
      .first();
    if (existingAgent) {
      throw new Error(`Agent for player ${playerId} already exists`);
    }
    await initAgent(ctx, { engineId: args.engineId, playerId, character: args.character });
  },
});

export async function restartWorld(ctx: MutationCtx, worldId: Id<'worlds'>) {
  const world = await ctx.db.get(worldId);
  if (!world) {
    throw new Error(`Invalid world ID: ${worldId}`);
  }
  const engine = await ctx.db.get(world.engineId);
  if (!engine) {
    throw new Error(`Invalid engine ID: ${world.engineId}`);
  }
  if (engine.active) {
    console.warn(`Engine ${engine._id} is already active`);
    return;
  }
  console.log(`Restarting engine ${engine._id}...`);
  const now = Date.now();
  engine.active = true;
  const generationNumber = engine.generationNumber + 1;
  engine.generationNumber = generationNumber;
  engine.idleUntil = now;
  await ctx.db.replace(engine._id, engine);
  await ctx.scheduler.runAt(now, api.game.main.runStep, {
    engineId: engine._id,
    generationNumber,
  });
}
