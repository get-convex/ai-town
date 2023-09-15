import { Point, point } from '../schema/types';
import { Doc, Id } from '../_generated/dataModel';
import { assertNever } from '../util/assertNever';
import { GameState } from './state';
import { pointsEqual } from '../util/geometry';
import { Infer, v } from 'convex/values';

export const playerInput = v.union(
  // Move the player to a specified location.
  v.object({
    kind: v.literal('moveTo'),
    destination: v.union(point, v.null()),
  }),
  // Start a conversation, inviting the specified player.
  // Conversations can only have two participants for now,
  // so we don't have a separate "invite" input.
  v.object({
    kind: v.literal('startConversation'),
    invite: v.id('players'),
  }),
  // Accept an invite to a conversation, which puts the
  // player in the "walkingOver" state until they're close
  // enough to the other participant.
  v.object({
    kind: v.literal('acceptInvite'),
    conversationId: v.id('conversations'),
  }),
  // Reject the invite. Eventually we might add a message
  // that explains why!
  v.object({
    kind: v.literal('rejectInvite'),
    conversationId: v.id('conversations'),
  }),
  // Start typing, indicating that the player wants to talk
  // and other players should wait for them to say something.
  // This "lock" on the conversation will timeout after
  // a few moments.
  v.object({
    kind: v.literal('startTyping'),
    conversationId: v.id('conversations'),
  }),
  // Write a message to a conversation, potentially signalling
  // that we'll be appending to it out-of-band.
  v.object({
    kind: v.literal('writeMessage'),
    conversationId: v.id('conversations'),
    text: v.string(),
    doneWriting: v.boolean(),
  }),
  // For streaming writers that set `doneWriting: false` in `writeMessage` above,
  // tell the game engine that they're done writing.
  v.object({
    kind: v.literal('finishWriting'),
    messageId: v.id('messages'),
  }),
  // Leave a conversation.
  v.object({
    kind: v.literal('leaveConversation'),
    conversationId: v.id('conversations'),
  }),
);

export type PlayerInput = Infer<typeof playerInput>;

export async function handleInput(
  game: GameState,
  now: number,
  { playerId, payload }: Doc<'inputQueue'>,
) {
  switch (payload.kind) {
    case 'moveTo':
      handleMoveTo(game, now, playerId, payload.destination);
      break;
    case 'startConversation':
      handleStartConversation(game, now, playerId, payload.invite);
      break;
    case 'acceptInvite':
      handleAcceptInvite(game, now, playerId, payload.conversationId);
      break;
    case 'rejectInvite':
      handleRejectInvite(game, now, playerId, payload.conversationId);
      break;
    case 'startTyping':
      handleStartTyping(game, now, playerId, payload.conversationId);
      break;
    case 'writeMessage':
      handleWriteMessage(
        game,
        now,
        playerId,
        payload.conversationId,
        payload.text,
        payload.doneWriting,
      );
      break;
    case 'finishWriting':
      handleFinishWriting(game, now, playerId, payload.messageId);
      break;
    case 'leaveConversation':
      handleLeaveConversation(game, now, playerId, payload.conversationId);
      break;
    default:
      assertNever(payload);
  }
}

async function handleMoveTo(
  game: GameState,
  now: number,
  playerId: Id<'players'>,
  destination: Point | null,
) {
  const player = game.players.lookup(playerId);
  if (destination === null) {
    delete player.pathfinding;
    return;
  }
  if (Math.floor(destination.x) !== destination.x || Math.floor(destination.y) !== destination.y) {
    console.warn(`Non-integral destination: ${JSON.stringify(destination)}`);
    return;
  }
  // Close enough to current position or destination => no-op.
  if (pointsEqual(player.position, destination)) {
    return;
  }
  // Don't allow players in a conversation to move.
  const member = game.conversationMembers.find(
    (m) => m.playerId === playerId && m.status === 'participating',
  );
  if (member) {
    console.warn(`Can't move player ${playerId} in a conversation`);
    return;
  }
  player.pathfinding = {
    destination: destination,
    started: now,
    state: {
      kind: 'needsPath',
    },
  };
}

async function handleStartConversation(
  game: GameState,
  _now: number,
  playerId: Id<'players'>,
  inviteeId: Id<'players'>,
) {
  if (playerId === inviteeId) {
    console.warn(`Can't invite yourself to a conversation`);
  }
  if (game.conversationMembers.find((m) => m.playerId === playerId)) {
    console.warn(`Player ${playerId} is already in a conversation`);
    return;
  }
  if (game.conversationMembers.find((m) => m.playerId === inviteeId)) {
    console.warn(`Invitee ${inviteeId} is already in a conversation`);
    return;
  }

  const conversationId = await game.conversations.insert({
    creator: playerId,
    typing: undefined,
    finished: undefined,
  });
  await game.conversationMembers.insert({
    conversationId,
    playerId,
    status: 'walkingOver',
  });
  await game.conversationMembers.insert({
    conversationId,
    playerId: inviteeId,
    status: 'invited',
  });
}

