import { defineSchema } from 'convex/server';
import { engineTables } from './schema/engine';
import { playersTables } from './schema/players';
import { conversationsTables } from './schema/conversations';
import { classicAgentTables } from './agent/classic/schema';

export default defineSchema({
  ...engineTables,
  ...playersTables,
  ...conversationsTables,
  ...classicAgentTables,
});
