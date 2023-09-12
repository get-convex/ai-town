import { useTick } from '@pixi/react';
import { useQuery } from 'convex/react';
import { Player, SelectPlayer } from './Player.tsx';
import { COLLISION_THRESHOLD, Point } from '../../convex/schema.ts';
import { api } from '../../convex/_generated/api';
import { Doc, Id } from '../../convex/_generated/dataModel';
import { useRef, useState } from 'react';
import { distance, orientationDegrees, pathPosition, pointsEqual } from '../../convex/geometry.ts';

type InterpolatedPlayer = {
  position: Point,
  orientation: number,
  player: Doc<"players">,
};

export const Game = (props: { setSelectedPlayer: SelectPlayer }) => {
  const gameState = useQuery(api.gameState.default);

  const now = Date.now();

  const lastStateUpdate = useRef({
    serverTimestamp: gameState?.serverTimestamp,
    clientTimestamp: now,
    waiting: new Set<Id<"players">>(),
  });
  if (gameState && !lastStateUpdate.current.serverTimestamp) {
    lastStateUpdate.current = {
      serverTimestamp: gameState.serverTimestamp,
      clientTimestamp: now,
      waiting: new Set(),
    };
  }
  if (gameState && lastStateUpdate.current.serverTimestamp !== gameState.serverTimestamp) {
    const serverTimestamp = gameState.serverTimestamp;
    const serverDelta = serverTimestamp - lastStateUpdate.current.serverTimestamp!;
    const clientDelta = now - lastStateUpdate.current.clientTimestamp;
    console.log(`Advancing server state to ${serverTimestamp} (delta: ${serverDelta}, client: ${clientDelta})`);
    let clientTimestamp = now;
    if (clientDelta > serverDelta) {
      clientTimestamp = now - (clientDelta - serverDelta);
    }
    lastStateUpdate.current = {
      serverTimestamp,
      clientTimestamp,
      waiting: new Set(),
    };
  }

  const [players, setPlayers] = useState<Record<Id<"players">, InterpolatedPlayer>>({});
  useTick(() => {
    if (!gameState) {
      return;
    }
    const now = Date.now();
    const dt = now - lastStateUpdate.current.clientTimestamp;
    const serverTimestamp = (lastStateUpdate.current.serverTimestamp ?? now) + dt;

    const newPlayers: Record<Id<"players">, InterpolatedPlayer> = {};
    for (const player of gameState.players) {
      const oldPlayer = players[player._id];
      if (oldPlayer) {
        newPlayers[player._id] = oldPlayer;
      }
    }
    for (const player of gameState.players) {
      // Start with our previous frame's position, falling back to the server if needed.
      const newPlayer = {
        position: newPlayers[player._id]?.position ?? player.position,
        orientation: newPlayers[player._id]?.orientation ?? player.orientation,
        player,
      };
      if (player.path && !lastStateUpdate.current.waiting.has(player._id)) {
        const interpolated = pathPosition(player.path, serverTimestamp);
        let collides = false;
        for (const otherPlayer of gameState.players) {
          if (otherPlayer._id == player._id) {
            continue;
          }
          const otherNewPlayer = newPlayers[otherPlayer._id];
          if (!otherNewPlayer) {
            continue;
          }
          if (distance(otherNewPlayer.position, interpolated.position) < COLLISION_THRESHOLD) {
            console.log(`Interpolation for ${player._id} collides, waiting for server...`);
            collides = true;
            lastStateUpdate.current.waiting.add(player._id);
            break;
          };
        }
        if (!collides) {
          newPlayer.position = interpolated.position;
          newPlayer.orientation = orientationDegrees(interpolated.vector);
        }
      }
      if (!player.path) {
        newPlayer.position = player.position;
        newPlayer.orientation = player.orientation;
      }
      newPlayers[player._id] = newPlayer;
    }
    setPlayers(newPlayers);
  })
  if (!gameState) {
    return null;
  }
  return (
    <>
    {Object.entries(players).map(([id, { position, orientation, player }]) => (
      <Player
        key={id}
        player={player}
        x={position.x}
        y={position.y}
        orientation={orientation}
        onClick={props.setSelectedPlayer}
      />
    ))}
    </>
  );
};
export default Game;
