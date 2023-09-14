import { Infer, Validator, v } from 'convex/values';
import { point } from './types';

export const playerInput = v.union(
  // Move the player to a specified location.
  v.object({
    kind: v.literal('moveTo'),
    destination: v.union(point, v.null()),
  }),
  // Start a conversation, inviting the specified player.
  // Conversations can only have two participants for now,
  // so we don't have a separate "invite" input.
  v.object({
    kind: v.literal('startConversation'),
    invite: v.id('players'),
  }),
  // Accept an invite to a conversation, which puts the
  // player in the "walkingOver" state until they're close
  // enough to the other participant.
  v.object({
    kind: v.literal('acceptInvite'),
    conversationId: v.id('conversations'),
  }),
  // Reject the invite. Eventually we might add a message
  // that explains why!
  v.object({
    kind: v.literal('rejectInvite'),
    conversationId: v.id('conversations'),
  }),
  // Start typing, indicating that the player wants to talk
  // and other players should wait for them to say something.
  // This "lock" on the conversation will timeout after
  // a few moments.
  v.object({
    kind: v.literal('startTyping'),
    conversationId: v.id('conversations'),
  }),
  // Write a message to a conversation, potentially signalling
  // that we'll be appending to it out-of-band.
  v.object({
    kind: v.literal('writeMessage'),
    conversationId: v.id('conversations'),
    text: v.string(),
    doneWriting: v.boolean(),
  }),
  // Leave a conversation.
  v.object({
    kind: v.literal('leaveConversation'),
    conversationId: v.id('conversations'),
  }),
);

export type PlayerInput = Infer<typeof playerInput>;
