import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import closeImg from '../../assets/close.svg';
import { SelectPlayer } from './Player';
import { SignedIn } from '@clerk/clerk-react';
import Button from './Button';
import { FunctionReturnType } from 'convex/server';
import { Messages } from './Messages';

// function Messages({
//   conversationId,
//   currentPlayerId,
// }: {
//   conversationId: Id<'conversations'>;
//   currentPlayerId: Id<'players'>;
// }) {
//   const messages =
//     useQuery(api.chat.listMessages, {
//       conversationId,
//     }) || [];
//   const controlMessage = (message: Message, idx: number) => {
//     if (message.type === 'started' && idx > 0) {
//       // Conversation already started.
//       return null;
//     }
//     return <p className="text-brown-700 text-center">
//       {message.fromName} {message.type === 'left' ? 'left' : 'started'}
//       {' the conversation.'}
//     </p>;
//   };

//   return (
//     <>
//       {[...messages]
//         .reverse()
//         // We can filter out the "started" and "left" conversations with this:
//         // .filter((m) => m.data.type === 'responded')
//         .map((message, idx) => (
//           <div className="leading-tight mb-6" key={message.ts}>
//             {message.type === 'responded' ? (
//               <>
//                 <div className="flex gap-4">
//                   <span className="uppercase flex-grow">{message.fromName}</span>
//                   <time dateTime={message.ts.toString()}>
//                     {new Date(message.ts).toLocaleString()}
//                   </time>
//                 </div>
//                 <div className={clsx('bubble', message.from === currentPlayerId && 'bubble-mine')}>
//                   <p className="bg-white -mx-3 -my-1">{message.content}</p>
//                 </div>
//               </>
//             ) : (
//               controlMessage(message, idx)
//             )}
//           </div>
//         ))}
//         <MessageInput currentPlayerId={currentPlayerId} conversationId={conversationId} />
//     </>
//   );
// }

// function MessageInput({
//   conversationId,
//   currentPlayerId,
// }: {
//   conversationId: Id<'conversations'>;
//   currentPlayerId: Id<'players'>;
// }) {
//   const activePlayer = useQuery(api.players.getActivePlayer);
//   const waitingToTalk = useQuery(api.players.waitingToTalk, {conversationId});
//   const userTalkModerated = useAction(api.journal.userTalkModerated);
//   const userTalk = useMutation(api.journal.userTalk);
//   const inputRef = useRef<HTMLParagraphElement>(null);
//   const [inputFlagged, setInputFlagged] = useState(false);

//   const enterKeyPress = async () => {
//     const {contentId, flagged} = await userTalkModerated({content: inputRef.current!.innerText});
//     if (flagged) {
//       setInputFlagged(true);
//       setTimeout(() => setInputFlagged(false), 3000);
//     } else {
//       await userTalk({contentId});
//     }
//     inputRef.current!.innerText = '';
//   };

//   if (!activePlayer || !waitingToTalk) {
//     return null;
//   }
//   return <div className="leading-tight mb-6">
//     <div className="flex gap-4">
//       <span className="uppercase flex-grow">{activePlayer.name}</span>
//       <span>{inputFlagged ? "be nice" : null}</span>
//     </div>
//     <div className={clsx('bubble', currentPlayerId === activePlayer.id && 'bubble-mine')}>
//       <p
//         className="bg-white -mx-3 -my-1"
//         ref={inputRef}
//         contentEditable
//         style={{outline: 'none'}}
//         tabIndex={0}
//         placeholder='Type here'
//         onKeyDown={(e) => {
//           e.stopPropagation();
//           if (e.key === 'Enter') {
//             e.preventDefault();
//             void enterKeyPress();
//           }
//         }}
//       >
//       </p>
//     </div>
//   </div>;
// }

