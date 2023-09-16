import clsx from 'clsx';
import { useMutation, useQuery } from 'convex/react';
import { KeyboardEvent, useRef, useState } from 'react';
import { api } from '../../convex/_generated/api';
import { Doc } from '../../convex/_generated/dataModel';

export function MessageInput(props: { conversation: Doc<'conversations'> }) {
  const userPlayerId = useQuery(api.queryGameState.userPlayerId);
  const userPlayer = useQuery(
    api.queryGameState.playerMetadata,
    userPlayerId ? { playerId: userPlayerId } : 'skip',
  );
  const inputRef = useRef<HTMLParagraphElement>(null);
  const addPlayerInput = useMutation(api.engine.addPlayerInput);

  const [inflight, setInflight] = useState(0);

  if (!userPlayerId || !userPlayer) {
    return;
  }
  const onKeyDown = async (e: KeyboardEvent) => {
    console.log(e);
    e.stopPropagation();
    // Send the current message.
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!userPlayerId || !inputRef.current) {
        return;
      }
      await addPlayerInput({
        playerId: userPlayerId,
        input: {
          kind: 'writeMessage',
          conversationId: props.conversation._id,
          text: inputRef.current.innerText,
          doneWriting: true,
        },
      });
      inputRef.current.innerText = '';
      return;
    }
    // Try to set a typing indicator.
    else {
      if (props.conversation.typing || !userPlayerId || inflight > 0) {
        return;
      }
      try {
        setInflight((n) => n + 1);
        await addPlayerInput({
          playerId: userPlayerId,
          input: {
            kind: 'startTyping',
            conversationId: props.conversation._id,
          },
        });
      } finally {
        setInflight((n) => n - 1);
      }
    }
  };
  return (
    <div className="leading-tight mb-6">
      <div className="flex gap-4">
        <span className="uppercase flex-grow">{userPlayer.name}</span>
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
