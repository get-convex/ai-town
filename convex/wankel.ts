import { DatabaseReader, DatabaseWriter, mutation } from "./_generated/server";
import { bgtiles } from "./maps/firstmap";
import { v } from 'convex/values';
import { inputPayload } from "./schema";
import { Doc, Id } from "./_generated/dataModel";
import { assertNever, clamp } from "./lib/utils"

export const setupWorld = mutation(async (ctx) => {
    const existingMap = await ctx.db.query("maps").first();
    if (!existingMap) {
        throw new Error("No maps, run regular initialization first!");
    }
    const worldId = await ctx.db.insert("worlds", {
        mapId: existingMap._id,
        frozen: false,
        width: bgtiles[0].length,
        height: bgtiles[0][0].length,
    });
    return worldId;
});

export const addPlayer = mutation({
    args: {
        worldId: v.id("worlds"),
        characterId: v.id("characters"),
        name: v.string(),
    },
    handler: async (ctx, args) => {
        const world = ctx.db.get(args.worldId);
        if (world === null) {
            throw new Error(`Invalid world ID: ${args.worldId}`);
        }
        const playerId = await ctx.db.insert("players", {
            name: args.name,
            worldId: args.worldId,
            characterId: args.characterId,
        });
        await ctx.db.insert("playerPosition", {
            worldId: args.worldId,
            playerId,
            x: 0,
            y: 0,
            dx: 0,
            dy: 0,
        })
        return playerId;
    }
});

export const addPlayerInput = mutation({
    args: {
        worldId: v.id("worlds"),
        playerId: v.id("players"),
        clientTimestamp: v.number(),
        payload: inputPayload,
    },
    handler: async (ctx, args) => {
        const lastInput = await ctx.db.query("inputQueue")
            .withIndex("clientTimestamp", q => q.eq("worldId", args.worldId).eq("playerId", args.playerId))
            .order("desc")
            .first();
        if (lastInput !== null) {
            if (lastInput.clientTimestamp >= args.clientTimestamp) {
                throw new Error(`Time moving backwards for ${args.playerId}: ${lastInput.clientTimestamp} >= ${args.clientTimestamp}`);
            }
        }
        await ctx.db.insert("inputQueue", {
            worldId: args.worldId,
            playerId: args.playerId,
            clientTimestamp: args.clientTimestamp,
            serverTimestamp: Date.now(),
            payload: args.payload,
        });
    },
});

// Tick every 100ms. Smaller ticks interleave input + game updates more thoroughly.
const tickResolution = 100;
// Set this based on how expensive each tick is.
const maxTicksPerStep = 1e6;

