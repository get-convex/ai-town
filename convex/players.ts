import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { characters, world } from "./schema";
import { objmap } from "./map";
import { distance } from "./geometry";
import { GameState, insertInput } from "./engine";

export const addPlayer = mutation({
    args: {
        name: v.string(),
    },
    handler: async (ctx, args) => {
        const otherPlayers = await ctx.db
            .query("players")
            .collect();
        let position;
        for (let i = 0; i < 100; i++) {
            const candidate = {
                x: Math.floor(Math.random() * world.width),
                y: Math.floor(Math.random() * world.height),
            };
            if (objmap[candidate.y][candidate.x] !== -1) {
                continue;
            }
            for (const player of otherPlayers) {
                if (distance(candidate, player.position) < 1) {
                    continue;
                }
            }
            position = candidate;
            break;
        }
        if (!position) {
            throw new Error(`Failed to find a free position!`);
        }
        return ctx.db.insert("players", {
            name: args.name,
            character: Math.floor(Math.random() * characters.length),
            position,
            orientation: 0,
        });
    }
})

export const addManyPlayers = mutation({
    handler: async (ctx) => {
        const orig = await ctx.db.query("players").collect();
        for (let j = 0; j < 10; j++) {
            const otherPlayers = await ctx.db
                .query("players")
                .collect();
            let position;
            for (let i = 0; i < 100; i++) {
                const candidate = {
                    x: Math.floor(Math.random() * world.width),
                    y: Math.floor(Math.random() * world.height),
                };
                if (objmap[candidate.y][candidate.x] !== -1) {
                    continue;
                }
                for (const player of otherPlayers) {
                    if (distance(candidate, player.position) < 1) {
                        continue;
                    }
                }
                position = candidate;
                break;
            }
            if (!position) {
                throw new Error(`Failed to find a free position!`);
            }
            await ctx.db.insert("players", {
                name: `robot${orig.length + j}`,
                character: Math.floor(Math.random() * characters.length),
                position,
                orientation: 0,
            });
        }
    }
})

export const randomPositions = mutation({
    args: {
        max: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const gameState = await GameState.load(Date.now(), ctx.db);
        let inserted = 0;
        for (const player of Object.values(gameState.players)) {
            if (args.max && inserted >= args.max) {
                break;
            }
            let position;
            for (let i = 0; i < 10; i++) {
                const candidate = {
                    x: Math.floor(Math.random() * world.width),
                    y: Math.floor(Math.random() * world.height),
                };
                const collision = gameState.blocked(candidate, player);
                if (collision !== null) {
                    console.warn(`Candidate ${JSON.stringify(candidate)} failed for ${player.name}: ${collision}`);
                    continue;
                }
                position = candidate;
                break;
            }
            if (!position) {
                console.error(`Failed to find a free position for ${player.name}!`);
                continue;
            }
            await insertInput(ctx.db, player._id, position);
            inserted += 1;
        }
    }
})
