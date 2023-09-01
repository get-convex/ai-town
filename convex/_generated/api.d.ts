/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * Generated by convex@1.1.1.
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as agent from "../agent";
import type * as characterdata_data from "../characterdata/data";
import type * as characterdata_spritesheets_f1 from "../characterdata/spritesheets/f1";
import type * as characterdata_spritesheets_f2 from "../characterdata/spritesheets/f2";
import type * as characterdata_spritesheets_f3 from "../characterdata/spritesheets/f3";
import type * as characterdata_spritesheets_f4 from "../characterdata/spritesheets/f4";
import type * as characterdata_spritesheets_f5 from "../characterdata/spritesheets/f5";
import type * as characterdata_spritesheets_f6 from "../characterdata/spritesheets/f6";
import type * as characterdata_spritesheets_f7 from "../characterdata/spritesheets/f7";
import type * as characterdata_spritesheets_f8 from "../characterdata/spritesheets/f8";
import type * as characterdata_spritesheets_p1 from "../characterdata/spritesheets/p1";
import type * as characterdata_spritesheets_p2 from "../characterdata/spritesheets/p2";
import type * as characterdata_spritesheets_p3 from "../characterdata/spritesheets/p3";
import type * as characterdata_spritesheets_player from "../characterdata/spritesheets/player";
import type * as chat from "../chat";
import type * as config from "../config";
import type * as conversation from "../conversation";
import type * as crons from "../crons";
import type * as engine from "../engine";
import type * as http from "../http";
import type * as init from "../init";
import type * as journal from "../journal";
import type * as lib_cached_llm from "../lib/cached_llm";
import type * as lib_memory from "../lib/memory";
import type * as lib_migrations from "../lib/migrations";
import type * as lib_openai from "../lib/openai";
import type * as lib_physics from "../lib/physics";
import type * as lib_pinecone from "../lib/pinecone";
import type * as lib_replicate from "../lib/replicate";
import type * as lib_routing from "../lib/routing";
import type * as lib_utils from "../lib/utils";
import type * as maps_firstmap from "../maps/firstmap";
import type * as maps_mage from "../maps/mage";
import type * as maps_mage2 from "../maps/mage2";
import type * as maps_mage3 from "../maps/mage3";
import type * as maps_map from "../maps/map";
import type * as maps_map2 from "../maps/map2";
import type * as music from "../music";
import type * as players from "../players";
import type * as testing from "../testing";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  agent: typeof agent;
  "characterdata/data": typeof characterdata_data;
  "characterdata/spritesheets/f1": typeof characterdata_spritesheets_f1;
  "characterdata/spritesheets/f2": typeof characterdata_spritesheets_f2;
  "characterdata/spritesheets/f3": typeof characterdata_spritesheets_f3;
  "characterdata/spritesheets/f4": typeof characterdata_spritesheets_f4;
  "characterdata/spritesheets/f5": typeof characterdata_spritesheets_f5;
  "characterdata/spritesheets/f6": typeof characterdata_spritesheets_f6;
  "characterdata/spritesheets/f7": typeof characterdata_spritesheets_f7;
  "characterdata/spritesheets/f8": typeof characterdata_spritesheets_f8;
  "characterdata/spritesheets/p1": typeof characterdata_spritesheets_p1;
  "characterdata/spritesheets/p2": typeof characterdata_spritesheets_p2;
  "characterdata/spritesheets/p3": typeof characterdata_spritesheets_p3;
  "characterdata/spritesheets/player": typeof characterdata_spritesheets_player;
  chat: typeof chat;
  config: typeof config;
  conversation: typeof conversation;
  crons: typeof crons;
  engine: typeof engine;
  http: typeof http;
  init: typeof init;
  journal: typeof journal;
  "lib/cached_llm": typeof lib_cached_llm;
  "lib/memory": typeof lib_memory;
  "lib/migrations": typeof lib_migrations;
  "lib/openai": typeof lib_openai;
  "lib/physics": typeof lib_physics;
  "lib/pinecone": typeof lib_pinecone;
  "lib/replicate": typeof lib_replicate;
  "lib/routing": typeof lib_routing;
  "lib/utils": typeof lib_utils;
  "maps/firstmap": typeof maps_firstmap;
  "maps/mage": typeof maps_mage;
  "maps/mage2": typeof maps_mage2;
  "maps/mage3": typeof maps_mage3;
  "maps/map": typeof maps_map;
  "maps/map2": typeof maps_map2;
  music: typeof music;
  players: typeof players;
  testing: typeof testing;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