// Step every 1s or so. Bigger steps use less bandwidth but rely on more aggressive prediction/interpolation.
// Don't rely on client/server clocks lining up at all.
export const step = mutation({
    args: {
        worldId: v.id("worlds"),
    },
    handler: async (ctx, args) => {
        const players = await ctx.db.query("players")
            .withIndex("by_worldId", q => q.eq("worldId", args.worldId))
            .collect();

        let now = Math.floor(Date.now() / tickResolution) * tickResolution;
        const lastStep = await ctx.db.query("steps")
            .withIndex("serverTimestamp")
            .order("desc")
            .first();
        if (lastStep !== null) {
            if (lastStep.serverTimestamp === now) {
                console.warn("Dropping duplicate step");
                return;
            }
            if (lastStep.serverTimestamp > now) {
                throw new Error(`Time moving backwards for the server! ${lastStep.serverTimestamp} >= ${now}`);
            }
            const numTicks = (now - lastStep.serverTimestamp) / tickResolution;
            if (numTicks > maxTicksPerStep) {
                console.warn(`Server too far behind, only advancing ${tickResolution * maxTicksPerStep}ms`);
                now = lastStep.serverTimestamp + tickResolution * maxTicksPerStep;
            }
        }

        // Collect player inputs since the last step, sorted by (serverTimestamp, playerId, _id)
        const stepInputs = [];
        for (const player of players) {
            const lastClientTs = lastStep ? lastStep.clientTimestamps[player._id] as number : 0;
            const playerInputs = await ctx.db.query("inputQueue")
                .withIndex(
                    "clientTimestamp",
                    q => q.eq("worldId", args.worldId)
                        .eq("playerId", player._id)
                        .gt("clientTimestamp", lastClientTs),
                )
                .filter(q => q.lte(q.field("serverTimestamp"), now))
                .collect();
            stepInputs.push(...playerInputs);
        }
        stepInputs.sort((a, b) => {
            if (a.serverTimestamp === b.serverTimestamp) {
                if (a.playerId === b.playerId) {
                    return a._id.localeCompare(b._id);
                }
                return a.playerId.localeCompare(b.playerId)
            }
            return a.serverTimestamp - b.serverTimestamp;
        })

        // Load the game state before performing any ticks.
        const gameState = await GameState.load(ctx.db, args.worldId);

        // Simulate each tick between our previous step and `now`.
        // For each tick, first apply all inputs and then advance the game state.
        let inputIndex = 0;
        let startTs = lastStep ? lastStep.serverTimestamp + tickResolution : now;
        const maxTimestamps: Record<Id<"players">, number> = lastStep?.clientTimestamps ?? {};
        for (let ts = startTs; ts <= now; ts += tickResolution) {
            while (inputIndex < stepInputs.length) {
                const input = stepInputs[inputIndex];
                if (input.serverTimestamp > ts) {
                    break;
                }
                inputIndex += 1;

                const prevTs = maxTimestamps[input.playerId] ?? input.clientTimestamp;
                maxTimestamps[input.playerId] = Math.max(prevTs, input.clientTimestamp);
                gameState.handleInput(input);
            }
            // Advance the game state to `ts`.
            gameState.tick(ts, tickResolution);
        }
        if (inputIndex < stepInputs.length) {
            throw new Error("Didn't consume all step inputs?");
        }
        // "Commit" the update by writing back the game state and a new steps checkpoint.
        await gameState.save(ctx.db);
        await ctx.db.insert("steps", {
            worldId: args.worldId,
            clientTimestamps: maxTimestamps,
            serverTimestamp: now,
        });
    }
});

type DirtyUpdate = "insert" | "replace" | "delete";

class GameState {
    world: {_id: Id<"worlds">, width: number, height: number};

    playerInputs: Record<Id<"players">, Doc<"playerInput">>;
    positions: Record<Id<"players">, Doc<"playerPosition">>;

    dirtyPlayerInputs: Record<Id<"players">, DirtyUpdate>;
    dirtyPositions: Record<Id<"players">, DirtyUpdate>;

    static async load(db: DatabaseReader, worldId: Id<"worlds">) {
        const world = await db.get(worldId);
        if (!world) {
            throw new Error(`Nonexistent world ${worldId}`);
        }
        const playerInputs = await db.query("playerInput")
            .withIndex("playerId", q => q.eq("worldId", worldId))
            .collect();
        const positions = await db.query("playerPosition")
            .withIndex("worldId", q => q.eq("worldId", worldId))
            .collect();
        return new GameState(world, playerInputs, positions);
    }

    constructor(
        world: Doc<"worlds">,
        playerInputs: Array<Doc<"playerInput">>,
        positions: Array<Doc<"playerPosition">>,
    ) {
        if (!world.width || !world.height) {
            throw new Error(`Invalid world ${world._id}`);
        }
        this.world = {_id: world._id, height: world.height, width: world.width};

        this.playerInputs = {};
        for (const input of playerInputs) {
            this.playerInputs[input.playerId] = input;
        }
        this.positions = {};
        for (const position of positions) {
            this.positions[position.playerId] = position;
        }
        this.dirtyPlayerInputs = {};
        this.dirtyPositions = {};
    }

    handleInput(input: Doc<"inputQueue">) {
        switch (input.payload.kind) {
            case "startConversation":
                console.warn("Skipping startConversation");
                break;
            case "speak":
                console.warn("Skipping speak");
                break;
            case "endConversation":
                console.warn("Skipping endConversation");
                break;
            case "move":
                this.handleMove(
                    input.worldId,
                    input.playerId,
                    input.clientTimestamp,
                    input.payload.vector,
                )
                break;
            default:
                assertNever(input.payload);
        }
    }

