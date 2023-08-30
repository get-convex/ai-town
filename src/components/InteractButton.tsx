import { useQuery, useMutation, useConvexAuth } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { useCallback, useEffect } from 'react';
import { data as f1SpritesheetData } from '../../convex/characterdata/spritesheets/f1';
import { useUser } from '@clerk/clerk-react';

export default function InteractButton() {
  const player = useQuery(api.players.getActivePlayer);
  const navigate = useMutation(api.players.navigateActivePlayer);
  const createCharacter = useMutation(api.players.createCharacter);
  const createPlayer = useMutation(api.players.createPlayer);
  const { isAuthenticated } = useConvexAuth();
  const { user } = useUser();
  const isPlaying = !!player;

  const startPlaying = async () => {
    if (!isAuthenticated || isPlaying || !user) {
      return;
    }
    const characterId = await createCharacter({name: "user", spritesheetData: f1SpritesheetData});
    await createPlayer({
      forUser: true,
      name: user.firstName ?? "Me",
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

  if (!isAuthenticated) {
    return null;
  }

  return (
    <>
      <a
        className="button text-white shadow-solid text-2xl pointer-events-auto"
        onClick={() => {
          void startPlaying();
        }}
        title="Join the town (press w/a/s/d to walk)"
      >
        <div className="inline-block h-full bg-clay-700 cursor-pointer">
          <span>
            <div className="inline-flex items-center gap-4">
              <img className="w-[48px] h-[30px] max-w-[54px]" src="/assets/interact.svg" />
              {isPlaying ? 'Interacting' : 'Interact'}
            </div>
          </span>
        </div>
      </a>
    </>
  );
}
