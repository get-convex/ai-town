import { useState } from 'react';
import Game from './Game.tsx';

import { useElementSize } from 'usehooks-ts';
import { Id } from '../../convex/_generated/dataModel';
import { Stage } from '@pixi/react';
import PixiViewport from './PixiViewport.tsx';
import { map } from '../../convex/schema.ts';
import { ConvexProvider, useConvex } from 'convex/react';
import { PixiStaticMap } from './PixiStaticMap.tsx';

export default function GameWrapper() {
  const convex = useConvex();
  const [_selectedPlayer, setSelectedPlayer] = useState<Id<'players'>>();
  const [gameWrapperRef, { width, height }] = useElementSize();
  return (
    <div className="mx-auto w-full max-w mt-7 grid grid-rows-[240px_1fr] lg:grid-rows-[1fr] lg:grid-cols-[1fr_auto] lg:h-[700px] max-w-[1400px] min-h-[480px] game-frame">
      {/* Game area */}
      <div className="relative overflow-hidden bg-brown-900" ref={gameWrapperRef}>
        <div className="absolute inset-0">
          <div className="container">
            <Stage width={width} height={height} options={{ backgroundColor: 0x7ab5ff }}>
            <PixiViewport
              screenWidth={width}
              screenHeight={height}
              worldWidth={map.tileSetDim}
              worldHeight={map.tileSetDim}
            >
              <PixiStaticMap />
              {/* Re-propagate context because contexts are not shared between renderers.
https://github.com/michalochman/react-pixi-fiber/issues/145#issuecomment-531549215 */}
              <ConvexProvider client={convex}>
                <Game setSelectedPlayer={setSelectedPlayer} />
              </ConvexProvider>
            </PixiViewport>
            </Stage>
          </div>
        </div>
      </div>
    </div>
  );
}
