import { useEffect, useState } from 'react';
import Game from './Game.tsx';

import { useElementSize } from 'usehooks-ts';
import { Id } from '../../convex/_generated/dataModel';
import { Stage } from '@pixi/react';
import { ConvexProvider, useConvex, useMutation, useQuery } from 'convex/react';
import PlayerDetails from './PlayerDetails.tsx';
import { api } from '../../convex/_generated/api';

const SHOW_DEBUG_PLOT = true;

export default function GameWrapper() {
  const convex = useConvex();
  const [selectedElement, setSelectedElement] = useState<{ kind: 'player'; id: Id<'players'> }>();
  const [gameWrapperRef, { width, height }] = useElementSize();

  const world = useQuery(api.world.defaultWorld);
  const worldId = world?._id;

  // Send a periodic heartbeat to our world to keep it alive.
  const heartbeat = useMutation(api.world.heartbeatWorld);
  useEffect(() => {
    if (!world) {
      return;
    }
    const id = setInterval(() => {
      heartbeat({ worldId: world._id });
    }, 60 * 1000);
    return () => clearInterval(id);
  }, [world && world._id, heartbeat]);

  if (!worldId) {
    return null;
  }
  return (
    <>
      <div className="mx-auto w-full max-w mt-7 grid grid-rows-[240px_1fr] lg:grid-rows-[1fr] lg:grid-cols-[1fr_auto] lg:h-[700px] max-w-[1400px] min-h-[480px] game-frame">
        {/* Game area */}
        <div className="relative overflow-hidden bg-brown-900" ref={gameWrapperRef}>
          <div className="absolute inset-0">
            <div className="container">
              <Stage width={width} height={height} options={{ backgroundColor: 0x7ab5ff }}>
                {/* Re-propagate context because contexts are not shared between renderers.
https://github.com/michalochman/react-pixi-fiber/issues/145#issuecomment-531549215 */}
                <ConvexProvider client={convex}>
                  <Game
                    worldId={worldId}
                    width={width}
                    height={height}
                    setSelectedElement={setSelectedElement}
                  />
                </ConvexProvider>
              </Stage>
            </div>
          </div>
        </div>
        {/* Right column area */}
        <div className="flex flex-col overflow-y-auto shrink-0 px-4 py-6 sm:px-6 lg:w-96 xl:pr-6 bg-brown-800 text-brown-100">
          <PlayerDetails playerId={selectedElement?.id} setSelectedElement={setSelectedElement} />
        </div>
      </div>
    </>
  );
}
