// Future: can use node
// 'use node';
// ^ This tells Convex to run this in a `node` environment.
// Read more: https://docs.convex.dev/functions/runtimes
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { Id } from './_generated/dataModel';

import { ActionCtx, internalAction, internalMutation, internalQuery } from './_generated/server';
import { MemoryDB } from './lib/memory';
import { Message, Player } from './schema';
import {
  chatHistoryFromMessages,
  decideWhoSpeaksNext,
  converse,
  startConversation,
  walkAway,
} from './conversation';
import { getNearbyPlayers } from './lib/physics';
import { CONVERSATION_TIME_LIMIT, CONVERSATION_PAUSE } from './config';
import { walkToTarget, getPlayerNextCollision, getRandomPosition } from './journal';
import { agentDone } from './engine';
import { getAllPlayers } from './players';

const awaitTimeout = (delay: number) => new Promise((resolve) => setTimeout(resolve, delay));

export const runAgentBatch = internalAction({
  args: {
    playerIds: v.array(v.id('players')),
    noSchedule: v.optional(v.boolean()),
  },
  handler: async (ctx, { playerIds, noSchedule }) => {
    const memory = MemoryDB(ctx);
    // TODO: single-flight done & action API to avoid write contention.
    const done: DoneFn = handleDone(ctx, noSchedule);
    // Get the current state of the world
    const { players } = await ctx.runQuery(internal.journal.getSnapshot, { playerIds });
    // Segment users by location
    const { groups, solos } = divideIntoGroups(players);
    // Run a conversation for each group.
    const groupPromises = groups.map(async (group) => {
      const finished = new Set<Id<'agents'>>();
      try {
        await handleAgentInteraction(ctx, group, memory, (agentId, activity) => {
          if (agentId) finished.add(agentId);
          return done(agentId, activity);
        });
      } catch (e) {
        console.error(
          'group failed, going for a walk: ',
          group.map((p) => p.agentId),
        );
        for (const player of group) {
          if (player.agentId && !finished.has(player.agentId)) {
            await done(player.agentId, { type: 'walk', ignore: group.map((p) => p.id) });
          }
        }
        throw e;
      }
    });
    // For those not in a group, run the solo agent loop.
    const soloPromises = solos.map(async (player) => {
      try {
        if (player.agentId) {
          await handleAgentSolo(ctx, player, memory, done);
        }
      } catch (e) {
        console.error('agent failed, going for a walk: ', player.agentId);
        await done(player.agentId, { type: 'walk', ignore: [] });
        throw e;
      }
    });

    // Make a structure that resolves when the agent yields.
    // It should fail to do any actions if the agent has already yielded.

    const start = Date.now();
    // While testing if you want failures to show up more loudly, use this instead:
    await Promise.all([...groupPromises, ...soloPromises]);
    // Otherwise, this will allow each group / solo to complete:
    // const results = await Promise.allSettled([...groupPromises, ...soloPromises]);
    // for (const result of results) {
    //   if (result.status === 'rejected') {
    //     console.error(result.reason, playerIds);
    //   }
    // }

    console.debug(
      `agent batch (${groups.length}g ${solos.length}s) finished: ${Date.now() - start}ms`,
    );
  },
});

function divideIntoGroups(players: Player[]) {
  const playerById = new Map(players.map((p) => [p.id, p]));
  const groups: Player[][] = [];
  const solos: Player[] = [];
  while (playerById.size > 0) {
    const player = playerById.values().next().value as Player;
    playerById.delete(player.id);
    const nearbyPlayers = getNearbyPlayers(player.motion, [...playerById.values()]);
    if (nearbyPlayers.length > 0) {
      // If you only want to do 1:1 conversations, use this:
      // groups.push([player, nearbyPlayers[0]]);
      // playerById.delete(nearbyPlayers[0].id);
      // otherwise, do more than 1:1 conversations by adding them all:
      groups.push([player, ...nearbyPlayers]);
      for (const nearbyPlayer of nearbyPlayers) {
        playerById.delete(nearbyPlayer.id);
      }
    } else {
      solos.push(player);
    }
  }
  return { groups, solos };
}

