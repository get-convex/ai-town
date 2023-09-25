import { v } from 'convex/values';
import { GameTable } from '../engine/gameTable';
import { defineTable } from 'convex/server';
import { DatabaseWriter } from '../_generated/server';
import { Players } from './players';
import { Doc, Id } from '../_generated/dataModel';
import { point, vector } from '../util/types';

export const locations = defineTable({
  position: point,
  // Normalized orientation vector.
  facing: vector,
  velocity: v.number(),
});

export class Locations extends GameTable<'game2_locations'> {
  table = 'game2_locations' as const;

  static async load(
    db: DatabaseWriter,
    worldId: Id<'worlds'>,
    players: Players,
  ): Promise<Locations> {
    const rows = [];
    for (const playerId of players.allIds()) {
      const player = players.lookup(playerId);
      const row = await db.get(player.locationId);
      if (!row) {
        throw new Error(`Invalid location ID: ${player.locationId}`);
      }
      rows.push(row);
    }
    return new Locations(db, worldId, rows);
  }

  constructor(
    public db: DatabaseWriter,
    public worldId: Id<'worlds'>,
    rows: Doc<'game2_locations'>[],
  ) {
    super(rows);
  }

  isActive(_doc: Doc<'game2_locations'>): boolean {
    return true;
  }
}
