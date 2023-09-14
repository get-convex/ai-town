import { v } from 'convex/values';

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

export const path = v.array(v.object({ position: point, vector: vector, t: v.number() }));
export type Path = typeof path.type;
