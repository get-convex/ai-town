import { useApp, useTick } from '@pixi/react';
import { useMutation, useQuery } from 'convex/react';
import { Player, SelectPlayer } from './Player.tsx';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { useRef, useState } from 'react';
import { ServerState, InterpolatedPlayer } from '../serverState.ts';
import { PixiStaticMap } from './PixiStaticMap.tsx';
import PixiViewport from './PixiViewport.tsx';
import { map } from '../../convex/schema.ts';
import { Viewport } from 'pixi-viewport';

export const Game = (props: { width: number, height: number, setSelectedPlayer: SelectPlayer }) => {
  // Convex setup.
  const gameState = useQuery(api.gameState.default);
  const humanStatus = useQuery(api.humans.humanStatus);
  const addPlayerInput = useMutation(api.engine.addPlayerInput);

  // PIXI setup.
  const pixiApp = useApp();
  const viewportRef = useRef<Viewport | undefined>();

  // Server state management and updates.
  const [players, setPlayers] = useState<Record<Id<"players">, InterpolatedPlayer>>({});
  const serverState = useRef(new ServerState());
  if (gameState) {
    serverState.current.receive(gameState);
  }
  useTick(() => {
    const currentState = serverState.current.currentState(Date.now());
    if (!currentState) {
      return;
    }
    setPlayers(currentState.players);
  })

  // Interaction for clicking on the world to navigate.
  const dragStart = useRef<{ screenX: number, screenY: number } | null>(null);
  const onMapPointerDown = (e: any) => {
    dragStart.current = { screenX: e.screenX, screenY: e.screenY };
  }
  const onMapPointerUp = (e: any) => {
    if (dragStart.current) {
      const { screenX, screenY } = dragStart.current;
      dragStart.current = null;
      const [dx, dy] = [screenX - e.screenX, screenY - e.screenY];
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 10) {
        console.log(`Skipping navigation on drag event (${dist}px)`);
        return;
      }
    }
    if (!humanStatus) {
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const gameSpacePx = viewport.toWorld(e.screenX, e.screenY);
    const gameSpaceTiles = {
      x: Math.floor(gameSpacePx.x / map.tileDim),
      y: Math.floor(gameSpacePx.y / map.tileDim)
    };
    console.log(`Sending player input`, humanStatus, gameSpaceTiles, e);
    addPlayerInput({ playerId: humanStatus, destination: gameSpaceTiles });
  }

  if (!gameState) {
    return null;
  }
  return (
    <PixiViewport
      app={pixiApp}
      screenWidth={props.width}
      screenHeight={props.height}
      worldWidth={map.tileSetDim}
      worldHeight={map.tileSetDim}
      viewportRef={viewportRef}
    >
      <PixiStaticMap onpointerup={onMapPointerUp} onpointerdown={onMapPointerDown} />
      {Object.entries(players).map(([id, { position, orientation, isMoving, player }]) => (
        <Player
          key={id}
          player={player}
          x={position.x}
          y={position.y}
          orientation={orientation}
          isMoving={isMoving}
          onClick={props.setSelectedPlayer}
        />
      ))}
    </PixiViewport>
  );
  return null;
};
export default Game;
