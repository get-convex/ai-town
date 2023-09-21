import { assertNever } from '../util/assertNever';
import { GameState } from './state';
import { manhattanDistance, pointsEqual } from '../util/geometry';
import { Infer } from 'convex/values';
import { InputArgs, InputReturnValue, args } from '../schema/input';
import { world } from '../data/world';
import { blocked } from './movement';
import { Doc } from '../_generated/dataModel';
import { characters } from '../data/characters';

export async function handleInput(game: GameState, now: number, input: Infer<typeof args>) {
  switch (input.kind) {
    case 'join':
      return await handleJoin(game, now, input.args);
    case 'leave':
      return await handleLeave(game, now, input.args);
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
    case 'addBlock':
      return await addBlock(game, now, input.args);
    case 'pickUpBlock':
      return await pickUpBlock(game, now, input.args);
    case 'setDownBlock':
      return await setDownBlock(game, now, input.args);
    default:
      assertNever(input);
  }
}

async function handleJoin(
  game: GameState,
  _now: number,
  { name, character, description, tokenIdentifier }: InputArgs<'join'>,
): Promise<InputReturnValue<'join'>> {
  const allPlayers = game.enabledPlayers();
  const allBlocks = game.freeBlocks();
  let position;
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = {
      x: Math.floor(Math.random() * world.width),
      y: Math.floor(Math.random() * world.height),
    };
    if (blocked(allPlayers, allBlocks, candidate)) {
      continue;
    }
    position = candidate;
    break;
  }
  if (!position) {
    throw new Error(`Failed to find a free position!`);
  }
  const facingOptions = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];
  const facing = facingOptions[Math.floor(Math.random() * facingOptions.length)];
  if (!characters.find((c) => c.name === character)) {
    throw new Error(`Invalid character: ${character}`);
  }
  const playerId = await game.players.insert({
    name,
    description,
    enabled: true,
    human: tokenIdentifier,
    character,
    position,
    facing,
  });
  return playerId;
}

async function handleLeave(
  game: GameState,
  now: number,
  { playerId }: InputArgs<'leave'>,
): Promise<InputReturnValue<'leave'>> {
  const player = game.players.lookup(playerId);
  if (!player.enabled) {
    return null;
  }
  // Stop our conversation if we're leaving the game.
  const membership = game.activeConversationMemberships().find((m) => m.playerId === playerId);
  if (membership) {
    const conversation = game.conversations.find((d) => d._id === membership.conversationId);
    if (conversation === null) {
      throw new Error(`Couldn't find conversation: ${membership.conversationId}`);
    }
    stopConversation(game, now, conversation);
  }
  player.enabled = false;
  return null;
}

