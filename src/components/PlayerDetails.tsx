import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import clsx from 'clsx';
import { useRef, useState } from 'react';
import { Message } from '../../convex/schema';

function Messages({
  conversationId,
  currentPlayerId,
}: {
  conversationId: Id<'conversations'>;
  currentPlayerId: Id<'players'>;
}) {
  const messages =
    useQuery(api.chat.listMessages, {
      conversationId,
    }) || [];
  let conversationStarted = false;
  const controlMessage = (message: Message) => {
    if (message.type === 'started') {
      if (conversationStarted) {
        // Conversation already started.
        return null;
      }
      conversationStarted = true;
    }
    return <p className="text-brown-700 text-center">
      {message.fromName} {message.type === 'left' ? 'left' : 'started'}
      {' the conversation.'}
    </p>;
  };

  return (
    <>
      {[...messages]
        .reverse()
        // We can filter out the "started" and "left" conversations with this:
        // .filter((m) => m.data.type === 'responded')
        .map((message) => (
          <div className="leading-tight mb-6" key={message.ts}>
            {message.type === 'responded' ? (
              <>
                <div className="flex gap-4">
                  <span className="uppercase flex-grow">{message.fromName}</span>
                  <time dateTime={message.ts.toString()}>
                    {new Date(message.ts).toLocaleString()}
                  </time>
                </div>
                <div className={clsx('bubble', message.from === currentPlayerId && 'bubble-mine')}>
                  <p className="bg-white -mx-3 -my-1">{message.content}</p>
                </div>
              </>
            ) : (
              controlMessage(message)
            )}
          </div>
        ))}
        <MessageInput currentPlayerId={currentPlayerId} conversationId={conversationId} />
    </>
  );
}

function MessageInput({
  conversationId,
  currentPlayerId,
}: {
  conversationId: Id<'conversations'>;
  currentPlayerId: Id<'players'>;
}) {
  const activePlayer = useQuery(api.players.getActivePlayer);
  const waitingToTalk = useQuery(api.players.waitingToTalk, {conversationId});
  const userTalkModerated = useAction(api.journal.userTalkModerated);
  const userTalk = useMutation(api.journal.userTalk);
  const inputRef = useRef<HTMLParagraphElement>(null);
  const [inputFlagged, setInputFlagged] = useState(false);

  const enterKeyPress = async () => {
    const {contentId, flagged} = await userTalkModerated({content: inputRef.current!.innerText});
    if (flagged) {
      setInputFlagged(true);
      setTimeout(() => setInputFlagged(false), 3000);
    } else {
      await userTalk({contentId});
    }
    inputRef.current!.innerText = '';
  };

  if (!activePlayer || !waitingToTalk) {
    return null;
  }
  return <div className="leading-tight mb-6">
    <div className="flex gap-4">
      <span className="uppercase flex-grow">{activePlayer.name}</span>
      <span>{inputFlagged ? "be nice" : null}</span>
    </div>
    <div className={clsx('bubble', currentPlayerId === activePlayer.id && 'bubble-mine')}>
      <p
        className="bg-white -mx-3 -my-1"
        ref={inputRef}
        contentEditable
        style={{outline: 'none'}}
        tabIndex={0}
        placeholder='Type here'
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            void enterKeyPress();
          }
        }}
      >
      </p>
    </div>
  </div>;
}

export default function PlayerDetails({ playerId }: { playerId: Id<'players'> }) {
  const playerState = useQuery(api.players.playerState, { playerId });

  return (
    playerState && (
      <>
        <div className="box">
          <h2 className="bg-brown-700 p-2 font-display text-4xl tracking-wider shadow-solid text-center">
            {playerState.name}
          </h2>
        </div>

        <div className="desc my-6">
          <p className="leading-tight -m-4 bg-brown-700 text-lg">{playerState.identity}</p>
        </div>

        {playerState.lastChat?.conversationId && (
          <div className="chats">
            <div className="bg-brown-200 text-black p-2">
              <Messages
                conversationId={playerState.lastChat?.conversationId}
                currentPlayerId={playerState.id}
              />
            </div>
          </div>
        )}
      </>
    )
  );
}
