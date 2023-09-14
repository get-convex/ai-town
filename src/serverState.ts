import { Point } from '../convex/schema/types.ts';
import { api } from '../convex/_generated/api';
import { Doc, Id } from '../convex/_generated/dataModel';
import { FunctionReturnType } from 'convex/server';
import { PositionBuffer } from '../convex/util/positionBuffer.ts';

const LOGGING_INTERVAL: number = 17360;

export type GameState = {
  players: Record<Id<'players'>, InterpolatedPlayer>;
};

export type InterpolatedPlayer = {
  position: Point;
  orientation: number;
  isMoving: boolean;

  player: Doc<'players'>;
};

type ServerSnapshot = {
  players: { player: Doc<'players'>; previousPositions?: PositionBuffer }[];
  serverStartTs: number;
  serverEndTs: number;
};

export class ServerState {
  snapshots: Array<ServerSnapshot> = [];
  totalDuration: number = 0;

  lastClientTs?: number;
  lastServerTs?: number;

  lastLog: number = Date.now();
  numAdvances: number = 0;
  numGaps: number = 0;
  numHalts: number = 0;
  numTrims: number = 0;

  receive(gameState: FunctionReturnType<typeof api.gameState.default>) {
    const latest = this.snapshots[this.snapshots.length - 1];
    if (latest) {
      if (latest.serverEndTs == gameState.endTs) {
        return;
      }
      if (latest.serverEndTs > gameState.endTs) {
        throw new Error(
          `Server time moving backwards: ${latest.serverEndTs} -> ${gameState.endTs}`,
        );
      }
      if (latest.serverEndTs !== gameState.startTs) {
        this.numGaps += 1;
      }
    }
    const newSnapshot = {
      players: gameState.players.map((player) => {
        const previousPositions =
          player.previousPositions && PositionBuffer.unpack(player.previousPositions);
        return { player, previousPositions };
      }),
      serverStartTs: gameState.startTs,
      serverEndTs: gameState.endTs,
    };
    this.numAdvances += 1;
    this.snapshots.push(newSnapshot);
    this.totalDuration += newSnapshot.serverEndTs - newSnapshot.serverStartTs;
  }

  currentState(now: number): GameState | null {
    if (!this.snapshots.length) {
      return null;
    }
    // If this is our first time simulating, start at the beginning of the buffer.
    const lastClientTs = this.lastClientTs ?? now;
    const lastServerTs = this.lastServerTs ?? this.snapshots[0].serverStartTs;

    let serverTs = now - lastClientTs + lastServerTs;

    let chosen = null;
    for (let i = 0; i < this.snapshots.length; i++) {
      const snapshot = this.snapshots[i];
      // We're past this snapshot, continue to the next one.
      if (snapshot.serverEndTs < serverTs) {
        continue;
      }
      // We're cleanly within this snapshot.
      if (serverTs >= snapshot.serverStartTs) {
        chosen = i;
        break;
      }
      // We've gone past the desired timestamp, which implies a gap in our server state.
      // Jump time forward to the beginning of this snapshot.
      if (serverTs < snapshot.serverStartTs) {
        this.numGaps += 1;
        serverTs = snapshot.serverStartTs;
        chosen = i;
      }
    }
    if (chosen === null) {
      this.numHalts += 1;
      serverTs = this.snapshots.at(-1)!.serverEndTs;
      chosen = this.snapshots.length - 1;
    }

    const snapshot = this.snapshots[chosen];

    const players: Record<Id<'players'>, InterpolatedPlayer> = {};
    for (const { player, previousPositions } of snapshot.players) {
      const interpolatedPlayer = {
        position: player.position,
        orientation: player.orientation,
        isMoving: false,
        player,
      };
      if (previousPositions) {
        const interpolated = previousPositions.query(serverTs);
        if (interpolated) {
          interpolatedPlayer.position = interpolated.position;
          interpolatedPlayer.orientation = interpolated.orientation;
          interpolatedPlayer.isMoving = true;
        }
      }
      players[player._id] = interpolatedPlayer;
    }

    // Time only moves forward, so we can trim all of the snapshots before our chosen one.
    const toTrim = Math.max(chosen - 1, 0);
    if (toTrim > 0) {
      this.numTrims += 1;
      for (const snapshot of this.snapshots.slice(0, toTrim)) {
        this.totalDuration -= snapshot.serverEndTs - snapshot.serverStartTs;
      }
      this.snapshots = this.snapshots.slice(toTrim);
    }
    this.lastClientTs = now;
    this.lastServerTs = serverTs;

    this.log(now);
    return { players };
  }

  log(now: number) {
    if (now < this.lastLog + LOGGING_INTERVAL) {
      return;
    }
    const report = [];
    report.push(`Server state report (${((now - this.lastLog) / 1000).toFixed(2)}s):`);
    report.push(`churn: ${this.numAdvances} advances, ${this.numTrims} trims`);
    if (this.numGaps > 0 || this.numHalts > 0) {
      report.push(`errors: ${this.numGaps} gaps, ${this.numHalts} halts!`);
    }
    report.push(`lastClientTs: ${this.lastClientTs}`);
    report.push(`lastServerTs: ${this.lastServerTs}`);
    report.push('');
    report.push(`${this.snapshots.length} snapshots:`);
    for (const snapshot of this.snapshots) {
      const current =
        this.lastServerTs &&
        snapshot.serverStartTs <= this.lastServerTs &&
        this.lastServerTs < snapshot.serverEndTs;
      const currentMsg = current
        ? ` (current, ${((snapshot.serverEndTs - this.lastServerTs!) / 1000).toFixed(
            2,
          )}s remaining)`
        : '';
      const duration = (snapshot.serverEndTs - snapshot.serverStartTs) / 1000;
      report.push(
        `  [${snapshot.serverStartTs}, ${snapshot.serverEndTs}]: ${duration.toFixed(
          2,
        )}s${currentMsg}`,
      );
    }
    console.log(report.join('\n'));
    this.numAdvances = 0;
    this.numGaps = 0;
    this.numHalts = 0;
    this.numTrims = 0;
    this.lastLog = now;
  }
}