async function handleMoveTo(
  game: GameState,
  now: number,
  { playerId, destination }: InputArgs<'moveTo'>,
): Promise<InputReturnValue<'moveTo'>> {
  const player = game.players.lookup(playerId);
  if (!player.enabled) {
    throw new Error(`Player ${playerId} is not enabled`);
  }
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
  const player = game.players.lookup(playerId);
  if (!player.enabled) {
    throw new Error(`Player ${playerId} is not enabled`);
  }
  const inviteePlayer = game.players.lookup(invitee);
  if (!inviteePlayer.enabled) {
    throw new Error(`Invitee ${invitee} is not enabled`);
  }
  if (game.activeConversationMemberships().find((m) => m.playerId == playerId)) {
    throw new Error(`Player ${playerId} is already in a conversation`);
  }
  if (game.activeConversationMemberships().find((m) => m.playerId === invitee)) {
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
  const player = game.players.lookup(playerId);
  if (!player.enabled) {
    throw new Error(`Player ${playerId} is not enabled`);
  }
  const membership = game.activeConversationMemberships().find((m) => m.playerId === playerId);
  if (!membership) {
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
  const player = game.players.lookup(playerId);
  if (!player.enabled) {
    throw new Error(`Player ${playerId} is not enabled`);
  }
  const conversation = game.conversations.find((d) => d._id === conversationId);
  if (conversation === null) {
    throw new Error(`Couldn't find conversation: ${conversationId}`);
  }
  const membership = game
    .activeConversationMemberships()
    .find((m) => m.conversationId == conversationId && m.playerId === playerId);
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
  stopConversation(game, now, conversation);
  return null;
}

async function handleStartTyping(
  game: GameState,
  now: number,
  { playerId, conversationId }: InputArgs<'startTyping'>,
): Promise<InputReturnValue<'startTyping'>> {
  const player = game.players.lookup(playerId);
  if (!player.enabled) {
    throw new Error(`Player ${playerId} is not enabled`);
  }
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
  const player = game.players.lookup(playerId);
  if (!player.enabled) {
    throw new Error(`Player ${playerId} is not enabled`);
  }
  const conversation = game.conversations.find((d) => d._id === conversationId);
  if (conversation === null) {
    throw new Error(`Couldn't find conversation: ${conversationId}`);
  }
  const membership = game
    .activeConversationMemberships()
    .find((d) => d.conversationId === conversationId && d.playerId === playerId);
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
  const player = game.players.lookup(playerId);
  if (!player.enabled) {
    throw new Error(`Player ${playerId} is not enabled`);
  }
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
  const player = game.players.lookup(playerId);
  if (!player.enabled) {
    throw new Error(`Player ${playerId} is not enabled`);
  }
  const conversation = game.conversations.find((d) => d._id === conversationId);
  if (conversation === null) {
    throw new Error(`Couldn't find conversation: ${conversationId}`);
  }
  const membership = game
    .activeConversationMemberships()
    .find((m) => m.conversationId === conversationId && m.playerId === playerId);
  if (!membership) {
    throw new Error(`Couldn't find membership for ${conversationId}:${playerId}`);
  }
  stopConversation(game, now, conversation);
  return null;
}

async function addBlock(game: GameState, now: number, _args: InputArgs<'addBlock'>) {
  const allPlayers = game.enabledPlayers();
  const allBlocks = game.freeBlocks();
  let position;
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = {
      x: Math.floor(Math.random() * world.width),
      y: Math.floor(Math.random() * world.height),
    };
    if (blocked(allPlayers, allBlocks, candidate)) {
      continue;
    }
    position = candidate;
    break;
  }
  if (!position) {
    throw new Error(`Failed to find a free position!`);
  }
  const allEmojis = ['🌹', '💐', '🌸', '🌻', '🍔', '🍕', '🍣', '🔪', '🐍'];
  const blockId = await game.blocks.insert({
    emoji: allEmojis[Math.floor(Math.random() * allEmojis.length)],
    metadata: {
      state: 'placed',
      position,
    },
  });
  return null;
}

async function pickUpBlock(
  game: GameState,
  _now: number,
  { playerId, blockId }: InputArgs<'pickUpBlock'>,
) {
  const block = game.blocks.lookup(blockId);
  const player = game.players.lookup(playerId);
  if (!player.enabled) {
    throw new Error(`Player ${playerId} is not enabled`);
  }
  if (block.metadata.state === 'carried') {
    throw new Error(`Block ${block._id} cannot be picked up`);
  }
  const existingCarriedBlocks = game.blocks.filter(
    (b) => b.metadata.state === 'carried' && b.metadata.player === playerId,
  );
  if (existingCarriedBlocks.length !== 0) {
    throw new Error(`Player ${playerId} is already carrying a block`);
  }
  const existingBlocksForPlayer = game.blocks.filter((b) => {
    return b.metadata.state === 'waitingForNearby' && b.metadata.player === playerId;
  });
  existingBlocksForPlayer.forEach((b) => {
    b.metadata = {
      state: 'placed',
      // @ts-expect-error -- ugh I want either a forEach or to filter with a typeguard
      position: b.metadata.position,
    };
  });
  if (manhattanDistance(player.position, block.metadata.position) <= 1) {
    block.metadata = {
      state: 'carried',
      player: player._id,
    };
  } else {
    block.metadata = {
      state: 'waitingForNearby',
      player: player._id,
      position: block.metadata.position,
    };
  }
  return null;
}

async function setDownBlock(
  game: GameState,
  _now: number,
  { playerId, blockId }: InputArgs<'setDownBlock'>,
) {
  const block = game.blocks.lookup(blockId);
  const player = game.players.lookup(playerId);
  const allPlayers = game.enabledPlayers();
  const allBlocks = game.freeBlocks();
  if (!player.enabled) {
    throw new Error(`Player ${playerId} is not enabled`);
  }
  if (block.metadata.state !== 'carried') {
    throw new Error(`Block ${block._id} cannot be set down`);
  }
  if (block.metadata.player !== playerId) {
    throw new Error(`Block ${blockId} is not carried by player ${playerId}`);
  }
  const roundedPosition = {
    x: Math.round(player.position.x),
    y: Math.round(player.position.y),
  };
  const candidatePositions = [
    { x: roundedPosition.x + 1, y: roundedPosition.y },
    { x: roundedPosition.x - 1, y: roundedPosition.y },
    { x: roundedPosition.x, y: roundedPosition.y + 1 },
    { x: roundedPosition.x, y: roundedPosition.y - 1 },
  ];
  for (const position of candidatePositions) {
    if (!blocked(allPlayers, allBlocks, position)) {
      block.metadata = {
        state: 'placed',
        position,
      };
      return null;
    }
  }
  throw new Error(`Position to place block is occupied!`);
}

function stopConversation(game: GameState, now: number, conversation: Doc<'conversations'>) {
  // Stop the conversation.
  delete conversation.typing;
  conversation.finished = now;
  // Clear all memberships for the conversation.
  const memberships = game.conversationMembers.filter((d) => d.conversationId === conversation._id);
  for (const membership of memberships) {
    if (membership.status !== 'left') {
      membership.status = 'left';
    }
  }
}
