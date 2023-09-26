import { Doc, Id } from '../../convex/_generated/dataModel';
import { Graphics } from '@pixi/react';
import { Graphics as PixiGraphics } from 'pixi.js';
import { Character } from './Character.tsx';
import { map } from '../../convex/data/world.ts';
import { orientationDegrees } from '../../convex/util/geometry.ts';
import { characters } from '../../convex/data/characters.ts';
import { toast } from 'react-toastify';
import { api } from '../../convex/_generated/api';
import { useHistoricalQuery } from '../hooks/useHistoricalQuery.ts';
import { Path } from '../../convex/util/types.ts';
import { useCallback } from 'react';

export type SelectElement = (element?: { kind: 'player'; id: Id<'players'> }) => void;

const logged = new Set<string>();

export const Player = ({
  player,
  onClick,
  historicalTime,
}: {
  player: Doc<'players'>;
  onClick: SelectElement;
  historicalTime?: number;
}) => {
  const tileDim = map.tileDim;
  const character = characters.find((c) => c.name === player.character);
  const location = useHistoricalQuery<'locations'>(historicalTime, api.world.playerLocation, {
    playerId: player._id,
  });
  if (!character) {
    if (!logged.has(player.character)) {
      logged.add(player.character);
      toast.error(`Unknown character ${player.character}`);
    }
    return;
  }
  const path = player.pathfinding?.state.kind == 'moving' && player.pathfinding.state.path;
  if (!location) {
    return;
  }
  return (
    <>
      {path && <DebugPath id={player._id} path={path} />}
      <Character
        x={location.x * tileDim + tileDim / 2}
        y={location.y * tileDim + tileDim / 2}
        orientation={orientationDegrees({ dx: location.dx, dy: location.dy })}
        isMoving={location.velocity > 0}
        isThinking={false}
        isSpeaking={false}
        textureUrl={character.textureUrl}
        spritesheetData={character.spritesheetData}
        speed={character.speed}
        onClick={() => {
          onClick({ kind: 'player', id: player._id });
        }}
      />
    </>
  );
};

function DebugPath({ id, path }: { id: string; path: Path }) {
  const tileDim = map.tileDim;
  const draw = useCallback(
    (g: PixiGraphics) => {
      g.clear();
      let first = true;
      for (const { position } of path) {
        const x = position.x * tileDim + tileDim / 2;
        const y = position.y * tileDim + tileDim / 2;
        if (first) {
          g.moveTo(x, y);
          g.lineStyle(2, debugColor(id), 0.5);
          first = false;
        } else {
          g.lineTo(x, y);
        }
      }
    },
    [path],
  );
  return <Graphics draw={draw} />;
}

function debugColor(_id: string) {
  return { h: 0, s: 50, l: 90 };
}
