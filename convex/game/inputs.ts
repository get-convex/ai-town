import { Infer, v } from 'convex/values';
import { point } from '../util/types';

export const inputs = {
  // Join, creating a new player...
  join: {
    args: v.object({
      name: v.string(),
      character: v.string(),
      description: v.string(),
      tokenIdentifier: v.optional(v.string()),
    }),
    returnValue: v.id('game2_players'),
  },
  // ...or leave, disabling the specified player.
  leave: {
    args: v.object({
      playerId: v.id('game2_players'),
    }),
    returnValue: v.null(),
  },

  // Move the player to a specified location.
  moveTo: {
    args: v.object({
      playerId: v.id('game2_players'),
      destination: v.union(point, v.null()),
    }),
    returnValue: v.null(),
  },
  // Start a conversation, inviting the specified player.
  // Conversations can only have two participants for now,
  // so we don't have a separate "invite" input.
  startConversation: {
    args: v.object({
      playerId: v.id('game2_players'),
      invitee: v.id('game2_players'),
    }),
    returnValue: v.id('game2_conversations'),
  },
  // Accept an invite to a conversation, which puts the
  // player in the "walkingOver" state until they're close
  // enough to the other participant.
  acceptInvite: {
    args: v.object({
      playerId: v.id('game2_players'),
      conversationId: v.id('game2_conversations'),
    }),
    returnValue: v.null(),
  },
  // Reject the invite. Eventually we might add a message
  // that explains why!
  rejectInvite: {
    args: v.object({
      playerId: v.id('game2_players'),
      conversationId: v.id('game2_conversations'),
    }),
    returnValue: v.null(),
  },
  // Leave a conversation.
  leaveConversation: {
    args: v.object({
      playerId: v.id('game2_players'),
      conversationId: v.id('game2_conversations'),
    }),
    returnValue: v.null(),
  },
};
export type Inputs = typeof inputs;
export type InputArgs<Name extends keyof Inputs> = Infer<Inputs[Name]['args']>;
export type InputReturnValue<Name extends keyof Inputs> = Infer<Inputs[Name]['returnValue']>;
