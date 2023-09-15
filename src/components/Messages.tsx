import clsx from 'clsx';
import { Doc } from '../../convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { MessageInput } from './MessageInput';

export function Messages(props: {
  conversation: Doc<'conversations'>;
  inConversationWithMe: boolean;
}) {
  const userPlayerId = useQuery(api.queryGameState.userPlayerId);
  const messages = useQuery(api.queryGameState.listConversation, {
    conversationId: props.conversation._id,
  });
  if (userPlayerId === undefined || messages === undefined) {
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
              <div className={clsx('bubble', m.author === userPlayerId && 'bubble-mine')}>
                <p className="bg-white -mx-3 -my-1">
                  {m.textFragments.map((f) => f.text).join('')}
                </p>
              </div>
            </div>
          ))}
        {props.inConversationWithMe && <MessageInput conversation={props.conversation} />}
      </div>
    </div>
  );
}
