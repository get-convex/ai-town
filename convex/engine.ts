// TODO:
// [ ] Start with non interactive latency server driven path finding
// [ ] Do some client interpolation with that?
// [ ] Reintroduce client timestamp for not relying on server time alone?
// [ ] Find some way to handle errors!

import { v } from "convex/values";
import { DatabaseReader, DatabaseWriter, mutation } from "./_generated/server";
import { COLLISION_THRESHOLD, Path, Point, Vector, map, point, world } from "./schema";
import { Doc, Id } from "./_generated/dataModel";
import { distance, manhattanDistance, orientationDegrees, pathPosition, pointsEqual } from "./geometry";
import { MinHeap } from "./minheap";
import { movementSpeed } from "./characterdata/data";
import { PositionBuffer } from "./positionBuffer";
import { api } from "./_generated/api";

export const addPlayerInput = mutation({
    args: {
        playerId: v.id("players"),
        destination: v.union(point, v.null()),
    },
    handler: async (ctx, args) => {
        await insertInput(ctx.db, args.playerId, args.destination);
    },
});

export async function insertInput(db: DatabaseWriter, playerId: Id<"players">, destination: Point | null) {
    const serverTimestamp = Date.now();
    const lastInput = await db.query("inputQueue")
        .withIndex("clientTimestamp", q => q.eq("playerId", playerId))
        .order("desc")
        .first();
    if (lastInput !== null) {
        if (lastInput.serverTimestamp >= serverTimestamp) {
            throw new Error("Time not moving forwards");
        }
    }
    await db.insert("inputQueue", {
        playerId,
        serverTimestamp,
        destination,
    });
}

export const step2 = mutation({
    args: {
        count: v.number(),
        delta: v.number(),
    },
    handler: async(ctx, args) => {
        await step(ctx, {});
        if (args.count > 0) {
            await ctx.scheduler.runAfter(
                args.delta,
                api.engine.step2,
                { count: args.count - 1, delta: args.delta },
            );
        }
    }
})

export const step = mutation({
    handler: async (ctx) => {
        const now = Date.now();

        const lastStep = await ctx.db.query("steps")
            .withIndex("endTs")
            .order("desc")
            .first();
        if (lastStep && lastStep.endTs >= now) {
            throw new Error(`Time moving backwards!`);
        }
        const lastServerTs = lastStep ? lastStep.endTs : -1;
        const startTs = lastStep ? lastStep.endTs : now;
        const endTs = Math.min(now, startTs + MAX_STEP);
        console.log(`Simulating ${startTs} -> ${endTs}: (${Math.round(endTs - startTs)}ms)`);

        // Load the game state.
        const gameState = await GameState.load(startTs, ctx.db);

        // Collect player inputs since the last step, sorted by (serverTimestamp, playerId, _id)
        const stepInputs = [];
        for (const player of Object.values(gameState.players)) {
            const playerInputs = await ctx.db.query("inputQueue")
            .withIndex(
                "clientTimestamp",
                q => q.eq("playerId", player._id).gt("serverTimestamp", lastServerTs).lte("serverTimestamp", endTs),
            )
            .collect();
            stepInputs.push(...playerInputs);
        }
        stepInputs.sort((a, b) => {
            if (a.serverTimestamp !== b.serverTimestamp) {
                return a.serverTimestamp - b.serverTimestamp;
            }
            if (a.playerId !== b.playerId) {
                return a.playerId.localeCompare(b.playerId)
            }
            return a._id.localeCompare(b._id);
        })

        let inputIndex = 0;
        let currentTs;
        for (currentTs = startTs; currentTs <= endTs; currentTs += TICK) {
            while (inputIndex < stepInputs.length) {
                const input = stepInputs[inputIndex];
                if (input.serverTimestamp > currentTs) {
                    break;
                }
                inputIndex += 1;
                gameState.handleInput(input);
            }
            gameState.tick(currentTs);
        }
        // "Commit" the update by writing back the game state and a new steps checkpoint.
        await gameState.save(ctx.db, currentTs);
        await ctx.db.insert("steps", { startTs, endTs: currentTs });
    }
})

export class GameState {
    modified: Set<Id<"players">> = new Set();
    moved: Map<Id<"players">, PositionBuffer> = new Map();

    constructor(
        public startTs: number,
        public players: Record<Id<"players">, Doc<"players">>,
    ) {
    }

