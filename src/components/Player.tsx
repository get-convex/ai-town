import { Doc, Id } from '../../convex/_generated/dataModel';
import { Character } from './Character.tsx';
import { characters, map } from '../../convex/schema.ts';
import { useTick } from '@pixi/react';
import { useRef, useState } from 'react';
import { orientationDegrees, pathPosition } from '../../convex/geometry.ts';

const SpeechDurationMs = 2000;
const SpokeRecentlyMs = 5_000;

export type SelectPlayer = (playerId?: Id<'players'>) => void;

export const Player = (props: {
  player: Doc<"players">;
  x: number,
  y: number,
  orientation: number,
  onClick: SelectPlayer;
}) => {
  const tileDim = map.tileDim;
  const character = characters[props.player.character];
  return (
    <Character
      x={props.x * tileDim + tileDim / 2}
      y={props.y * tileDim + tileDim / 2}
      orientation={props.orientation}
      isMoving={props.player.pathfinding !== undefined}
      isThinking={false}
      isSpeaking={false}
      textureUrl={character.textureUrl}
      spritesheetData={character.spritesheetData}
      speed={character.speed}
      onClick={() => {
        props.onClick(props.player._id);
      }}
    />
  );
};
