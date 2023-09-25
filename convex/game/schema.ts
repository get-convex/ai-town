import { engineTables } from '../engine/schema';
import { players } from './players';
import { locations } from './location';
import { conversations } from './conversations';
import { conversationMembers } from './conversationMembers';

export const gameTables = {
  game2_players: players,
  game2_locations: locations,
  game2_conversations: conversations,
  game2_conversationMembers: conversationMembers,
  ...engineTables,
};