    static async load(startTs: number, db: DatabaseReader) {
        const players: Record<Id<"players">, Doc<"players">> = {};
        for await (const player of db.query("players")) {
            players[player._id] = player;
        }
        return new GameState(startTs, players);
    }

    handleInput(input: Doc<"inputQueue">) {
        const player = this.players[input.playerId];
        if (!player) {
            console.warn(`Invalid player ID: ${input.playerId}`);
            return;
        }
        const { destination: point } = input;
        if (point === null) {
            delete player.pathfinding;
            this.modified.add(player._id);
            return;
        }
        if (Math.floor(point.x) !== point.x || Math.floor(point.y) !== point.y) {
            console.warn(`Non-integral destination: ${JSON.stringify(point)}`);
            return;
        }
        // Close enough to current position or destination => no-op.
        if (pointsEqual(player.position, point)) {
            return;
        }
        player.pathfinding = {
            destination: point,
            started: Date.now(),
            state: {
                kind: "needsPath",
            }
        };
        this.modified.add(player._id);
    }

    tick(now: number) {
        for (const player of Object.values(this.players)) {
            const { pathfinding } = player;
            if (!pathfinding) {
                continue;
            }

            // Stop pathfinding if we've reached our destination.
            if (pathfinding.state.kind === "moving" && pointsEqual(pathfinding.destination, player.position)) {
                delete player.pathfinding;
                this.modified.add(player._id);
            }

            // Stop pathfinding if we've timed out.
            if (pathfinding.started + PATHFINDING_TIMEOUT < now) {
                console.warn(`Timing out pathfinding for ${player._id}`);
                delete player.pathfinding;
                this.modified.add(player._id);
            }

            // Transition from "waiting" to "needsPath" if we're past the deadline.
            if (pathfinding.state.kind === "waiting" && pathfinding.state.until < now) {
                pathfinding.state = { kind: "needsPath" };
                this.modified.add(player._id);
            }

            // Perform pathfinding if needed.
            if (pathfinding.state.kind === "needsPath") {
                const path = this.findRoute(now, player, pathfinding.destination);
                if (typeof path === "string") {
                    console.log(`Failed to route: ${path}`);
                    delete player.pathfinding;
                } else {
                    pathfinding.state = { kind: "moving", path };
                }
                this.modified.add(player._id);
            }

            // Try to move the player along their path, clearing the path if they'd collide into something.
            if (player.pathfinding && player.pathfinding.state.kind === "moving") {
                const collisionReason = this.tickPosition(now, player, player.pathfinding.state.path);
                if (collisionReason !== null) {
                    const backoff = Math.random() * PATHFINDING_BACKOFF;
                    console.warn(`Stopping path for ${player._id}, waiting for ${backoff}ms: ${collisionReason}`);
                    player.pathfinding.state = {
                        kind: "waiting",
                        until: now + backoff,
                    };
                    this.modified.add(player._id);
                }
            }
        }
    }

    findRoute(now: number, player: Doc<"players">, destination: Point): Path | string {
        if (this.blocked(destination, player)) {
            return "destination blocked";
        }
        const minDistances: PathCandidate[][] = [];
        const explore = (current: PathCandidate): Array<PathCandidate> => {
            let deltas: {vector: Vector, dx: number, dy: number}[] = [];

            // Initial condition: Try to move to an adjacent grid point.
            const xSnap = Math.floor(current.pos.x);
            const ySnap = Math.floor(current.pos.y);
            if (xSnap !== current.pos.x) {
                deltas = [
                    {vector: {dx: -1, dy: 0}, dx: xSnap - current.pos.x, dy: 0},
                    {vector: {dx: 1, dy: 0}, dx: xSnap + 1 - current.pos.x, dy: 0},
                ];
            } else if (ySnap !== current.pos.y) {
                deltas = [
                    {vector: {dx: 0, dy: -1}, dx: 0, dy: ySnap - current.pos.y},
                    {vector: {dx: 0, dy: 1}, dx: 0, dy: ySnap + 1 - current.pos.y},
                ]
            }
            // Otherwise: Explore in each of the grid directions.
            else {
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    deltas.push({vector: {dx, dy}, dx, dy});
                }
            }
            const next = [];
            for (const { vector, dx, dy } of deltas) {
                const length = current.length + 1;
                const pos = { x: current.pos.x + dx, y: current.pos.y + dy };
                if (this.blocked(pos, player)) {
                    continue;
                }
                const remaining = manhattanDistance(pos, destination);
                const path = {
                    pos,
                    vector,
                    // Movement speed is in tiles per second.
                    t: current.t + 1000 / movementSpeed,
                    length,
                    cost: length + remaining,
                    prev: current,
                };
                const existingMin = minDistances[pos.y]?.[pos.x];
                if (!existingMin) {
                    minDistances[pos.y] ??= [];
                    minDistances[pos.y][pos.x] = path;
                } else if (path.cost >= existingMin.cost) {
                    continue;
                }
                next.push(path);
            }
            return next;
        }

