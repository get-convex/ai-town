import Button from './Button';
import interactImg from '../../assets/interact.svg';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';

export default function InteractButton() {
  const { isAuthenticated } = useConvexAuth();
  const humanStatus = useQuery(api.humans.humanStatus);
  const join = useMutation(api.humans.join);
  const leave = useMutation(api.humans.leave);
  const isPlaying = !!humanStatus;

  const joinOrLeaveGame = () => {
    if (!isAuthenticated || humanStatus === undefined) {
      return;
    }
    if (isPlaying) {
      console.log(`Leaving game for player ${humanStatus}`);
      void leave();
    } else {
      console.log(`Joining game`);
      void join();
    }
  };
  if (!isAuthenticated || humanStatus === undefined) {
    return null;
  }
  return (
    <Button imgUrl={interactImg} onClick={joinOrLeaveGame}>
      {isPlaying ? 'Leave' : 'Interact'}
    </Button>
  );
}
