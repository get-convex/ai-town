import { useTick } from '@pixi/react';
import { useQuery } from 'convex/react';
import { Player, SelectPlayer } from './Player.tsx';
import { Point } from '../../convex/schema.ts';
import { api } from '../../convex/_generated/api';
import { Doc, Id } from '../../convex/_generated/dataModel';
import { useRef, useState } from 'react';
import { FunctionReturnType } from 'convex/server';
import { PositionBuffer } from '../../convex/positionBuffer.ts';

type InterpolatedPlayer = {
  position: Point,
  orientation: number,
  player: Doc<"players">,
};

type ServerSnapshot = {
  players: { player: Doc<"players">, previousPositions?: PositionBuffer }[],
  serverStartTs: number,
  serverEndTs: number,
}

class ServerState {
  snapshots: Array<ServerSnapshot> = [];

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
        throw new Error(`Server time moving backwards: ${latest.serverEndTs} -> ${gameState.endTs}`);
      }
      if (latest.serverEndTs !== gameState.startTs) {
        this.numGaps += 1;
      }
    }
    const newSnapshot = {
      players: gameState.players.map(player => {
        const previousPositions = player.previousPositions && PositionBuffer.unpack(player.previousPositions);
        return { player, previousPositions }
      }),
      serverStartTs: gameState.startTs,
      serverEndTs: gameState.endTs,
    };
    this.numAdvances += 1;
    this.snapshots.push(newSnapshot);
  }

  playerPositions(now: number): Record<Id<"players">, InterpolatedPlayer> | null {
    if (!this.snapshots.length) {
      return null;
    }
    // If this is our first time simulating, start at the beginning of the buffer.
    const lastClientTs = this.lastClientTs ?? now;
    const lastServerTs = this.lastServerTs ?? this.snapshots[0].serverStartTs;

    let serverTs = (now - lastClientTs) + lastServerTs;
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

    const out: Record<Id<"players">, InterpolatedPlayer> = {};
    for (const { player, previousPositions } of snapshot.players) {
      let position = player.position;
      let orientation = player.orientation;
      if (previousPositions) {
        const interpolated = previousPositions.query(serverTs);
        if (interpolated) {
          position = interpolated.position;
          orientation = interpolated.orientation;
        }
      }
      out[player._id] = { position, orientation, player };
    }

    // Time only moves forward, so we can trim all of the snapshots before our chosen one.
    const toTrim = Math.max(chosen - 1, 0);
    if (toTrim > 0) {
      this.numTrims += 1;
      this.snapshots = this.snapshots.slice(toTrim);
    }
    this.lastClientTs = now;
    this.lastServerTs = serverTs;

    this.log(now);
    return out;
  }

  log(now: number) {
    if (now < this.lastLog + LOGGING_INTERVAL) {
      return;
    }
    const report = []
    report.push(`Server state report (${((now - this.lastLog) / 1000).toFixed(2)}s):`);
    report.push(`churn: ${this.numAdvances} advances, ${this.numTrims} trims`);
    if (this.numGaps > 0 || this.numHalts > 0) {
      report.push(`errors: ${this.numGaps} gaps, ${this.numHalts} halts!`);
    }
    report.push(`lastClientTs: ${this.lastClientTs}`);
    report.push(`lastServerTs: ${this.lastServerTs}`);
    report.push('');
    report.push(`${this.snapshots.length} snapshots:`)
    for (const snapshot of this.snapshots) {
      const current = this.lastServerTs && snapshot.serverStartTs <= this.lastServerTs && this.lastServerTs < snapshot.serverEndTs;
      const currentMsg = current ? ` (current, ${((snapshot.serverEndTs - this.lastServerTs!) / 1000).toFixed(2)}s remaining)` : "";
      const duration = (snapshot.serverEndTs - snapshot.serverStartTs) / 1000;
      report.push(`  [${snapshot.serverStartTs}, ${snapshot.serverEndTs}]: ${duration.toFixed(2)}s${currentMsg}`);
    }
    console.log(report.join('\n'));
    this.numAdvances = 0;
    this.numGaps = 0;
    this.numHalts = 0;
    this.numTrims = 0;
    this.lastLog = now;
  }
}

const LOGGING_INTERVAL: number = 1736;

export const Game = (props: { setSelectedPlayer: SelectPlayer }) => {
  const gameState = useQuery(api.gameState.default);
  const serverState = useRef(new ServerState());
  if (gameState) {
    serverState.current.receive(gameState);
  }
  const [players, setPlayers] = useState<Record<Id<"players">, InterpolatedPlayer>>({});
  useTick(() => {
    const interpolated = serverState.current.playerPositions(Date.now());
    if (interpolated) {
      setPlayers(interpolated);
    }
  })
  if (!gameState) {
    return null;
  }
  return (
    <>
    {Object.entries(players).map(([id, { position, orientation, player }]) => (
      <Player
        key={id}
        player={player}
        x={position.x}
        y={position.y}
        orientation={orientation}
        onClick={props.setSelectedPlayer}
      />
    ))}
    </>
  );
  return null;
};
export default Game;
