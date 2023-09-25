import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { GameTable } from '../engine/gameTable';
import { DatabaseWriter } from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';
import { Conversations } from './conversations';

// Invariants:
// A player is in at most one conversation.
// At most two players are in one conversation.
// Two players in a conversation are close together if they're both participating.
export const conversationMembers = defineTable({
  conversationId: v.id('game2_conversations'),
  playerId: v.id('game2_players'),
  status: v.union(
    v.object({ kind: v.literal('invited') }),
    v.object({ kind: v.literal('walkingOver') }),
    v.object({ kind: v.literal('participating'), since: v.number() }),
    v.object({ kind: v.literal('left'), when: v.number() }),
  ),
}).index('conversationId', ['conversationId', 'playerId']);

export class ConversationMembers extends GameTable<'game2_conversationMembers'> {
  table = 'game2_conversationMembers' as const;

  static async load(
    db: DatabaseWriter,
    worldId: Id<'worlds'>,
    conversations: Conversations,
  ): Promise<ConversationMembers> {
    const rows = [];
    for (const conversation of conversations.allDocuments()) {
      const conversationRows = await db
        .query('game2_conversationMembers')
        .withIndex('conversationId', (q) => q.eq('conversationId', conversation._id))
        .filter((q) => q.neq(q.field('status.kind'), 'left'))
        .collect();
      rows.push(...conversationRows);
    }
    return new ConversationMembers(db, worldId, rows);
  }

  constructor(
    public db: DatabaseWriter,
    public worldId: Id<'worlds'>,
    rows: Doc<'game2_conversationMembers'>[],
  ) {
    super(rows);
  }

  isActive(doc: Doc<'game2_conversationMembers'>): boolean {
    return doc.status.kind !== 'left';
  }
}
