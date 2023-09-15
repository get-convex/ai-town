import { Id } from '../_generated/dataModel';
import {
  CONVERSATION_DISTANCE,
  PATHFINDING_BACKOFF,
  PATHFINDING_TIMEOUT,
  TYPING_TIMEOUT,
} from '../constants';
import {
  EPSILON,
  distance,
  orientationDegrees,
  pathPosition,
  pointsEqual,
  vector,
} from '../util/geometry';
import { blocked, findRoute } from './movement';
import { GameState } from './state';

export function tick(game: GameState, now: number) {
  for (const playerId of game.players.allIds()) {
    tickPathfinding(game, now, playerId);
  }
  for (const playerId of game.players.allIds()) {
    tickPosition(game, now, playerId);
  }
  for (const conversationId of game.conversations.allIds()) {
    tickConversation(game, now, conversationId);
  }
}

function tickPathfinding(game: GameState, now: number, playerId: Id<'players'>) {
  const player = game.players.lookup(playerId);

  // There's nothing to do if we're not moving.
  const { pathfinding } = player;
  if (!pathfinding) {
    return;
  }

  // Stop pathfinding if we've reached our destination.
  if (
    pathfinding.state.kind === 'moving' &&
    pointsEqual(pathfinding.destination, player.position)
  ) {
    delete player.pathfinding;
  }

  // Stop pathfinding if we've timed out.
  if (pathfinding.started + PATHFINDING_TIMEOUT < now) {
    console.warn(`Timing out pathfinding for ${player._id}`);
    delete player.pathfinding;
  }

  // Transition from "waiting" to "needsPath" if we're past the deadline.
  if (pathfinding.state.kind === 'waiting' && pathfinding.state.until < now) {
    pathfinding.state = { kind: 'needsPath' };
  }

  // Perform pathfinding if needed.
  if (pathfinding.state.kind === 'needsPath') {
    const path = findRoute(game, now, player, pathfinding.destination);
    if (typeof path === 'string') {
      console.log(`Failed to route: ${path}`);
      delete player.pathfinding;
    } else {
      pathfinding.state = { kind: 'moving', path };
    }
  }
}

function tickPosition(game: GameState, now: number, playerId: Id<'players'>) {
  const player = game.players.lookup(playerId);

  // There's nothing to do if we're not moving.
  if (!player.pathfinding || player.pathfinding.state.kind !== 'moving') {
    return;
  }

  // Compute a candidate new position and check if it collides
  // with anything.
  const candidate = pathPosition(player.pathfinding.state.path, now);
  const collisionReason = blocked(game, candidate.position, player);
  if (collisionReason !== null) {
    const backoff = Math.random() * PATHFINDING_BACKOFF;
    console.warn(`Stopping path for ${player._id}, waiting for ${backoff}ms: ${collisionReason}`);
    player.pathfinding.state = {
      kind: 'waiting',
      until: now + backoff,
    };
    return;
  }

  // Compute the new orientation and update the player's position.
  const orientation = orientationDegrees(candidate.vector);
  game.movePlayer(now, playerId, candidate.position, orientation);
}

function tickConversation(game: GameState, now: number, conversationId: Id<'conversations'>) {
  const conversation = game.conversations.lookup(conversationId);
  if (conversation.finished) {
    return;
  }
  const members = game.conversationMembers.filter((m) => m.conversationId === conversationId);
  if (members.length !== 2) {
    return;
  }

  // If the players are both in the "walkingOver" state and they're sufficiently close, transition both
  // of them to "participating" and stop their paths.
  const [member1, member2] = members;
  if (member1.status === 'walkingOver' && member2.status === 'walkingOver') {
    const player1 = game.players.lookup(member1.playerId);
    const player2 = game.players.lookup(member2.playerId);

    const playerDistance = distance(player1.position, player2.position);
    if (playerDistance < CONVERSATION_DISTANCE) {
      console.log(`Starting conversation between ${player1._id} and ${player2._id}`);

      member1.status = 'participating';
      member2.status = 'participating';

      // Stop the two players from moving.
      delete player1.pathfinding;
      delete player2.pathfinding;

      // Orient the players towards each other.
      if (playerDistance > EPSILON) {
        const v = vector(player1.position, player2.position);
        player1.orientation = orientationDegrees(v);
        player2.orientation = (player1.orientation + 180) % 360;
      }
    }
  }

  // Expire the "typing" indicator on the conversation if it's been too long.
  if (conversation.typing && conversation.typing.started + TYPING_TIMEOUT < now) {
    console.log(`Expiring player ${conversation.typing.playerId}'s typing indicator.`);
    delete conversation.typing;
  }
}
