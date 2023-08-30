'use client';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { useCallback, useEffect } from 'react';
import { data as f1SpritesheetData } from '../../convex/characterdata/spritesheets/f1';

export default function InteractButton() {
  const player = useQuery(api.players.getActivePlayer);
  const navigate = useMutation(api.players.navigateActivePlayer);
  const createCharacter = useMutation(api.players.createCharacter);
  const createPlayer = useMutation(api.players.createPlayer);
  const isPlaying = !!player;

  const startPlaying = async () => {
    if (isPlaying) {
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
    (event: KeyboardEvent) => {
      if (isPlaying) {
        let key = event.key;
        if (key === 'ArrowLeft') {
          key = 'a';
        } else if (key === 'ArrowRight') {
          key = 'd';
        } else if (key === 'ArrowUp') {
          key = 'w';
        } else if (key === 'ArrowDown') {
          key = 's';
        } else if (key === 'Enter') {
          key = 'q';
        }
        if (
          key === 'w' || key === 'a' || key === 's'
          || key === 'd' || key === 'r' || key == 'q') {
          event.preventDefault();
          void navigate({direction: key});
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
              <img className="w-6 h-6" src="/assets/volume.svg" />
              {isPlaying ? 'Interacting' : 'Interact'}
            </div>
          </span>
        </div>
      </a>
    </>
  );
}
