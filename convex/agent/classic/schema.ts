import { leaseTables } from './lease';
import { memoryTables } from './memory';
import { defineTable } from 'convex/server';
import { v } from 'convex/values';

const classicAgents = v.object({
  playerId: v.id('players'),
  identity: v.string(),
  plan: v.string(),
});

export const classicAgentTables = {
  classicAgents: defineTable(classicAgents).index('playerId', ['playerId']),
  ...memoryTables,
  ...leaseTables,
};