export default function PlayerDetails(props: {
  playerId?: Id<'players'>;
  setSelectedPlayer: SelectPlayer;
}) {
  const userPlayerId = useQuery(api.queryGameState.userPlayerId);
  const player = useQuery(
    api.queryGameState.playerMetadata,
    props.playerId ? { playerId: props.playerId } : 'skip',
  );
  const userPlayer = useQuery(
    api.queryGameState.playerMetadata,
    userPlayerId ? { playerId: userPlayerId } : 'skip',
  );
  const addPlayerInput = useMutation(api.engine.addPlayerInput);
  const [pendingActions, setPendingActions] = useState(0);

  if (!props.playerId) {
    return (
      <div className="h-full text-xl flex text-center items-center p-4">
        Click on an agent on the map to see chat history.
      </div>
    );
  }
  const loading =
    (props.playerId && player === undefined) || (userPlayer && userPlayer === undefined);
  if (loading) {
    return null;
  }
  if (!player) {
    return null;
  }
  const isMe = userPlayerId && props.playerId === userPlayerId;
  const canInvite =
    !isMe && player.conversation === null && userPlayer && userPlayer.conversation === null;
  const sameConversation =
    !isMe &&
    userPlayer &&
    userPlayer.conversation &&
    player.conversation &&
    userPlayer.conversation._id === player.conversation._id;

  const waitingForAccept = sameConversation && player.member?.status === 'invited';
  const waitingForNearby = sameConversation && player.member?.status === 'walkingOver';
  const inConversationWithMe =
    sameConversation &&
    player.member?.status === 'participating' &&
    userPlayer.member?.status === 'participating';

  const startConversation = async () => {
    if (!userPlayerId || !props.playerId) {
      return;
    }
    setPendingActions((n) => n + 1);
    try {
      await addPlayerInput({
        playerId: userPlayerId,
        input: {
          kind: 'startConversation',
          invite: props.playerId,
        },
      });
    } finally {
      // Jank: ideally want to wait for mutation to be reflected in state.
      setTimeout(() => setPendingActions((n) => n - 1), 500);
    }
  };
  const leaveConversation = async () => {
    if (!userPlayerId || !inConversationWithMe || !userPlayer.conversation?._id) {
      return;
    }
    setPendingActions((n) => n + 1);
    try {
      await addPlayerInput({
        playerId: userPlayerId,
        input: {
          kind: 'leaveConversation',
          conversationId: userPlayer.conversation?._id,
        },
      });
    } finally {
      // Jank: ideally want to wait for mutation to be reflected in state.
      setTimeout(() => setPendingActions((n) => n - 1), 500);
    }
  };
  const pendingCls = pendingActions > 0 ? ' opacity-50' : '';
  return (
    <>
      <div className="flex gap-4">
        <div className="box flex-grow">
          <h2 className="bg-brown-700 p-2 font-display text-4xl tracking-wider shadow-solid text-center">
            {player.name}
          </h2>
        </div>
        <a
          className="button text-white shadow-solid text-2xl cursor-pointer pointer-events-auto"
          onClick={() => {
            props.setSelectedPlayer(undefined);
          }}
        >
          <h2 className="h-full bg-clay-700">
            <img className="w-5 h-5" src={closeImg} />
          </h2>
        </a>
      </div>
      <SignedIn>
        {canInvite && (
          <a
            className={
              'mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto' +
              pendingCls
            }
            onClick={startConversation}
          >
            <div className="h-full bg-clay-700 text-center">
              <span>Start conversation</span>
            </div>
          </a>
        )}
        {waitingForAccept && (
          <a className="mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto opacity-50">
            <div className="h-full bg-clay-700 text-center">
              <span>Waiting for accept...</span>
            </div>
          </a>
        )}
        {waitingForNearby && (
          <a className="mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto opacity-50">
            <div className="h-full bg-clay-700 text-center">
              <span>Walking over...</span>
            </div>
          </a>
        )}
        {inConversationWithMe && (
          <a
            className={
              'mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto' +
              pendingCls
            }
            onClick={leaveConversation}
          >
            <div className="h-full bg-clay-700 text-center">
              <span>Leave conversation</span>
            </div>
          </a>
        )}
        <div className="desc my-6">
          <p className="leading-tight -m-4 bg-brown-700 text-lg">
            {!isMe && 'Am I human, or am I dancer?'}
            {isMe && <i>This is you!</i>}
            {!isMe && inConversationWithMe && (
              <>
                <br />
                <br />(<i>Conversing with you!</i>)
              </>
            )}
          </p>
        </div>
        {!isMe && player.conversation && (
          <Messages
            inConversationWithMe={inConversationWithMe ?? false}
            conversation={player.conversation}
          />
        )}
      </SignedIn>
    </>
  );
}
