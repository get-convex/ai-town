import { Doc, Id } from '../../convex/_generated/dataModel';
import { Graphics } from '@pixi/react';
import { Graphics as PixiGraphics } from 'pixi.js';
import { Character } from './Character.tsx';
import { orientationDegrees } from '../../convex/util/geometry.ts';
import { characters } from '../../data/characters.ts';
import { toast } from 'react-toastify';
import { useHistoricalValue } from '../hooks/useHistoricalValue.ts';
import { Path } from '../../convex/util/types.ts';
import { useCallback } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { locationFields } from '../../convex/game/locations.ts';

export type SelectElement = (element?: { kind: 'player'; id: Id<'players'> }) => void;

const logged = new Set<string>();

export const Player = ({
  player,
  onClick,
  historicalTime,
}: {
  player: Doc<'players'> & { location: Doc<'locations'> };
  onClick: SelectElement;
  historicalTime?: number;
}) => {
  const world = useQuery(api.world.defaultWorld);
  const character = characters.find((c) => c.name === player.character);
  const location = useHistoricalValue<'locations'>(locationFields, historicalTime, player.location);
  if (!character) {
    if (!logged.has(player.character)) {
      logged.add(player.character);
      toast.error(`Unknown character ${player.character}`);
    }
    return;
  }
  if (!world) {
    return;
  }
  if (!location) {
    return;
  }
  const path = player.pathfinding?.state.kind == 'moving' && player.pathfinding.state.path;
  const tileDim = world.map.tileDim;
  return (
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
  );
};

export function PlayerPath({ player }: { player: Doc<'players'> }) {
  const path = player.pathfinding?.state.kind == 'moving' && player.pathfinding.state.path;
  if (!path) {
    return null;
  }
  return <DebugPath id={player._id} path={path} />;
}

function DebugPath({ id, path }: { id: string; path: Path }) {
  const world = useQuery(api.world.defaultWorld);
  if (!world) {
    return null;
  }
  const tileDim = world.map.tileDim;
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
