import { useEffect, useRef, useState } from 'react';
import Game from './Game.tsx';

import { useElementSize } from 'usehooks-ts';
import { Id } from '../../convex/_generated/dataModel';
import { Stage } from '@pixi/react';
import { ConvexProvider, useConvex, useQuery } from 'convex/react';
import PlayerDetails from './PlayerDetails.tsx';
import { api } from '../../convex/_generated/api';
import { GameState, ServerState } from '../serverState.ts';
import { DebugPlot } from './DebugPlot.tsx';
import BlockDetails from './BlockDetails.tsx';

const SHOW_DEBUG_PLOT = true;

export default function GameWrapper() {
  const convex = useConvex();
  const [selectedElement, setSelectedElement] = useState<
    { kind: 'player'; id: Id<'players'> } | { kind: 'block'; id: Id<'blocks'> }
  >();
  const [gameWrapperRef, { width, height }] = useElementSize();
  const humanPlayerId = useQuery(api.humans.humanStatus) ?? null;

  const [serverState, setServerState] = useState<ServerState>();
  useEffect(() => {
    const serverState = new ServerState(convex);
    setServerState(serverState);
    return () => serverState.dispose();
  }, [convex]);
  if (!serverState) {
    return null;
  }
  return (
    // NB: We don't re-propgate the ConvexClient context underneath
    // the <Stage/>, so we can't use the Convex client within `Game`.
    <>
      {SHOW_DEBUG_PLOT && <DebugPlot state={serverState} width={300} height={150} />}
      <div className="mx-auto w-full max-w mt-7 grid grid-rows-[240px_1fr] lg:grid-rows-[1fr] lg:grid-cols-[1fr_auto] lg:h-[700px] max-w-[1400px] min-h-[480px] game-frame">
        {/* Game area */}
        <div className="relative overflow-hidden bg-brown-900" ref={gameWrapperRef}>
          <div className="absolute inset-0">
            <div className="container">
              <Stage width={width} height={height} options={{ backgroundColor: 0x7ab5ff }}>
                <Game
                  serverState={serverState}
                  humanPlayerId={humanPlayerId}
                  width={width}
                  height={height}
                  setSelectedElement={setSelectedElement}
                />
              </Stage>
            </div>
          </div>
        </div>
        {/* Right column area */}
        <div className="flex flex-col overflow-y-auto shrink-0 px-4 py-6 sm:px-6 lg:w-96 xl:pr-6 bg-brown-800 text-brown-100">
          {selectedElement?.kind === 'block' ? (
            <BlockDetails
              serverState={serverState}
              blockId={selectedElement.id}
              setSelectedElement={setSelectedElement}
            />
          ) : (
            <PlayerDetails
              serverState={serverState}
              humanPlayerId={humanPlayerId}
              playerId={selectedElement?.id}
              setSelectedElement={setSelectedElement}
            />
          )}
        </div>
      </div>
    </>
  );
}
