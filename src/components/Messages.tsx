import clsx from 'clsx';
import { Doc } from '../../convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { MessageInput } from './MessageInput';
import { ServerState } from '@/serverState';

export function Messages(props: {
  conversation: Doc<'conversations'> & { typingName?: string };
  inConversationWithMe: boolean;
}) {
  const conversation = props.conversation;
  const humanPlayerId = useQuery(api.humans.humanStatus);
  const messages = useQuery(api.queryGameState.listConversation, {
    conversationId: props.conversation._id,
  });
  if (humanPlayerId === undefined || messages === undefined) {
    return null;
  }
  if (messages.length === 0 && !props.inConversationWithMe) {
    return null;
  }
  return (
    <div className="chats">
      <div className="bg-brown-200 text-black p-2">
        {messages.length > 0 &&
          messages.map((m) => (
            <div key={m._id} className="leading-tight mb-6">
              <div className="flex gap-4">
                <span className="uppercase flex-grow">{m.authorName}</span>
                <time dateTime={m._creationTime.toString()}>
                  {new Date(m._creationTime).toLocaleString()}
                </time>
              </div>
              <div className={clsx('bubble', m.author === humanPlayerId && 'bubble-mine')}>
                <p className="bg-white -mx-3 -my-1">
                  {m.textFragments.map((f) => f.text).join('')}
                </p>
              </div>
            </div>
          ))}
        {conversation.typing && conversation.typing.playerId !== humanPlayerId && (
          <div key="typing" className="leading-tight mb-6">
            <div className="flex gap-4">
              <span className="uppercase flex-grow">{conversation.typingName}</span>
              <time dateTime={conversation.typing.started.toString()}>
                {new Date(conversation.typing.started).toLocaleString()}
              </time>
            </div>
            <div className={clsx('bubble')}>
              <p className="bg-white -mx-3 -my-1">
                <i>typing...</i>
              </p>
            </div>
          </div>
        )}
        {props.inConversationWithMe && !conversation.finished && (
          <MessageInput serverState={props.serverState} conversation={conversation} />
        )}
      </div>
    </div>
  );
}
