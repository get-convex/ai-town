import { useState } from 'react';
import Game from './Game.tsx';

import { useElementSize } from 'usehooks-ts';
import { Id } from '../../convex/_generated/dataModel';

export default function GameWrapper() {
  const [_selectedPlayer, setSelectedPlayer] = useState<Id<'players'>>();
  const [gameWrapperRef, { width, height }] = useElementSize();
  return (
    <div className="mx-auto w-full max-w mt-7 grid grid-rows-[240px_1fr] lg:grid-rows-[1fr] lg:grid-cols-[1fr_auto] lg:h-[700px] max-w-[1400px] min-h-[480px] game-frame">
      {/* Game area */}
      <div className="relative overflow-hidden bg-brown-900" ref={gameWrapperRef}>
        <div className="absolute inset-0">
          <Game width={width} height={height} setSelectedPlayer={setSelectedPlayer} />
        </div>
      </div>
    </div>
  );
}
