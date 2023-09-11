// TODO:
// [ ] Start with non interactive latency server driven path finding
// [ ] Do some client interpolation with that?
// [ ] Reintroduce client timestamp for not relying on server time alone?
// [ ] Find some way to handle errors!

import { v } from "convex/values";
import { DatabaseReader, DatabaseWriter, mutation } from "./_generated/server";
import { Path, Point, Vector, map, point, world } from "./schema";
import { Doc, Id } from "./_generated/dataModel";
import { distance, manhattanDistance, orientationDegrees, pathPosition, pointsEqual } from "./geometry";
import { MinHeap } from "./minheap";
import { movementSpeed } from "./characterdata/data";

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

export const step = mutation({
    handler: async (ctx) => {
        const now = Date.now();

        const lastStep = await ctx.db.query("steps")
            .withIndex("serverTimestamp")
            .order("desc")
            .first();
        if (lastStep && lastStep.serverTimestamp >= now) {
            throw new Error(`Time moving backwards!`);
        }
        const lastServerTs = lastStep ? lastStep.serverTimestamp : -1;
        const startTs = lastStep ? lastStep.serverTimestamp : now;
        const endTs = now;
        console.log(`Simulating ${startTs} -> ${endTs}: (${Math.round(endTs - startTs)}ms)`);

        // Load the game state.
        const gameState = await GameState.load(ctx.db);

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
        for (let currentTs = startTs; currentTs <= endTs; currentTs += 16) {
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
        await gameState.save(ctx.db);
        await ctx.db.insert("steps", { serverTimestamp: endTs });
    }
})

export class GameState {
    modified: Set<Id<"players">> = new Set();
    logCount: number = 0;

    constructor(
        public players: Record<Id<"players">, Doc<"players">>,
    ) {
    }

    static async load(db: DatabaseReader) {
        const players: Record<Id<"players">, Doc<"players">> = {};
        for await (const player of db.query("players")) {
            players[player._id] = player;
        }
        return new GameState(players);
    }

    handleInput(input: Doc<"inputQueue">) {
        const player = this.players[input.playerId];
        if (!player) {
            console.warn(`Invalid player ID: ${input.playerId}`);
            return;
        }
        const { destination: point } = input;
        if (point === null) {
            delete player.destination;
            delete player.path;
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
        player.destination = { point, started: Date.now() };
        delete player.path;
        this.modified.add(player._id);
    }

    tick(now: number) {
        for (const player of Object.values(this.players)) {
            // Perform pathfinding if we have a player that has a destination but no path.
            if (player.destination && !player.path) {
                if (now - player.destination.started > PATHFINDING_TIMEOUT) {
                    console.warn(`Timing out pathfinding for ${player._id}`);
                    delete player.destination;
                    delete player.path;
                } else {
                    const path = this.findRoute(now, player, player.destination.point);
                    if (typeof path === "string") {
                        console.log(`Failed to route: ${path}`);
                        delete player.destination;
                    } else {
                        player.path = path;
                    }
                }
                this.modified.add(player._id);
            }
            // Clear the current path if we've reached our destination.
            if (player.destination && pointsEqual(player.position, player.destination.point)) {
                delete player.destination;
                delete player.path;
                this.modified.add(player._id);
            }
            // Try to move the player along their path, clearing the path if they'd collide into something.
            if (player.path) {
                this.tickPosition(now, player, player.path);
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
            if (distance(otherPlayer.position, pos) < 0.75) {
                return "player collision";
            }
        }
        return null;
    }

    tickPosition(now: number, player: Doc<"players">, path: Path) {
        const candidate = pathPosition(path, now);
        const collisionReason = this.blocked(candidate.position, player);
        if (collisionReason !== null) {
            console.warn(`Stopping path for ${player._id}: ${collisionReason}`);
            delete player.path;
        } else {
            player.position = candidate.position;
            player.orientation = orientationDegrees(candidate.vector);
        }
        this.modified.add(player._id);
    }

    async save(db: DatabaseWriter) {
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