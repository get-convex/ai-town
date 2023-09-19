import clsx from 'clsx';
import { useMutation, useQuery } from 'convex/react';
import { KeyboardEvent, useRef, useState } from 'react';
import { api } from '../../convex/_generated/api';
import { Doc } from '../../convex/_generated/dataModel';
import { ServerState } from '../serverState';
import { toastOnError } from '../toasts';

export function MessageInput(props: {
  serverState: ServerState;
  conversation: Doc<'conversations'>;
}) {
  const humanPlayerId = useQuery(api.humans.humanStatus);
  const humanPlayer = useQuery(
    api.queryGameState.playerMetadata,
    humanPlayerId ? { playerId: humanPlayerId } : 'skip',
  );
  const inputRef = useRef<HTMLParagraphElement>(null);
  const [inflight, setInflight] = useState(0);

  if (!humanPlayerId || !humanPlayer) {
    return;
  }
  const onKeyDown = async (e: KeyboardEvent) => {
    e.stopPropagation();
    // Send the current message.
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!humanPlayerId || !inputRef.current) {
        return;
      }
      await toastOnError(
        props.serverState.sendInput('writeMessage', {
          playerId: humanPlayerId,
          conversationId: props.conversation._id,
          message: inputRef.current.innerText,
          doneWriting: true,
        }),
      );
      inputRef.current.innerText = '';
      return;
    }
    // Try to set a typing indicator.
    else {
      if (props.conversation.typing || !humanPlayerId || inflight > 0) {
        return;
      }
      setInflight((i) => i + 1);
      try {
        // Don't show a toast on error.
        await props.serverState.sendInput('startTyping', {
          playerId: humanPlayerId,
          conversationId: props.conversation._id,
        });
      } finally {
        setInflight((i) => i - 1);
      }
    }
  };
  return (
    <div className="leading-tight mb-6">
      <div className="flex gap-4">
        <span className="uppercase flex-grow">{humanPlayer.name}</span>
      </div>
      <div className={clsx('bubble', 'bubble-mine')}>
        <p
          className="bg-white -mx-3 -my-1"
          ref={inputRef}
          contentEditable
          style={{ outline: 'none' }}
          tabIndex={0}
          placeholder="Type here"
          onKeyDown={(e) => onKeyDown(e)}
        />
      </div>
    </div>
  );
}
