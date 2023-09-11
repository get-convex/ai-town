import { Doc, Id } from '../../convex/_generated/dataModel';
import { Character } from './Character.tsx';
import { characters, map } from '../../convex/schema.ts';
import { useTick } from '@pixi/react';
import { useRef, useState } from 'react';
import { orientationDegrees, pathPosition } from '../../convex/geometry.ts';

const SpeechDurationMs = 2000;
const SpokeRecentlyMs = 5_000;

export type SelectPlayer = (playerId?: Id<'players'>) => void;

export const Player = ({
  player,
  serverTimestamp,
  onClick,
}: {
  player: Doc<"players">;
  serverTimestamp: number | null,
  onClick: SelectPlayer;
}) => {
  const tileDim = map.tileDim;
  const character = characters[player.character];

  const now = Date.now();
  serverTimestamp = serverTimestamp ?? now;
  const lastStateUpdate = useRef({
    serverTimestamp,
    clientTimestamp: now,
    player,
  });
  if (lastStateUpdate.current.serverTimestamp !== serverTimestamp) {
    const serverDelta = serverTimestamp - lastStateUpdate.current.serverTimestamp;
    const clientDelta = now - lastStateUpdate.current.clientTimestamp;
    let clientTimestamp = now;
    if (clientDelta > serverDelta) {
      clientTimestamp = now - (clientDelta - serverDelta);
    }
    lastStateUpdate.current = {
      serverTimestamp,
      clientTimestamp,
      player,
    };
  }

  const [x, setX] = useState(player.position.x);
  const [y, setY] = useState(player.position.y);
  const [orientation, setOrientation] = useState(player.orientation);

  useTick(() => {
    const now = Date.now();
    if (player.path) {
      const dt = now - lastStateUpdate.current.clientTimestamp;
      const serverTimestamp = lastStateUpdate.current.serverTimestamp + dt;
      const serverPosition = pathPosition(player.path, serverTimestamp);
      if (serverPosition !== null) {
        const { position: { x, y }, vector } = serverPosition;
        setX(x);
        setY(y);
        setOrientation(orientationDegrees(vector));
      }
    } else {
      setX(player.position.x)
      setY(player.position.y);
      setOrientation(player.orientation);
    }
  })
  return (
    <Character
      x={x * tileDim + tileDim / 2}
      y={y * tileDim + tileDim / 2}
      orientation={orientation}
      isMoving={!!player.path}
      isThinking={false}
      isSpeaking={false}
      textureUrl={character.textureUrl}
      spritesheetData={character.spritesheetData}
      speed={character.speed}
      onClick={() => {
        onClick(player._id);
      }}
    />
  );
};