async function handleAcceptInvite(
  game: GameState,
  _now: number,
  playerId: Id<'players'>,
  conversationId: Id<'conversations'>,
) {
  const membership = game.conversationMembers.find((m) => m.playerId === playerId);
  if (membership === null) {
    console.warn(`Couldn't find invite for ${playerId}:${conversationId}`);
    return;
  }
  if (membership.status !== 'invited') {
    console.warn(
      `Invalid membership status for ${playerId}:${conversationId}: ${JSON.stringify(membership)}`,
    );
    return;
  }
  membership.status = 'walkingOver';
}

async function handleRejectInvite(
  game: GameState,
  now: number,
  playerId: Id<'players'>,
  conversationId: Id<'conversations'>,
) {
  const conversation = game.conversations.find((d) => d._id === conversationId);
  if (conversation === null) {
    console.warn(`Couldn't find conversation: ${conversationId}`);
    return;
  }
  const memberships = game.conversationMembers.filter((d) => d.conversationId === conversationId);
  if (memberships.length !== 2) {
    console.warn(`Conversation ${conversationId} didn't have two members.`);
    return;
  }
  const membership = memberships.find((m) => m.playerId === playerId);
  if (!membership) {
    console.warn(`Couldn't find membership for ${conversationId}:${playerId}`);
    return;
  }
  if (membership.status !== 'invited') {
    console.warn(
      `Rejecting invite in wrong membership state: ${conversationId}:${playerId}: ${JSON.stringify(
        membership,
      )}`,
    );
  }

  // Stop the conversation.
  delete conversation.typing;
  conversation.finished = now;

  // Clear all memberships for the conversation.
  for (const membership of memberships) {
    game.conversationMembers.delete(membership._id);
  }
}

async function handleStartTyping(
  game: GameState,
  now: number,
  playerId: Id<'players'>,
  conversationId: Id<'conversations'>,
) {
  const conversation = game.conversations.find((d) => d._id === conversationId);
  if (conversation === null) {
    console.warn(`Couldn't find conversation: ${conversationId}`);
    return;
  }
  if (conversation.typing) {
    console.warn(`Player ${playerId} is already typing`);
    return;
  }
  conversation.typing = {
    playerId,
    started: now,
  };
}

async function handleWriteMessage(
  game: GameState,
  _now: number,
  playerId: Id<'players'>,
  conversationId: Id<'conversations'>,
  text: string,
  doneWriting: boolean,
) {
  const conversation = game.conversations.find((d) => d._id === conversationId);
  if (conversation === null) {
    console.warn(`Couldn't find conversation: ${conversationId}`);
    return;
  }
  const membership = game.conversationMembers.find(
    (d) => d.conversationId === conversationId && d.playerId === playerId,
  );
  if (!membership) {
    console.warn(`${playerId} not in conversation ${conversationId}`);
    return;
  }
  if (membership.status !== 'participating') {
    console.warn(`${playerId} not participating in conversation ${conversationId}`);
    return;
  }

  // If we were previously typing, release the "lock" now that we've sent our message.
  if (conversation.typing && conversation.typing.playerId === playerId) {
    delete conversation.typing;
  }
  const messageId = await game.messages.insert({
    author: playerId,
    conversationId: conversationId,
    streamed: !doneWriting,
    doneWriting,
  });
  await game.messages.db.insert('messageText', {
    messageId: messageId,
    text,
  });
}

async function handleFinishWriting(
  game: GameState,
  _now: number,
  playerId: Id<'players'>,
  messageId: Id<'messages'>,
) {
  const message = game.messages.lookup(messageId);
  if (message.author !== playerId) {
    console.warn("Can't finish another user's message");
    return;
  }
  if (message.doneWriting) {
    console.warn('Message has already been closed');
    return;
  }
  message.doneWriting = true;
}

async function handleLeaveConversation(
  game: GameState,
  now: number,
  playerId: Id<'players'>,
  conversationId: Id<'conversations'>,
) {
  const conversation = game.conversations.find((d) => d._id === conversationId);
  if (conversation === null) {
    console.warn(`Couldn't find conversation: ${conversationId}`);
    return;
  }
  const memberships = game.conversationMembers.filter((d) => d.conversationId === conversationId);
  const membership = memberships.find((m) => m.playerId === playerId);
  if (!membership) {
    console.warn(`Couldn't find membership for ${conversationId}:${playerId}`);
    return;
  }

  // Stop the conversation.
  delete conversation.typing;
  conversation.finished = now;

  // Clear all memberships for the conversation.
  for (const membership of memberships) {
    game.conversationMembers.delete(membership._id);
  }
}
