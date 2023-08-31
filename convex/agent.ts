// Future: can use node
// 'use node';
// ^ This tells Convex to run this in a `node` environment.
// Read more: https://docs.convex.dev/functions/runtimes
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { Id } from './_generated/dataModel';

import { ActionCtx, internalAction, internalMutation, mutation } from './_generated/server';
import { MemoryDB } from './lib/memory';
import { Message, Player } from './schema';
import {
  chatHistoryFromMessages,
  decideWhoSpeaksNext,
  converse,
  startConversation,
  walkAway,
} from './conversation';
import { getNearbyPlayers, getPoseFromMotion, roundPose } from './lib/physics';
import {
  CONVERSATION_TIME_LIMIT,
  CONVERSATION_PAUSE,
  TICK_DEBOUNCE,
  USER_CONVERSATION_TIME_LIMIT,
} from './config';
import {
  walkToTarget,
  getPlayerNextCollision,
  getRandomPosition,
  currentConversation,
  getLatestPlayerMotion,
} from './journal';
import { enqueueAgentWake } from './engine';
import { activePlayer, activeWorld } from './players';

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

export const talkToMe = mutation({
  args: { playerId: v.id('players') },
  handler: async (ctx, args) => {
    const me = await activePlayer(ctx.auth, ctx.db);
    if (!me) {
      return;
    }
    if (me.id === args.playerId) {
      return;
    }
    const myCurrentConversation = await currentConversation(ctx.db, me.id);
    if (myCurrentConversation && myCurrentConversation.audience.includes(args.playerId)) {
      console.log('already talking to me');
      return;
    }
    const world = await activeWorld(ctx.db);
    if (await currentConversation(ctx.db, args.playerId)) {
      console.log('already talking to someone else');
      return;
    }
    const target = roundPose(
      getPoseFromMotion(await getLatestPlayerMotion(ctx.db, me.id), Date.now()),
    ).position;
    await walkToTarget(ctx, args.playerId, world!._id, [], target);
    const player = (await ctx.db.get(args.playerId))!;
    await ctx.scheduler.runAfter(0, internal.agent.agentsDone, {
      agentId: player.agentId!,
      activity: 'continue' as const,
      ignore: [],
    });
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
  // TODO: pick a better conversation starter
  const leader = pickLeader(players);
  const nonLeaders = players.filter((p) => p.id !== leader.id);
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
    targetId: nonLeaders[0].id,
  });

  const conversationId = await ctx.runMutation(internal.journal.makeConversation, {
    playerId: leader.id,
    audience: nonLeaders.map((p) => p.id),
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

  const endAfterTs =
    Date.now() + (talkingToUser ? USER_CONVERSATION_TIME_LIMIT : CONVERSATION_TIME_LIMIT);
  // Slow down conversations between AIs, but not if a user is involved.
  const conversationPause = talkingToUser ? 0 : CONVERSATION_PAUSE;
  // Choose who should speak next:
  let endConversation = false;
  let lastSpeakerId = leader.id;
  let remainingPlayers = players;

  while (!endConversation) {
    const waitToSpeak = awaitTimeout(messages.length ? conversationPause : 0);
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
        playerCompletion = await converse(ctx, chatHistory, speaker, playerRelations, memory);
      }
      // slow down conversations
      await waitToSpeak;

      let message = undefined;
      let content = '';
      let mutationPromise = null;
      for await (const chunk of playerCompletion.content.read()) {
        content += chunk;
        if (message) {
          // Debounce.
          if (!mutationPromise) {
            mutationPromise = ctx
              .runMutation(internal.journal.talkMore, {
                entryId: message.entryId,
                content,
              })
              .finally(() => {
                mutationPromise = null;
              });
          }
        } else {
          message = await ctx.runMutation(internal.journal.talk, {
            playerId: speaker.id,
            audience,
            content,
            relatedMemoryIds: playerCompletion.memoryIds,
            conversationId,
          });
        }
      }
      if (mutationPromise) {
        await mutationPromise;
      }
      if (message) {
        message = await ctx.runMutation(internal.journal.talkMore, {
          entryId: message.entryId,
          content,
        });
        messages.push(message);
      }
    } else {
      await ctx.runMutation(internal.chat.thinkAboutConversation, {
        playerId: speaker.id,
        conversationId,
      });
      let message: Message | null = null;
      while (!message || message.from !== speaker.id || message.type !== 'responded') {
        message = await ctx.runQuery(internal.chat.lastMessage, {
          conversationId,
        });
        if (message.from === speaker.id && message.type === 'left') {
          endConversation = true;
          break;
        }
        // wait for user to type message.
        await awaitTimeout(100);
      }
      messages.push(message);
    }
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

export const agentsDone = internalMutation({
  args: {
    noSchedule: v.optional(v.boolean()),
    agentId: v.id('agents'),
    activity: v.union(v.literal('walk'), v.literal('continue')),
    ignore: v.array(v.id('players')),
  },
  handler: async (ctx, { noSchedule, agentId, activity, ignore }) => {
    if (!agentId) {
      return;
    }
    const agentDoc = (await ctx.db.get(agentId))!;
    const playerId = agentDoc.playerId;
    const worldId = agentDoc.worldId;
    let walkResult;
    switch (activity) {
      case 'walk':
        const world = (await ctx.db.get(worldId))!;
        const map = (await ctx.db.get(world.mapId))!;
        const targetPosition = getRandomPosition(map);
        walkResult = await walkToTarget(ctx, playerId, worldId, ignore, targetPosition);
        break;
      case 'continue':
        walkResult = await getPlayerNextCollision(ctx.db, worldId, playerId, ignore);
        break;
      default:
        const _exhaustiveCheck: never = activity;
        throw new Error(`Unhandled activity: ${JSON.stringify(activity)}`);
    }
    if (!agentDoc) throw new Error(`Agent ${agentId} not found`);
    // if (!agentDoc.thinking) {
    //   throw new Error('Agent was not thinking: did you call agentDone twice for the same agent?');
    // }

    const wakeTs = walkResult.nextCollision?.ts ?? walkResult.targetEndTs;
    const nextWakeTs = Math.ceil(wakeTs / TICK_DEBOUNCE) * TICK_DEBOUNCE;
    await ctx.db.replace(agentId, {
      playerId: agentDoc.playerId,
      worldId: agentDoc.worldId,
      thinking: false,
      lastWakeTs: agentDoc.nextWakeTs,
      nextWakeTs,
      alsoWake: walkResult.nextCollision?.agentIds,
      scheduled: await enqueueAgentWake(ctx, agentId, agentDoc.worldId, nextWakeTs, noSchedule),
    });
  },
});

function handleDone(ctx: ActionCtx, noSchedule?: boolean): DoneFn {
  const doIt: DoneFn = async (agentId, activity) => {
    // console.debug('handleDone: ', agentId, activity);
    if (!agentId) return;
    await ctx.runMutation(internal.agent.agentsDone, {
      agentId,
      ignore: activity.ignore,
      activity: activity.type,
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
