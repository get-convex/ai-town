import { useApp, useTick } from '@pixi/react';
import { Player, SelectElement } from './Player.tsx';
import { useRef, useState } from 'react';
import { ServerState, GameState, DEBUG_POSITIONS, InterpolatedPlayer } from '../serverState.ts';
import { PixiStaticMap } from './PixiStaticMap.tsx';
import PixiViewport from './PixiViewport.tsx';
import { map } from '../../convex/data/world.ts';
import { Viewport } from 'pixi-viewport';
import DestinationMarker from './DestinationMarker.tsx';
import { Id } from '../../convex/_generated/dataModel';
import { toastOnError } from '../toasts.ts';

export const Game = (props: {
  serverState: ServerState;
  humanPlayerId: Id<'players'> | null;
  width: number;
  height: number;
  setSelectedElement: SelectElement;
}) => {
  // PIXI setup.
  const pixiApp = useApp();
  const viewportRef = useRef<Viewport | undefined>();

  // Server state management and updates.
  const [state, setState] = useState<GameState | undefined>();
  useTick(() => {
    const currentState = props.serverState.currentState(Date.now());
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
    if (!props.humanPlayerId) {
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
    await toastOnError(
      props.serverState.sendInput('moveTo', {
        playerId: props.humanPlayerId,
        destination: gameSpaceTiles,
      }),
    );
  };

  if (!state) {
    return;
  }

  let players: InterpolatedPlayer[] = Object.values(state.players);
  // Order the players by their y coordinates.
  players.sort((a, b) => a.position.y - b.position.y);

  const human = players.find((p) => p.player._id == props.humanPlayerId);
  let humanDestination = human && human.player.pathfinding?.destination;

  let inflightDestination;
  for (const input of state.inflightInputs) {
    if (input.name !== 'moveTo' || input.args.playerId !== props.humanPlayerId) {
      continue;
    }
    inflightDestination = input.args.destination;
  }
  humanDestination = inflightDestination ?? humanDestination;

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
      {players &&
        players.map((interpolated) => (
          <Player
            key={interpolated.player._id}
            interpolated={interpolated}
            onClick={props.setSelectedElement}
          />
        ))}
      {DEBUG_POSITIONS && humanDestination && <DestinationMarker destination={humanDestination} />}
    </PixiViewport>
  );
};
export default Game;
