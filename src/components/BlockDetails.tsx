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
import { manhattanDistance } from '../../convex/util/geometry';

export default function BlockDetails(props: {
  serverState: ServerState;
  blockId?: Id<'blocks'>;
  setSelectedElement: SelectElement;
}) {
  const humanPlayerId = useQuery(api.humans.humanStatus);
  const humanPlayer = useQuery(
    api.queryGameState.playerMetadata,
    humanPlayerId ? { playerId: humanPlayerId } : 'skip',
  );
  const block = useQuery(
    api.queryGameState.blockMetadata,
    props.blockId === undefined ? 'skip' : { blockId: props.blockId },
  );

  if (!props.blockId) {
    return (
      <div className="h-full text-xl flex text-center items-center p-4">
        Click on an agent on the map to see chat history.
      </div>
    );
  }
  const loading = block === undefined || humanPlayer === undefined;
  if (loading) {
    return null;
  }
  if (block === null) {
    return null;
  }
  if (humanPlayer === null) {
    return (
      <div className="flex gap-4">
        <div className="box flex-grow">
          <h2 className="bg-brown-700 p-2 font-display text-4xl tracking-wider shadow-solid text-center"></h2>
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
    );
  }

  const canPickUp = humanPlayer.block === null && block.metadata.state !== 'carried';
  const canSetDown = humanPlayer.block?._id === block._id;
  const pickUp = async () => {
    if (block.metadata.state === 'carried') {
      throw new Error('Should not be picking up a carried block');
    }

    console.log(`Picking up block`);
    console.log('Sending pickUpBlock input');
    await toastOnError(
      props.serverState.sendInput('pickUpBlock', {
        playerId: humanPlayer._id,
        blockId: block._id,
      }),
    );
    console.log('Sending moveTo input');
    await toastOnError(
      props.serverState.sendInput('moveTo', {
        playerId: humanPlayer._id,
        destination: { x: block.metadata.position.x - 1, y: block.metadata.position.y },
      }),
    );
  };
  const setDownBlock = async () => {
    console.log('Setting down block');
    await toastOnError(
      props.serverState.sendInput('setDownBlock', {
        playerId: humanPlayer._id,
        blockId: block._id,
      }),
    );
  };
  return (
    <>
      <div className="flex gap-4">
        <div className="box flex-grow">
          <h2 className="bg-brown-700 p-2 font-display text-4xl tracking-wider shadow-solid text-center">
            Block
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
        {canPickUp && (
          <a
            className={
              'mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto'
            }
            onClick={pickUp}
          >
            <div className="h-full bg-clay-700 text-center">
              <span>Pick up</span>
            </div>
          </a>
        )}
        {canSetDown && (
          <a
            className={
              'mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto'
            }
            onClick={setDownBlock}
          >
            <div className="h-full bg-clay-700 text-center">
              <span>Set down</span>
            </div>
          </a>
        )}
      </SignedIn>
    </>
  );
}
