import { useMutation } from 'convex/react';
import { Id } from '../../convex/_generated/dataModel';
import { useEffect } from 'react';
import { api } from '../../convex/_generated/api';

const HEARTBEAT_INTERVAL = 60 * 1000;

export function useWorldHeartbeat(worldId?: Id<'worlds'>) {
  // Send a periodic heartbeat to our world to keep it alive.
  const heartbeat = useMutation(api.world.heartbeatWorld);
  useEffect(() => {
    if (!worldId) {
      return;
    }
    const id = setInterval(() => {
      heartbeat({ worldId });
    }, HEARTBEAT_INTERVAL);
    return () => clearInterval(id);
  }, [worldId, heartbeat]);
}
