import { DatabaseWriter } from './_generated/server';
import { Point } from './schema/types';
import { Id } from './_generated/dataModel';
import { PositionBuffer } from './util/positionBuffer';
import { TICK } from './constants';
import { MappedTable } from './util/mappedTable';

export class GameState2 {
  playersMoved: Map<Id<'players'>, PositionBuffer> = new Map();

  constructor(
    public startTs: number,
    public players: MappedTable<'players'>,
    public conversations: MappedTable<'conversations'>,
    public conversationMembers: MappedTable<'conversationMembers'>,
    public messages: MappedTable<'messages'>,
  ) {}

  static async load(startTs: number, db: DatabaseWriter) {
    // Load all players.
    const players = await db.query('players').collect();

    // TODO: Only load active conversations.
    const conversations = await db.query('conversations').collect();

    // TODO: Only load members for active conversations.
    const conversationMembers = await db.query('conversationMembers').collect();

    // TODO: Only load messages for active conversations.
    const messages = await db.query('messages').collect();

    return new GameState2(
      startTs,
      new MappedTable('players', db, players),
      new MappedTable('conversations', db, conversations),
      new MappedTable('conversationMembers', db, conversationMembers),
      new MappedTable('messages', db, messages),
    );
  }

  movePlayer(now: number, id: Id<'players'>, position: Point, orientation: number) {
    const player = this.players.lookup(id);
    let buffer = this.playersMoved.get(id);
    if (!buffer) {
      buffer = new PositionBuffer();
      buffer.push(this.startTs, player.position.x, player.position.y, player.orientation);
      if (now > this.startTs) {
        buffer.push(now - TICK, player.position.x, player.position.y, player.orientation);
      }
      this.playersMoved.set(id, buffer);
    }
    player.position = position;
    player.orientation = orientation;
    buffer.push(now, position.x, position.y, orientation);
  }

  async save(endTs: number) {
    // Flush the position buffer before saving.
    for (const playerId of this.players.allIds()) {
      const player = this.players.lookup(playerId);
      if (player.previousPositions) {
        delete player.previousPositions;
      }
    }
    let numMoved = 0;
    let bufferSize = 0;
    for (const [playerId, buffer] of this.playersMoved.entries()) {
      const player = this.players.lookup(playerId);
      if (buffer.maxTs()! < endTs) {
        buffer.push(endTs, player.position.x, player.position.y, player.orientation);
      }
      const packed = buffer.pack();
      player.previousPositions = packed;
      numMoved += 1;
      bufferSize += packed.x.byteLength + packed.y.byteLength + packed.t.byteLength;
    }
    console.log(`Packed ${numMoved} moved players in ${(bufferSize / 1024).toFixed(2)}KiB`);

    this.players.save();
    this.conversations.save();
    this.conversationMembers.save();
    this.messages.save();
  }
}
