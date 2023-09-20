import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { useEffect, useState } from 'react';
import closeImg from '../../assets/close.svg';
import { SelectElement } from './Player';
import { SignedIn } from '@clerk/clerk-react';
import { Messages } from './Messages';
import { ServerState } from '../serverState';
import { toastOnError } from '../toasts';

export default function PlayerDetails(props: {
  serverState: ServerState;
  humanPlayerId: Id<'players'> | null;
  playerId?: Id<'players'>;
  setSelectedElement: SelectElement;
}) {
  const humanPlayerId = useQuery(api.humans.humanStatus);
  const player = useQuery(
    api.queryGameState.playerMetadata,
    props.playerId ? { playerId: props.playerId } : 'skip',
  );
  const humanPlayer = useQuery(
    api.queryGameState.playerMetadata,
    humanPlayerId ? { playerId: humanPlayerId } : 'skip',
  );

  if (!props.playerId) {
    return (
      <div className="h-full text-xl flex text-center items-center p-4">
        Click on an agent on the map to see chat history.
      </div>
    );
  }
  const loading =
    (props.playerId && player === undefined) || (humanPlayer && humanPlayer === undefined);
  if (loading) {
    return null;
  }
  if (!player) {
    return null;
  }
  const isMe = humanPlayerId && props.playerId === humanPlayerId;
  const canInvite =
    !isMe && player.conversation === null && humanPlayer && humanPlayer.conversation === null;
  const sameConversation =
    !isMe &&
    humanPlayer &&
    humanPlayer.conversation &&
    player.conversation &&
    humanPlayer.conversation._id === player.conversation._id;

  const haveInvite = sameConversation && humanPlayer.member?.status === 'invited';
  const waitingForAccept = sameConversation && player.member?.status === 'invited';
  const waitingForNearby =
    sameConversation &&
    player.member?.status === 'walkingOver' &&
    humanPlayer.member?.status === 'walkingOver';
  const inConversationWithMe =
    sameConversation &&
    player.member?.status === 'participating' &&
    humanPlayer.member?.status === 'participating';

  const canSetDownBlock = humanPlayer && humanPlayer.block !== null;
  console.log('#### canSetDownBlock', canSetDownBlock);

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
    if (!humanPlayer || !humanPlayer.conversation?._id) {
      return;
    }
    await toastOnError(
      props.serverState.sendInput('acceptInvite', {
        playerId: props.humanPlayerId,
        conversationId: humanPlayer.conversation?._id,
      }),
    );
  };
  const rejectInvite = async () => {
    if (!props.humanPlayerId || !humanPlayer || !humanPlayer.conversation?._id) {
      return;
    }
    await toastOnError(
      props.serverState.sendInput('rejectInvite', {
        playerId: props.humanPlayerId,
        conversationId: humanPlayer.conversation?._id,
      }),
    );
  };
  const leaveConversation = async () => {
    if (
      !props.humanPlayerId ||
      !humanPlayerId ||
      !inConversationWithMe ||
      !humanPlayer.conversation?._id
    ) {
      return;
    }
    await toastOnError(
      props.serverState.sendInput('leaveConversation', {
        playerId: props.humanPlayerId,
        conversationId: humanPlayer.conversation?._id,
      }),
    );
  };
  const setDownBlock = async () => {
    if (!props.humanPlayerId || !humanPlayerId || !humanPlayer || !humanPlayer.block) {
      return;
    }
    await toastOnError(
      props.serverState.sendInput('setDownBlock', {
        playerId: props.humanPlayerId,
        blockId: humanPlayer.block._id,
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
            props.setSelectedElement(undefined);
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
        {canSetDownBlock && (
          <a
            className={
              'mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto' +
              pendingSuffix('setDownBlock')
            }
            onClick={setDownBlock}
          >
            <div className="h-full bg-clay-700 text-center">
              <span>Set down block</span>
            </div>
          </a>
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
