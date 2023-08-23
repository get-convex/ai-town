'use client';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { useCallback, useEffect } from 'react';
import { data as f1SpritesheetData } from '../../convex/characterdata/spritesheets/f1';

export default function PlayButton() {
  const player = useQuery(api.players.getActivePlayer);
  const navigate = useMutation(api.players.navigateActivePlayer);
  const createCharacter = useMutation(api.players.createCharacter);
  const createPlayer = useMutation(api.players.createPlayer);
  const isPlaying = !!player;

  const startPlaying = async () => {
    if (player) {
      return;
    }
    const characterId = await createCharacter({name: "me", spritesheetData: f1SpritesheetData});
    await createPlayer({
      forUser: true,
      name: "Me",
      characterId,
      pose: {
        position: {x: 1, y: 1},
        orientation: 1,
      },
    });
  };

  const handleKeyPress = useCallback(
    (event: { key: string }) => {
      if (isPlaying) {
        if (event.key === 'w') {
          void navigate({direction: 'w'});
        }
      }
    },
    [isPlaying],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress);

    return () => {
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [handleKeyPress]);

  return (
    <>
      <a
        className="button text-white shadow-solid text-2xl pointer-events-auto"
        onClick={() => {
          void startPlaying();
        }}
        title="Join the town (press a/s/d/f to walk)"
      >
        <div className="inline-block bg-clay-700">
          <span>
            <div className="inline-flex items-center gap-4">
              <img className="w-6 h-6" src="/ai-town/assets/volume.svg" />
              {isPlaying ? 'Leave' : 'Join'}
            </div>
          </span>
        </div>
      </a>
    </>
  );
}