async function handleAgentSolo(ctx: ActionCtx, player: Player, memory: MemoryDB, done: DoneFn) {
  if (!player.agentId) {
    return;
  }
  // console.debug('handleAgentSolo: ', player.name, player.id);
  // Handle new observations: it can look at the agent's lastWakeTs for a delta.
  //   Calculate scores
  // Run reflection on memories once in a while
  await memory.reflectOnMemories(player.id, player.name);
  // Future: Store observations about seeing players in conversation
  //  might include new observations -> add to memory with openai embeddings
  // Later: handle object ownership?
  // Based on plan and observations, determine next action:
  //   if so, add new memory for new plan, and return new action
  const walk = player.motion.type === 'stopped' || player.motion.targetEndTs < Date.now();
  // Ignore everyone we last said something to.
  const ignore =
    player.motion.type === 'walking' ? player.motion.ignore : player.lastChat?.message.to ?? [];
  await done(player.agentId, { type: walk ? 'walk' : 'continue', ignore });
}

function pickLeader(players: Player[]): Player {
  for (const player of players) {
    if (!player.agentId) {
      return player;
    }
  }
  return players[0];
}

export async function handleAgentInteraction(
  ctx: ActionCtx,
  players: Player[],
  memory: MemoryDB,
  done: DoneFn,
) {
  console.log(`${players.length} players starting to interact`);
  // TODO: pick a better conversation starter
  const leader = pickLeader(players);
  const talkingToUser = !leader.agentId;
  for (const player of players) {
    const imWalkingHere =
      player.motion.type === 'walking' && player.motion.targetEndTs > Date.now();
    // Get players to walk together and face each other
    if (player.agentId) {
      if (player === leader) {
        if (imWalkingHere) {
          await ctx.runMutation(internal.journal.stop, {
            playerId: player.id,
          });
        }
      } else {
        await ctx.runMutation(internal.journal.walk, {
          agentId: player.agentId,
          target: leader.id,
          ignore: players.map((p) => p.id),
        });
        // TODO: collect collisions and pass them into the engine to wake up
        // other players to avoid these ones in conversation.
      }
    }
  }
  await ctx.runMutation(internal.journal.turnToFace, {
    playerId: leader.id,
    targetId: players[1].id,
  });

  const conversationId = await ctx.runMutation(internal.journal.makeConversation, {
    playerId: leader.id,
    audience: players.slice(1).map((p) => p.id),
  });

  const playerById = new Map(players.map((p) => [p.id, p]));
  const relations = await ctx.runQuery(internal.journal.getRelationships, {
    playerIds: players.map((p) => p.id),
  });
  const relationshipsByPlayerId = new Map(
    relations.map(({ playerId, relations }) => [
      playerId,
      relations.map((r) => ({ ...playerById.get(r.id)!, relationship: r.relationship })),
    ]),
  );

  const messages: Message[] = [];

  const endAfterTs = Date.now() + (talkingToUser ? 570_000 : CONVERSATION_TIME_LIMIT);
  // Choose who should speak next:
  let endConversation = false;
  let lastSpeakerId = leader.id;
  let remainingPlayers = players;

  while (!endConversation) {
    // leader speaks first
    const chatHistory = chatHistoryFromMessages(messages);
    const speaker =
      messages.length === 0
        ? leader
        : await decideWhoSpeaksNext(
            remainingPlayers.filter((p) => p.id !== lastSpeakerId),
            chatHistory,
          );
    lastSpeakerId = speaker.id;
    const audience = players.filter((p) => p.id !== speaker.id).map((p) => p.id);
    const shouldWalkAway =
      audience.length === 0 ||
      (!talkingToUser && (await walkAway(chatHistory, speaker))) ||
      Date.now() > endAfterTs;

    // Decide if we keep talking.
    if (shouldWalkAway) {
      // It's to chatty here, let's go somewhere else.
      await ctx.runMutation(internal.journal.leaveConversation, {
        playerId: speaker.id,
      });
      // Update remaining players
      remainingPlayers = remainingPlayers.filter((p) => p.id !== speaker.id);
      // End the interaction if there's no one left to talk to.
      endConversation = audience.length === 0;

      // TODO: remove this player from the audience list
      break;
    }

    if (speaker.agentId) {
      const playerRelations = relationshipsByPlayerId.get(speaker.id) ?? [];
      let playerCompletion;
      if (messages.length === 0) {
        playerCompletion = await startConversation(ctx, playerRelations, memory, speaker);
      } else {
        // TODO: stream the response and write to the mutation for every sentence.
        playerCompletion = await converse(ctx, chatHistory, speaker, playerRelations, memory);
      }

      const message = await ctx.runMutation(internal.journal.talk, {
        playerId: speaker.id,
        audience,
        content: playerCompletion.content,
        relatedMemoryIds: playerCompletion.memoryIds,
        conversationId,
      });

      if (message) {
        messages.push(message);
      }
    } else {
      let message: Message | null = null;
      while (!message || message.from !== speaker.id || message.type !== 'responded') {
        message = await ctx.runQuery(internal.chat.lastMessage, {
          conversationId,
        });
        if (message.from === speaker.id && message.type === 'left') {
          break;
        }
        // wait for user to type message.
        await awaitTimeout(100);
      }
      messages.push(message);
    }

    // slow down conversations
    await awaitTimeout(CONVERSATION_PAUSE);
  }

  if (messages.length > 0) {
    for (const player of players) {
      await memory.rememberConversation(player.name, player.id, player.identity, conversationId);
      await done(player.agentId, { type: 'walk', ignore: players.map((p) => p.id) });
    }
  }
}