        let current: PathCandidate | undefined = {
            pos: {...player.position},
            vector: undefined,
            t: now,
            length: 0,
            cost: manhattanDistance(player.position, destination),
            prev: undefined,
        };
        const minheap = MinHeap<PathCandidate>((more, less) => more.cost > less.cost);
        while (current) {
            if (pointsEqual(current.pos, destination)) {
                break;
            }
            for (const candidate of explore(current)) {
                minheap.push(candidate);
            }
            current = minheap.pop();
        }
        if (!current) {
            return "couldn't find path";
        }
        const densePath = [];
        let vector = { dx: 0, dy: 0 };
        while (current) {
            densePath.push({position: current.pos, t: current.t, vector});
            vector = current.vector!;
            current = current.prev;
        }
        densePath.reverse();

        const pathStr = densePath.map(p => JSON.stringify(p.position)).join(", ");
        console.log(`Routing between ${JSON.stringify(player.position)} and ${JSON.stringify(destination)}: ${pathStr}`);
        return densePath;
    }

    blocked(pos: Point, player: Doc<"players">) {
        if (isNaN(pos.x) || isNaN(pos.y)) {
            throw new Error(`NaN position in ${JSON.stringify(pos)}`);
        }
        if (pos.x < 0 || pos.y < 0 || pos.x >= world.width || pos.y >= world.height) {
            return "out of bounds";
        }
        if (map.objectTiles[Math.floor(pos.y)][Math.floor(pos.x)] !== -1) {
            return "world blocked";
        }
        for (const otherPlayer of Object.values(this.players)) {
            if (otherPlayer._id === player._id) {
                continue;
            }
            if (distance(otherPlayer.position, pos) < COLLISION_THRESHOLD) {
                return "player collision";
            }
        }
        return null;
    }

    tickPosition(now: number, player: Doc<"players">, path: Path): null | string {
        const candidate = pathPosition(path, now);
        const collisionReason = this.blocked(candidate.position, player);
        if (collisionReason !== null) {
            return collisionReason;
        }
        const orientation = orientationDegrees(candidate.vector);
        this.movePlayer(now, player._id, candidate.position, orientation);
        this.modified.add(player._id);
        return null;
    }

    movePlayer(now: number, id: Id<"players">, position: Point, orientation: number) {
        const player = this.players[id];
        let buffer = this.moved.get(id);
        if (!buffer) {
            buffer = new PositionBuffer();
            buffer.push(this.startTs, player.position.x, player.position.y, player.orientation);
            if (now > this.startTs) {
                buffer.push(now - TICK, player.position.x, player.position.y, player.orientation);
            }
            this.moved.set(id, buffer);
        }
        player.position = position;
        player.orientation = orientation;
        buffer.push(now, position.x, position.y, orientation);
        this.modified.add(id);
    }

    async save(db: DatabaseWriter, endTs: number) {
        for (const player of Object.values(this.players)) {
            if (player.previousPositions) {
                delete player.previousPositions;
                this.modified.add(player._id);
            }
        }
        let numMoved = 0;
        let bufferSize = 0;
        for (const [id, buffer] of this.moved.entries()) {
            const player = this.players[id];
            if (buffer.maxTs()! < endTs) {
                buffer.push(endTs, player.position.x, player.position.y, player.orientation);
            }
            const packed = buffer.pack();
            player.previousPositions = packed;
            this.modified.add(id);
            numMoved += 1;
            bufferSize += packed.x.byteLength + packed.y.byteLength + packed.t.byteLength;
        }
        console.log(`Packed ${numMoved} moved players in ${(bufferSize / 1024).toFixed(2)}KiB`);
        for (const id of this.modified) {
            await db.replace(id, this.players[id]!);
        }
    }
}

type PathCandidate = {
    pos: Point,
    vector?: Vector,
    t: number,
    length: number,
    cost: number,
    prev?: PathCandidate,
};

const PATHFINDING_TIMEOUT = 60 * 1000;
const PATHFINDING_BACKOFF = 1000;
const MAX_STEP = 60 * 60 * 1000;
const TICK = 16;