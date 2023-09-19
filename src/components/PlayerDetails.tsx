import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { useEffect, useState } from 'react';
import closeImg from '../../assets/close.svg';
import { SelectPlayer } from './Player';
import { SignedIn } from '@clerk/clerk-react';
import { Messages } from './Messages';
import { ServerState } from '../serverState';
import { toastOnError } from '../toasts';

export default function PlayerDetails(props: {
  serverState: ServerState;
  humanPlayerId: Id<'players'> | null;
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

  const haveInvite = sameConversation && userPlayer.member?.status === 'invited';
  const waitingForAccept = sameConversation && player.member?.status === 'invited';
  const waitingForNearby =
    sameConversation &&
    player.member?.status === 'walkingOver' &&
    userPlayer.member?.status === 'walkingOver';
  const inConversationWithMe =
    sameConversation &&
    player.member?.status === 'participating' &&
    userPlayer.member?.status === 'participating';

  const startConversation = async () => {
    if (!props.humanPlayerId || !props.playerId) {
      console.log(props);
      return;
    }
    console.log(`Starting conversation`);
    await toastOnError(
      props.serverState.sendInput('startConversation', {
        playerId: props.humanPlayerId,
        invitee: props.playerId,
      }),
    );
  };
  const acceptInvite = async () => {
    if (!props.humanPlayerId || !props.playerId) {
      return;
    }
    if (!userPlayer || !userPlayer.conversation?._id) {
      return;
    }
    await toastOnError(
      props.serverState.sendInput('acceptInvite', {
        playerId: props.humanPlayerId,
        conversationId: userPlayer.conversation?._id,
      }),
    );
  };
  const rejectInvite = async () => {
    if (!props.humanPlayerId || !userPlayer || !userPlayer.conversation?._id) {
      return;
    }
    await toastOnError(
      props.serverState.sendInput('rejectInvite', {
        playerId: props.humanPlayerId,
        conversationId: userPlayer.conversation?._id,
      }),
    );
  };
  const leaveConversation = async () => {
    if (
      !props.humanPlayerId ||
      !userPlayerId ||
      !inConversationWithMe ||
      !userPlayer.conversation?._id
    ) {
      return;
    }
    await toastOnError(
      props.serverState.sendInput('leaveConversation', {
        playerId: props.humanPlayerId,
        conversationId: userPlayer.conversation?._id,
      }),
    );
  };
  // const pendingSuffix = (inputName: string) =>
  //   [...inflightInputs.values()].find((i) => i.name === inputName) ? ' opacity-50' : '';
  const pendingSuffix = (s: string) => '';
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
              pendingSuffix('startConversation')
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
              pendingSuffix('leaveConversation')
            }
            onClick={leaveConversation}
          >
            <div className="h-full bg-clay-700 text-center">
              <span>Leave conversation</span>
            </div>
          </a>
        )}
        {haveInvite && (
          <>
            <a
              className={
                'mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto' +
                pendingSuffix('acceptInvite')
              }
              onClick={acceptInvite}
            >
              <div className="h-full bg-clay-700 text-center">
                <span>Accept</span>
              </div>
            </a>
            <a
              className={
                'mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto' +
                pendingSuffix('rejectInvite')
              }
              onClick={rejectInvite}
            >
              <div className="h-full bg-clay-700 text-center">
                <span>Reject</span>
              </div>
            </a>
          </>
        )}
        <div className="desc my-6">
          <p className="leading-tight -m-4 bg-brown-700 text-lg">
            {!isMe && player.description}
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
            serverState={props.serverState}
            inConversationWithMe={inConversationWithMe ?? false}
            conversation={player.conversation}
          />
        )}
      </SignedIn>
    </>
  );
}
