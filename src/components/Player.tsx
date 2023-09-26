import { Doc, Id } from '../../convex/_generated/dataModel';
import { Character } from './Character.tsx';
import { map } from '../../convex/data/world.ts';
import { Graphics } from '@pixi/react';
import { DEBUG_POSITIONS, InterpolatedPlayer } from '../serverState.ts';
import { useCallback } from 'react';
import { Graphics as PixiGraphics } from 'pixi.js';
import { orientationDegrees } from '../../convex/util/geometry.ts';
import { Path } from '../../convex/util/types.ts';
import { characters } from '../../convex/data/characters.ts';
import { toast } from 'react-toastify';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { useContinuousQuery } from '@/hooks/useContinuousQuery.ts';

export type SelectElement = (element?: { kind: 'player'; id: Id<'players'> }) => void;

const logged = new Set<string>();

export const Player = ({ player, onClick }: { player: Doc<'players'>; onClick: SelectElement }) => {
  const tileDim = map.tileDim;
  const character = characters.find((c) => c.name === player.character);
  if (!character) {
    if (!logged.has(player.character)) {
      logged.add(player.character);
      toast.error(`Unknown character ${player.character}`);
    }
    return;
  }
  const location = useContinuousQuery<'locations'>(api.world.playerLocation, {
    playerId: player._id,
  });

  // const path = player.pathfinding?.state.kind == 'moving' && player.pathfinding.state.path;
  if (!location) {
    return;
  }
  return (
    <>
      {/* {DEBUG_POSITIONS && positionBuffers && (
        <DebugBuffer id={player._id} buffers={positionBuffers} />
      )}
      {DEBUG_POSITIONS && path && <DebugPath id={player._id} path={path} />} */}
      <Character
        x={location.position.x * tileDim + tileDim / 2}
        y={location.position.y * tileDim + tileDim / 2}
        orientation={orientationDegrees(location.facing)}
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

function DebugBuffer({ id, buffers }: { id: string; buffers: PositionBuffer[] }) {
  const tileDim = map.tileDim;
  const draw = useCallback(
    (g: PixiGraphics) => {
      g.clear();
      let first = true;
      for (const buffer of buffers) {
        for (let i = 0; i < buffer.t.length; i++) {
          const x = buffer.x[i] * tileDim + tileDim / 2;
          const y = buffer.y[i] * tileDim + tileDim / 2;
          const facing = orientationDegrees({ dx: buffer.dx[i], dy: buffer.dy[i] });
          if (first) {
            g.moveTo(x, y);
            g.lineStyle(2, debugColor(id), 1);
            first = false;
          } else {
            g.lineTo(x, y);
          }
        }
      }
    },
    [buffers],
  );
  return <Graphics draw={draw} />;
}

function debugColor(_id: string) {
  return { h: 0, s: 50, l: 90 };
}
