import clsx from 'clsx';
import { useMutation, useQuery } from 'convex/react';
import { useRef } from 'react';
import { api } from '../../convex/_generated/api';
import { Doc } from '../../convex/_generated/dataModel';

export function MessageInput(props: { conversation: Doc<'conversations'> }) {
  const userPlayerId = useQuery(api.queryGameState.userPlayerId);
  const inputRef = useRef<HTMLParagraphElement>(null);
  const addPlayerInput = useMutation(api.engine.addPlayerInput);
  if (!userPlayerId) {
    return;
  }
  const sendInput = async () => {
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
  };
  return (
    <div className="leading-tight mb-6">
      <div className="flex gap-4">
        <span className="uppercase flex-grow">Sujay</span>
      </div>
      <div className={clsx('bubble', 'bubble-mine')}>
        <p
          className="bg-white -mx-3 -my-1"
          ref={inputRef}
          contentEditable
          style={{ outline: 'none' }}
          tabIndex={0}
          placeholder="Type here"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              void sendInput();
            }
          }}
        />
      </div>
    </div>
  );
}