type DoneFn = (
  agentId: Id<'agents'> | undefined,
  activity:
    | { type: 'walk'; ignore: Id<'players'>[] }
    | { type: 'continue'; ignore: Id<'players'>[] },
) => Promise<void>;

export const planCollisions = internalMutation({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    const players = await getAllPlayers(ctx.db, args.worldId);
    const playerActivities = [];
    for (const player of players) {
      playerActivities.push({
        playerId: player._id,
        activity: 'continue' as const,
        ignore: [],
      });
    }
    console.log('planning new collisions');
    await ctx.scheduler.runAfter(0, internal.agent.agentsDone, {
      worldId: args.worldId,
      playerActivities,
    });
  },
});

export const agentsDone = internalMutation({
  args: {
    worldId: v.id('worlds'),
    noSchedule: v.optional(v.boolean()),
    playerActivities: v.array(
      v.object({
        playerId: v.id('players'),
        activity: v.union(v.literal('walk'), v.literal('continue')),
        ignore: v.array(v.id('players')),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const { playerId, activity, ignore } of args.playerActivities) {
      const player = (await ctx.db.get(playerId))!;
      if (!player.agentId) {
        continue;
      }
      let walkResult;
      switch (activity) {
        case 'walk':
          const world = (await ctx.db.get(args.worldId))!;
          const map = (await ctx.db.get(world.mapId))!;
          const targetPosition = getRandomPosition(map);
          walkResult = await walkToTarget(ctx, playerId, args.worldId, ignore, targetPosition);
          break;
        case 'continue':
          walkResult = await getPlayerNextCollision(ctx.db, args.worldId, playerId, ignore);
          break;
        default:
          const _exhaustiveCheck: never = activity;
          throw new Error(`Unhandled activity: ${JSON.stringify(activity)}`);
      }
      await agentDone(ctx, {
        agentId: player.agentId!,
        otherAgentIds: walkResult.nextCollision?.agentIds,
        wakeTs: walkResult.nextCollision?.ts ?? walkResult.targetEndTs,
        noSchedule: args.noSchedule,
      });
    }
  },
});

export const getAgent = internalQuery({
  args: { agentId: v.id('agents') },
  handler: async (ctx, { agentId }) => {
    const agentDoc = (await ctx.db.get(agentId))!;
    const { playerId, worldId } = agentDoc;
    return { playerId, worldId };
  },
});

function handleDone(ctx: ActionCtx, noSchedule?: boolean): DoneFn {
  const doIt: DoneFn = async (agentId, activity) => {
    // console.debug('handleDone: ', agentId, activity);
    if (!agentId) return;
    const { playerId, worldId } = await ctx.runQuery(internal.agent.getAgent, { agentId });
    await ctx.runMutation(internal.agent.agentsDone, {
      worldId,
      playerActivities: [
        {
          playerId,
          ignore: activity.ignore,
          activity: activity.type,
        },
      ],
      noSchedule,
    });
  };
  // Simple serialization: only one agent finishes at a time.
  const queue = new Set<Promise<unknown>>();
  return async (agentId, activity) => {
    let unlock: (v: unknown) => void = () => {};
    const wait = new Promise((resolve) => (unlock = resolve));
    const toAwait = [...queue];
    queue.add(wait);
    try {
      await Promise.allSettled(toAwait);
      await doIt(agentId, activity);
    } finally {
      unlock(null);
      queue.delete(wait);
    }
  };
}
