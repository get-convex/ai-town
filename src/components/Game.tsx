import { Stage } from '@pixi/react';
import { PixiStaticMap } from './PixiStaticMap.tsx';
import { ConvexProvider, useConvex, useQuery } from 'convex/react';
import { Player, SelectPlayer } from './Player.tsx';
import PixiViewport from "./PixiViewport.tsx";
import { map } from '../../convex/schema.ts';
import { api } from '../../convex/_generated/api';

export const Game = ({
  setSelectedPlayer,
  width,
  height,
}: {
  setSelectedPlayer: SelectPlayer;
  width: number;
  height: number;
}) => {
  const convex = useConvex();
  const gameState = useQuery(api.gameState.default);
  if (!gameState) {
    return null;
  }
  return (
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
            {gameState.players.map((player) => (
              <Player
                key={player._id}
                player={player}
                serverTimestamp={gameState.serverTimestamp}
                onClick={setSelectedPlayer}
              />
            ))}
          </ConvexProvider>
        </PixiViewport>
      </Stage>
    </div>
  );
};
export default Game;