    handleMove(
        worldId: Id<"worlds">,
        playerId: Id<"players">,
        clientTimestamp: number,
        vector: {dx: number, dy: number, dt: number},
    ) {
        const vectorNonzero = vector.dx !== 0 || vector.dy !== 0;
        const existingInput = this.playerInputs[playerId];
        if (existingInput === undefined) {
            if (vectorNonzero) {
                this.playerInputs[playerId] = {
                    _id: "" as any,
                    _creationTime: 0,
                    worldId,
                    playerId,
                    clientTimestamp,
                    vector,
                };
                this.dirtyPlayerInputs[playerId] = "insert";
            }
            return;
        }
        if (clientTimestamp < existingInput.clientTimestamp) {
            throw new Error(`Time going backwards for ${JSON.stringify(existingInput)}`);
        }
        if (vectorNonzero) {
            existingInput.clientTimestamp = clientTimestamp;
            existingInput.vector = vector;
            this.dirtyPlayerInputs[playerId] = "replace";
        } else {
            delete this.playerInputs[playerId];
            this.dirtyPlayerInputs[playerId] = "delete";
        }
    }

    tick(ts: number, dt: number) {
        for (const [playerIdS, input] of Object.entries(this.playerInputs)) {
            const playerId = playerIdS as Id<"players">;
            const position = this.positions[playerId];
            if (!position) {
                throw new Error(`Missing position for ${input.playerId}`);
            }
            const normalizedVector = {
                dx: input.vector.dx / input.vector.dt,
                dy: input.vector.dy / input.vector.dt,
            };
            position.x = clamp(position.x + normalizedVector.dx * dt, 0, this.world.width);
            position.y = clamp(position.y + normalizedVector.dy * dt, 0, this.world.height);
            position.dx = normalizedVector.dx;
            position.dy = normalizedVector.dy;
            this.dirtyPositions[playerId] = "replace";
        }
    }

    async save(db: DatabaseWriter) {
        for (const [playerIdS, update] of Object.entries(this.dirtyPlayerInputs)) {
            const playerId = playerIdS as Id<"players">;
            const doc = this.playerInputs[playerId]!;
            switch (update) {
                case "insert":
                    const { _id, _creationTime, ...insert } = doc;
                    await db.insert("playerInput", insert);
                case "replace":
                    await db.replace(doc._id, doc);
                    break;
                case "delete":
                    await db.delete(doc._id);
                    break;
                default:
                    assertNever(update);
            }
        }
        this.dirtyPlayerInputs = {};

        for (const [playerIdS, update] of Object.entries(this.dirtyPositions)) {
            const playerId = playerIdS as Id<"players">;
            const doc = this.positions[playerId]!;
            switch (update) {
                case "insert":
                    const { _id, _creationTime, ...insert } = doc;
                    await db.insert("playerPosition", insert);
                case "replace":
                    await db.replace(doc._id, doc);
                    break;
                case "delete":
                    await db.delete(doc._id);
                    break;
                default:
                    assertNever(update);
            }
        }
        this.dirtyPositions = {};
    }
}

// TODO:
// [ ] Smarter dt if ticks haven't been running
// [ ] Better player input representation for client interpolation
// [ ] Find a way to get client/server timestamps out of playerInput table
// [ ] playerInput is a confusing name... "current input?"
// [ ] Should we be mutating `steps`, not appending?
// [ ] Or maybe compacting in the background into a replay?
//
// Features:
// # Movement
// [ ] Wire up positions to UI
// [ ] Add collision detection to movement
// [ ] Add user interactivity to move around with keyboard input
// [ ] Add interpolation
//
// # Conversations
// [ ] Create conversation entity
// [ ] Allow players to join and leave a conversation
// [ ] End an empty and idle conversation
// [ ] UI can list conversation history on demand
//
// # AI
// [ ] Decide if AI agents should be part of tick or separate
//     - Separate tick loop
//     - One global process of deciding who starts walking towards each other
//     - Otherwise very local?
//     - state machine oriented rather than async/await
// [ ] In either case, all API calls should return data through inputs
// [ ] May make sense to pull this out for AIKit!
// [ ] Port stuff from conversation.ts
//
// # Replays
// [ ] Replay input queue + step stream
// [ ] Find a way to help tick to be deterministic