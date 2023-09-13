import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { bgtiles, objmap, tiledim, tilefiledim, tilesetpath } from "./map";
import { packedPositionBuffer } from "./positionBuffer";

export const point = v.object({
    x: v.number(),
    y: v.number(),
});
export type Point = typeof point.type;

export const vector = v.object({
    dx: v.number(),
    dy: v.number(),
});
export type Vector = typeof vector.type;

export const path = v.array(v.object({position: point, vector: vector, t: v.number()}));
export type Path = typeof path.type;

const pathfinding = v.object({
    destination: point,
    started: v.number(),
    state: v.union(
        v.object({
            kind: v.literal("needsPath"),
        }),
        v.object({
            kind: v.literal("waiting"),
            until: v.number(),
        }),
        v.object({
            kind: v.literal("moving"),
            path,
        })
    )
});
export type Pathfinding = typeof pathfinding.type;

export default defineSchema({
    // Abstract game engine state.
    inputQueue: defineTable({
        playerId: v.id("players"),
        serverTimestamp: v.number(),
        destination: v.union(point, v.null()),
    })
        .index("clientTimestamp", ["playerId", "serverTimestamp"]),
    steps: defineTable({
        startTs: v.number(),
        endTs: v.number(),
    })
        .index("endTs", ["endTs"]),

    // Game-specific state.
    players: defineTable({
        name: v.string(),
        character: v.number(),

        position: point,
        // Degrees counterclockwise from East / Right.
        orientation: v.number(),

        pathfinding: v.optional(pathfinding),

        previousPositions: v.optional(packedPositionBuffer),
    }),

    // Human interactions.
    humans: defineTable({
        tokenIdentifier: v.string(),
        joined: v.number(),
        playerId: v.optional(v.id("players")),
    }).index("tokenIdentifier", ["tokenIdentifier"]),
});

export const map = {
    tileSetUrl: tilesetpath,
    tileSetDim: tilefiledim,
    tileDim: tiledim,
    bgTiles: bgtiles,
    objectTiles: objmap,
}

export const world = {
    width: bgtiles[0][0].length,
    height: bgtiles[0].length,
}
export const COLLISION_THRESHOLD = 0.75;
export { characters } from "./characterdata/data";
