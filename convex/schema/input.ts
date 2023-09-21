import { Infer, v } from 'convex/values';
import { point } from '../util/types';

export const inputHandlers = {
  // Join, creating a new player...
  join: {
    args: v.object({
      name: v.string(),
      character: v.string(),
      description: v.string(),
      tokenIdentifier: v.optional(v.string()),
    }),
    returnValue: v.id('players'),
  },
  // ...or leave, disabling the specified player.
  leave: {
    args: v.object({
      playerId: v.id('players'),
    }),
    returnValue: v.null(),
  },

  // Move the player to a specified location.
  moveTo: {
    args: v.object({
      playerId: v.id('players'),
      destination: v.union(point, v.null()),
    }),
    returnValue: v.null(),
  },
  // Start a conversation, inviting the specified player.
  // Conversations can only have two participants for now,
  // so we don't have a separate "invite" input.
  startConversation: {
    args: v.object({
      playerId: v.id('players'),
      invitee: v.id('players'),
    }),
    returnValue: v.id('conversations'),
  },
  // Accept an invite to a conversation, which puts the
  // player in the "walkingOver" state until they're close
  // enough to the other participant.
  acceptInvite: {
    args: v.object({
      playerId: v.id('players'),
      conversationId: v.id('conversations'),
    }),
    returnValue: v.null(),
  },
  // Reject the invite. Eventually we might add a message
  // that explains why!
  rejectInvite: {
    args: v.object({
      playerId: v.id('players'),
      conversationId: v.id('conversations'),
    }),
    returnValue: v.null(),
  },
  // Start typing, indicating that the player wants to talk
  // and other players should wait for them to say something.
  // This "lock" on the conversation will timeout after
  // a few moments.
  startTyping: {
    args: v.object({
      playerId: v.id('players'),
      conversationId: v.id('conversations'),
    }),
    returnValue: v.null(),
  },
  // Write a message to a conversation, potentially signalling
  // that we'll be appending to it out-of-band.
  writeMessage: {
    args: v.object({
      playerId: v.id('players'),
      conversationId: v.id('conversations'),
      message: v.string(),
      doneWriting: v.boolean(),
    }),
    returnValue: v.id('messages'),
  },
  // For streaming writers that set `doneWriting: false` in `writeMessage` above,
  // tell the game engine that they're done writing.
  finishWriting: {
    args: v.object({
      playerId: v.id('players'),
      messageId: v.id('messages'),
    }),
    returnValue: v.null(),
  },
  // Leave a conversation.
  leaveConversation: {
    args: v.object({
      playerId: v.id('players'),
      conversationId: v.id('conversations'),
    }),
    returnValue: v.null(),
  },
};

// TODO: Ideally everything below this point would be handled by codegen.
export type InputHandlers = typeof inputHandlers;
export type InputArgs<K extends keyof InputHandlers> = Infer<InputHandlers[K]['args']>;
export type InputReturnValue<K extends keyof InputHandlers> = Infer<
  InputHandlers[K]['returnValue']
>;
export const args = v.union(
  v.object({
    kind: v.literal('join'),
    args: inputHandlers['join'].args,
  }),
  v.object({
    kind: v.literal('leave'),
    args: inputHandlers['leave'].args,
  }),
  v.object({
    kind: v.literal('moveTo'),
    args: inputHandlers['moveTo'].args,
  }),
  v.object({
    kind: v.literal('startConversation'),
    args: inputHandlers['startConversation'].args,
  }),
  v.object({
    kind: v.literal('acceptInvite'),
    args: inputHandlers['acceptInvite'].args,
  }),
  v.object({
    kind: v.literal('rejectInvite'),
    args: inputHandlers['rejectInvite'].args,
  }),
  v.object({
    kind: v.literal('startTyping'),
    args: inputHandlers['startTyping'].args,
  }),
  v.object({
    kind: v.literal('writeMessage'),
    args: inputHandlers['writeMessage'].args,
  }),
  v.object({
    kind: v.literal('finishWriting'),
    args: inputHandlers['finishWriting'].args,
  }),
  v.object({
    kind: v.literal('leaveConversation'),
    args: inputHandlers['leaveConversation'].args,
  }),
);
export const returnValue = v.union(
  v.object({
    kind: v.literal('join'),
    returnValue: v.union(
      v.object({ ok: inputHandlers['join'].returnValue }),
      v.object({ err: v.string() }),
    ),
  }),
  v.object({
    kind: v.literal('leave'),
    returnValue: v.union(
      v.object({ ok: inputHandlers['leave'].returnValue }),
      v.object({ err: v.string() }),
    ),
  }),
  v.object({
    kind: v.literal('moveTo'),
    returnValue: v.union(
      v.object({ ok: inputHandlers['moveTo'].returnValue }),
      v.object({ err: v.string() }),
    ),
  }),
  v.object({
    kind: v.literal('startConversation'),
    returnValue: v.union(
      v.object({ ok: inputHandlers['startConversation'].returnValue }),
      v.object({ err: v.string() }),
    ),
  }),
  v.object({
    kind: v.literal('acceptInvite'),
    returnValue: v.union(
      v.object({ ok: inputHandlers['acceptInvite'].returnValue }),
      v.object({ err: v.string() }),
    ),
  }),
  v.object({
    kind: v.literal('rejectInvite'),
    returnValue: v.union(
      v.object({ ok: inputHandlers['rejectInvite'].returnValue }),
      v.object({ err: v.string() }),
    ),
  }),
  v.object({
    kind: v.literal('startTyping'),
    returnValue: v.union(
      v.object({ ok: inputHandlers['startTyping'].returnValue }),
      v.object({ err: v.string() }),
    ),
  }),
  v.object({
    kind: v.literal('writeMessage'),
    returnValue: v.union(
      v.object({ ok: inputHandlers['writeMessage'].returnValue }),
      v.object({ err: v.string() }),
    ),
  }),
  v.object({
    kind: v.literal('finishWriting'),
    returnValue: v.union(
      v.object({ ok: inputHandlers['finishWriting'].returnValue }),
      v.object({ err: v.string() }),
    ),
  }),
  v.object({
    kind: v.literal('leaveConversation'),
    returnValue: v.union(
      v.object({ ok: inputHandlers['leaveConversation'].returnValue }),
      v.object({ err: v.string() }),
    ),
  }),
);
