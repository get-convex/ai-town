import { DatabaseWriter } from '../_generated/server';
import { Point, Vector } from '../util/types';
import { Id } from '../_generated/dataModel';
import { PositionBuffer } from '../util/positionBuffer';
import { TICK } from '../constants';
import { MappedTable } from '../util/mappedTable';

export class GameState {
  playersMoved: Map<Id<'players'>, PositionBuffer> = new Map();

  constructor(
    public startTs: number,
    public players: MappedTable<'players'>,
    public conversations: MappedTable<'conversations'>,
    public conversationMembers: MappedTable<'conversationMembers'>,
    public messages: MappedTable<'messages'>,
    public blocks: MappedTable<'blocks'>,
  ) {}

  static async load(startTs: number, db: DatabaseWriter) {
    // TODO: Only load active players. We can add a notion of "pruning"
    // game state that happens after each step that removes inactive
    // objects.
    const players = await db.query('players').collect();

    // TODO: Only load active conversations.
    const conversations = await db.query('conversations').collect();

    // TODO: Only load members for active conversations.
    const conversationMembers = await db.query('conversationMembers').collect();

    // TODO: Only load messages for active conversations.
    const messages = await db.query('messages').collect();

    const blocks = await db.query('blocks').collect();

    return new GameState(
      startTs,
      new MappedTable('players', db, players),
      new MappedTable('conversations', db, conversations),
      new MappedTable('conversationMembers', db, conversationMembers),
      new MappedTable('messages', db, messages),
      new MappedTable('blocks', db, blocks),
    );
  }

  enabledPlayers() {
    return this.players
      .allIds()
      .map((id) => this.players.lookup(id))
      .filter((p) => p.enabled);
  }

  freeBlocks() {
    return this.blocks
      .allIds()
      .map((id) => this.blocks.lookup(id))
      .filter((b) => b.metadata.state !== 'carried');
  }

  activeConversations() {
    return this.conversations
      .allIds()
      .map((id) => this.conversations.lookup(id))
      .filter((c) => c.finished === undefined);
  }

  activeConversationMemberships() {
    return this.conversationMembers
      .allIds()
      .map((id) => this.conversationMembers.lookup(id))
      .filter((m) => m.status !== 'left');
  }

  movePlayer(now: number, id: Id<'players'>, position: Point, facing: Vector) {
    const player = this.players.lookup(id);
    let buffer = this.playersMoved.get(id);
    if (!buffer) {
      buffer = new PositionBuffer();
      buffer.push(this.startTs, player.position, player.facing);
      if (now - TICK > this.startTs) {
        buffer.push(now - TICK, player.position, player.facing);
      }
      this.playersMoved.set(id, buffer);
    }
    player.position = position;
    player.facing = facing;
    buffer.push(now, position, facing);
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
      const bufferMaxTs = buffer.maxTs()!;
      if (bufferMaxTs + TICK < endTs) {
        buffer.push(bufferMaxTs + TICK, player.position, player.facing);
      }
      buffer.push(endTs, player.position, player.facing);
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
    this.blocks.save();
  }
}
