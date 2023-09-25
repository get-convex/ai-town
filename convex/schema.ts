import { defineSchema } from 'convex/server';
import { gameTables } from './game/schema';
import { worlds } from './world';

export default defineSchema({
  worlds,
  ...gameTables,
});
