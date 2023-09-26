import { useApp } from '@pixi/react';
import { Player, SelectElement } from './Player.tsx';
import { useRef } from 'react';
import { PixiStaticMap } from './PixiStaticMap.tsx';
import PixiViewport from './PixiViewport.tsx';
import { map } from '../../convex/data/world.ts';
import { Viewport } from 'pixi-viewport';
import { Id } from '../../convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api.js';
import { useSendInput } from '../hooks/sendInput.ts';
import { toastOnError } from '../toasts.ts';

export const Game = (props: {
  worldId: Id<'worlds'>;
  width: number;
  height: number;
  setSelectedElement: SelectElement;
}) => {
  // PIXI setup.
  const pixiApp = useApp();
  const viewportRef = useRef<Viewport | undefined>();

  const humanPlayerId = useQuery(api.world.userStatus, { worldId: props.worldId }) ?? null;
  const players = useQuery(api.world.activePlayers, { worldId: props.worldId }) ?? [];
  const moveTo = useSendInput(props.worldId, 'moveTo');

  // Interaction for clicking on the world to navigate.
  const dragStart = useRef<{ screenX: number; screenY: number } | null>(null);
  const onMapPointerDown = (e: any) => {
    // https://pixijs.download/dev/docs/PIXI.FederatedPointerEvent.html
    dragStart.current = { screenX: e.screenX, screenY: e.screenY };
  };
  const onMapPointerUp = async (e: any) => {
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
    if (!humanPlayerId) {
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
    console.log(`Moving to ${JSON.stringify(gameSpaceTiles)}`);
    await toastOnError(moveTo({ playerId: humanPlayerId, destination: gameSpaceTiles }));
  };

  // if (!state) {
  //   return;
  // }

  // let players: InterpolatedPlayer[] = Object.values(state.players);
  // // Order the players by their y coordinates.
  // players.sort((a, b) => a.position.y - b.position.y);

  // const human = players.find((p) => p.player._id == humanPlayerId);
  // let humanDestination = human && human.player.pathfinding?.destination;

  // let inflightDestination;
  // for (const input of state.inflightInputs) {
  //   if (input.name !== 'moveTo' || input.args.playerId !== humanPlayerId) {
  //     continue;
  //   }
  //   inflightDestination = input.args.destination;
  // }
  // humanDestination = inflightDestination ?? humanDestination;

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
      {players.map((p) => (
        <Player key={p._id} player={p} onClick={props.setSelectedElement} />
      ))}
      {/* {DEBUG_POSITIONS && humanDestination && <DestinationMarker destination={humanDestination} />}
       */}
    </PixiViewport>
  );
};
export default Game;
