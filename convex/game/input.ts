import { Point, point } from '../util/types';
import { Doc, Id } from '../_generated/dataModel';
import { assertNever } from '../util/assertNever';
import { GameState } from './state';
import { pointsEqual } from '../util/geometry';
import { Infer, v } from 'convex/values';
import { InputArgs, InputReturnValue, args } from '../schema/input';

export async function handleInput(game: GameState, now: number, input: Infer<typeof args>) {
  switch (input.kind) {
    case 'moveTo':
      return await handleMoveTo(game, now, input.args);
    case 'startConversation':
      return await handleStartConversation(game, now, input.args);
    case 'acceptInvite':
      return await handleAcceptInvite(game, now, input.args);
    case 'rejectInvite':
      return await handleRejectInvite(game, now, input.args);
    case 'startTyping':
      return await handleStartTyping(game, now, input.args);
    case 'writeMessage':
      return await handleWriteMessage(game, now, input.args);
    case 'finishWriting':
      return await handleFinishWriting(game, now, input.args);
    case 'leaveConversation':
      return await handleLeaveConversation(game, now, input.args);
    default:
      assertNever(input);
  }
}

async function handleMoveTo(
  game: GameState,
  now: number,
  { playerId, destination }: InputArgs<'moveTo'>,
): Promise<InputReturnValue<'moveTo'>> {
  const player = game.players.lookup(playerId);
  if (destination === null) {
    delete player.pathfinding;
    return null;
  }
  if (Math.floor(destination.x) !== destination.x || Math.floor(destination.y) !== destination.y) {
    throw new Error(`Non-integral destination: ${JSON.stringify(destination)}`);
  }
  // Close enough to current position or destination => no-op.
  if (pointsEqual(player.position, destination)) {
    return null;
  }
  // Don't allow players in a conversation to move.
  const member = game.conversationMembers.find(
    (m) => m.playerId === playerId && m.status === 'participating',
  );
  if (member) {
    throw new Error(`Can't move when in a conversation. Leave the conversation first!`);
  }
  player.pathfinding = {
    destination: destination,
    started: now,
    state: {
      kind: 'needsPath',
    },
  };
  return null;
}

async function handleStartConversation(
  game: GameState,
  _now: number,
  { playerId, invitee }: InputArgs<'startConversation'>,
): Promise<InputReturnValue<'startConversation'>> {
  console.log(`Starting ${playerId} ${invitee}...`);
  if (playerId === invitee) {
    throw new Error(`Can't invite yourself to a conversation`);
  }
  if (game.conversationMembers.find((m) => m.playerId === playerId)) {
    throw new Error(`Player ${playerId} is already in a conversation`);
  }
  if (game.conversationMembers.find((m) => m.playerId === invitee)) {
    throw new Error(`Invitee ${invitee} is already in a conversation`);
  }
  const conversationId = await game.conversations.insert({
    creator: playerId,
    typing: undefined,
    finished: undefined,
  });
  console.log(`Creating conversation ${conversationId}`);
  await game.conversationMembers.insert({
    conversationId,
    playerId,
    status: 'walkingOver',
  });
  await game.conversationMembers.insert({
    conversationId,
    playerId: invitee,
    status: 'invited',
  });
  return conversationId;
}

async function handleAcceptInvite(
  game: GameState,
  _now: number,
  { playerId, conversationId }: InputArgs<'acceptInvite'>,
): Promise<InputReturnValue<'acceptInvite'>> {
  const membership = game.conversationMembers.find((m) => m.playerId === playerId);
  if (membership === null) {
    throw new Error(`Couldn't find invite for ${playerId}:${conversationId}`);
  }
  if (membership.status !== 'invited') {
    throw new Error(
      `Invalid membership status for ${playerId}:${conversationId}: ${JSON.stringify(membership)}`,
    );
  }
  membership.status = 'walkingOver';
  return null;
}

async function handleRejectInvite(
  game: GameState,
  now: number,
  { playerId, conversationId }: InputArgs<'rejectInvite'>,
): Promise<InputReturnValue<'rejectInvite'>> {
  const conversation = game.conversations.find((d) => d._id === conversationId);
  if (conversation === null) {
    throw new Error(`Couldn't find conversation: ${conversationId}`);
  }
  const memberships = game.conversationMembers.filter((d) => d.conversationId === conversationId);
  if (memberships.length !== 2) {
    throw new Error(`Conversation ${conversationId} didn't have two members.`);
  }
  const membership = memberships.find((m) => m.playerId === playerId);
  if (!membership) {
    throw new Error(`Couldn't find membership for ${conversationId}:${playerId}`);
  }
  if (membership.status !== 'invited') {
    throw new Error(
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

  return null;
}

async function handleStartTyping(
  game: GameState,
  now: number,
  { playerId, conversationId }: InputArgs<'startTyping'>,
): Promise<InputReturnValue<'startTyping'>> {
  const conversation = game.conversations.find((d) => d._id === conversationId);
  if (conversation === null) {
    throw new Error(`Couldn't find conversation: ${conversationId}`);
  }
  if (conversation.typing) {
    throw new Error(`Player ${playerId} is already typing`);
  }
  conversation.typing = {
    playerId,
    started: now,
  };
  return null;
}

async function handleWriteMessage(
  game: GameState,
  _now: number,
  { playerId, conversationId, message, doneWriting }: InputArgs<'writeMessage'>,
): Promise<InputReturnValue<'writeMessage'>> {
  const conversation = game.conversations.find((d) => d._id === conversationId);
  if (conversation === null) {
    throw new Error(`Couldn't find conversation: ${conversationId}`);
  }
  const membership = game.conversationMembers.find(
    (d) => d.conversationId === conversationId && d.playerId === playerId,
  );
  if (!membership) {
    throw new Error(`${playerId} not in conversation ${conversationId}`);
  }
  if (membership.status !== 'participating') {
    throw new Error(`${playerId} not participating in conversation ${conversationId}`);
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
    text: message,
  });
  return messageId;
}

async function handleFinishWriting(
  game: GameState,
  _now: number,
  { playerId, messageId }: InputArgs<'finishWriting'>,
): Promise<InputReturnValue<'finishWriting'>> {
  const message = game.messages.lookup(messageId);
  if (message.author !== playerId) {
    throw new Error("Can't finish another user's message");
  }
  if (message.doneWriting) {
    throw new Error('Message has already been closed');
  }
  message.doneWriting = true;
  return null;
}

async function handleLeaveConversation(
  game: GameState,
  now: number,
  { playerId, conversationId }: InputArgs<'leaveConversation'>,
): Promise<InputReturnValue<'leaveConversation'>> {
  const conversation = game.conversations.find((d) => d._id === conversationId);
  if (conversation === null) {
    throw new Error(`Couldn't find conversation: ${conversationId}`);
  }
  const memberships = game.conversationMembers.filter((d) => d.conversationId === conversationId);
  const membership = memberships.find((m) => m.playerId === playerId);
  if (!membership) {
    throw new Error(`Couldn't find membership for ${conversationId}:${playerId}`);
  }

  // Stop the conversation.
  delete conversation.typing;
  conversation.finished = now;

  // Clear all memberships for the conversation.
  for (const membership of memberships) {
    game.conversationMembers.delete(membership._id);
  }

  return null;
}
