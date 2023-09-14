import { useApp, useTick } from '@pixi/react';
import { useMutation, useQuery } from 'convex/react';
import { Player, SelectPlayer } from './Player.tsx';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { useRef, useState } from 'react';
import { ServerState, InterpolatedPlayer, GameState } from '../serverState.ts';
import { PixiStaticMap } from './PixiStaticMap.tsx';
import PixiViewport from './PixiViewport.tsx';
import { map } from '../../convex/schema.ts';
import { Viewport } from 'pixi-viewport';

export const Game = (props: { width: number; height: number; setSelectedPlayer: SelectPlayer }) => {
  // Convex setup.
  const latestState = useQuery(api.queryGameState.default);
  const humanStatus = useQuery(api.humans.humanStatus);
  const addPlayerInput = useMutation(api.engine.addPlayerInput);

  // PIXI setup.
  const pixiApp = useApp();
  const viewportRef = useRef<Viewport | undefined>();

  // Server state management and updates.
  const [state, setState] = useState<GameState | undefined>();
  const serverState = useRef(new ServerState());
  if (latestState) {
    serverState.current.receive(latestState);
  }
  useTick(() => {
    const currentState = serverState.current.currentState(Date.now());
    if (!currentState) {
      return;
    }
    setState(currentState);
  });

  // Interaction for clicking on the world to navigate.
  const dragStart = useRef<{ screenX: number; screenY: number } | null>(null);
  const onMapPointerDown = (e: any) => {
    // https://pixijs.download/dev/docs/PIXI.FederatedPointerEvent.html
    dragStart.current = { screenX: e.screenX, screenY: e.screenY };
  };
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
      y: Math.floor(gameSpacePx.y / map.tileDim),
    };
    console.log(`Sending player input`, humanStatus, gameSpaceTiles, e);
    addPlayerInput({ playerId: humanStatus, destination: gameSpaceTiles });
  };

  if (!latestState || !state) {
    return null;
  }
  // Skip over players that aren't in the latest server state.
  const latestPlayers = new Set();
  for (const player of latestState.players) {
    latestPlayers.add(player._id);
  }
  const players = Object.values(state.players).filter((p) => latestPlayers.has(p.player._id));
  // Order the players by their y coordinates.
  players.sort((a, b) => a.position.y - b.position.y);
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
      {players.map(({ position, orientation, isMoving, player }) => (
        <Player
          key={player._id}
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
