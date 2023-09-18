import { Point, Vector } from '../convex/schema/types.ts';
import { api } from '../convex/_generated/api';
import { Doc, Id } from '../convex/_generated/dataModel';
import { FunctionReturnType } from 'convex/server';
import { PositionBuffer } from '../convex/util/positionBuffer.ts';
import { buffer } from 'stream/consumers';
import { STEP_INTERVAL } from '../convex/constants.ts';

const LOGGING_INTERVAL = 1736;
export const DEBUG_POSITIONS = true;

// If we're behind more than 5s, jump to the latest server time minus 5s.
const MAX_SERVER_BUFFER_AGE = 5 * STEP_INTERVAL;

const SOFT_MAX_SERVER_BUFFER_AGE = STEP_INTERVAL;
const SOFT_MIN_SERVER_BUFFER_AGE = 100;

export type GameState = {
  players: Record<Id<'players'>, InterpolatedPlayer>;
};

export type InterpolatedPlayer = {
  position: Point;
  facing: Vector;
  isMoving: boolean;

  player: Doc<'players'>;
  positionBuffers?: PositionBuffer[];
};

type ServerSnapshot = {
  players: { player: Doc<'players'>; previousPositions?: PositionBuffer }[];
  serverStartTs: number;
  serverEndTs: number;
};

export class ServerState {
  snapshots: Array<ServerSnapshot> = [];
  totalDuration: number = 0;

  prevClientTs?: number;
  prevServerTs?: number;
  tsWaiters: Array<{ ts: number; resolve: () => void }> = [];

  lastLog: number = Date.now();
  numAdvances: number = 0;
  numGaps: number = 0;
  numHalts: number = 0;
  numTrims: number = 0;

  receive(gameState: FunctionReturnType<typeof api.queryGameState.default>) {
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
    const prevClientTs = this.prevClientTs ?? now;
    const prevServerTs = this.prevServerTs ?? this.snapshots[0].serverStartTs;

    const lastServerTs = this.snapshots[this.snapshots.length - 1].serverEndTs;

    // Simple rate adjustment: run time at 1.2 speed if we're more than 1s behind and
    // 0.8 speed if we only have 100ms of buffer left. A more sophisticated approach
    // would be to continuously adjust the rate based on the size of the buffer.
    const bufferDuration = lastServerTs - prevServerTs;
    let rate = 1;
    if (bufferDuration < SOFT_MIN_SERVER_BUFFER_AGE) {
      rate = 0.8;
    } else if (bufferDuration > SOFT_MAX_SERVER_BUFFER_AGE) {
      rate = 1.2;
    }
    let serverTs = Math.max(
      prevServerTs + (now - prevClientTs) * rate,
      // Jump forward if we're too far behind.
      lastServerTs - MAX_SERVER_BUFFER_AGE,
    );

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
      const interpolatedPlayer: InterpolatedPlayer = {
        position: player.position,
        facing: player.facing,
        isMoving: false,
        player,
      };
      if (previousPositions) {
        const interpolated = previousPositions.query(serverTs);
        if (interpolated) {
          interpolatedPlayer.position = interpolated.position;
          interpolatedPlayer.facing = interpolated.facing;
          interpolatedPlayer.isMoving = true;
        }
      }
      if (DEBUG_POSITIONS) {
        interpolatedPlayer.positionBuffers = this.snapshots
          .slice(chosen)
          .flatMap((s) =>
            s.players.filter((p) => p.player._id === player._id && p.previousPositions),
          )
          .map((p) => p.previousPositions!);
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
    // Wake up all of the waiters who are waiting for a timestamp before the current one.
    this.tsWaiters = this.tsWaiters.filter((waiter) => {
      if (waiter.ts <= serverTs) {
        waiter.resolve();
        return false;
      }
      return true;
    });

    this.prevClientTs = now;
    this.prevServerTs = serverTs;

    return { players };
  }

  bufferHealth(now: number): number {
    if (!this.snapshots.length) {
      return 0;
    }
    const lastServerTs = this.prevServerTs ?? this.snapshots[0].serverStartTs;
    return this.snapshots[this.snapshots.length - 1].serverEndTs - lastServerTs;
  }

  waitUntil(serverTimestamp: number): Promise<void> {
    if (this.prevServerTs && this.prevServerTs >= serverTimestamp) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.tsWaiters.push({ ts: serverTimestamp, resolve });
    });
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
    report.push(`lastClientTs: ${this.prevClientTs}`);
    report.push(`lastServerTs: ${this.prevServerTs}`);
    report.push('');
    report.push(`${this.snapshots.length} snapshots:`);
    for (const snapshot of this.snapshots) {
      const current =
        this.prevServerTs &&
        snapshot.serverStartTs <= this.prevServerTs &&
        this.prevServerTs < snapshot.serverEndTs;
      const currentMsg = current
        ? ` (current, ${((snapshot.serverEndTs - this.prevServerTs!) / 1000).toFixed(
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
