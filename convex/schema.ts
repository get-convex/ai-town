import { defineSchema } from "convex/server";
import { bgtiles, objmap, tiledim, tilefiledim, tilesetpath } from "./data/map";
import { engineTables } from "./schema/engine";
import { playersTables } from "./schema/players";
import { conversationsTables } from "./schema/conversations";

export default defineSchema({
    ...engineTables,
    ...playersTables,
    ...conversationsTables,
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
export { characters } from "./data/characters";
