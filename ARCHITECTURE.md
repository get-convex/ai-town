# Architecture

This documents dives into the high-level architecture of AI Town and its different layers. We'll
first start with a brief overview and then go in-depth on each component. The overview should
be sufficient for forking AI Town and changing game or agent behavior. Read on to the deep dives
if you're interested or running up against the engine's limitations.

This doc assumes the reader has a working knowledge of Convex. If you're new to Convex, check out
the [Convex tutorial](https://docs.convex.dev/get-started) to get started.

## Overview

AI Town is split into a few layers:

- The server-side game logic in `convex/game`: This layer defines what state AI Town maintains,
  how it evolves over time, and how it reacts to user input. Humans and AI agents are
  indistinguishable to this layer: Both just submit inputs that the game engine processes.
- The client-side game UI in `src/`: AI Town uses `pixi-react` to render the game state to the
  browser for human consumption.
- The game engine in `convex/engine`: To make it easy to hack on the game rules, we've separated
  out the game engine from the game logic. The game engine is responsible for saving and loading
  game state from the database, coordinating feeding inputs into the engine, and actually
  running the game engine in Convex functions.
- The agent in `convex/agent`: Agents run in Convex functions that observe game state and
  submit inputs to the game engine. Agents are responsible for deciding what inputs to submit
  based on the game state. Internally, our agents use a combination of simple rule-based systems
  and talking to an LLM.

So, if you'd like to tweak agent behavior but keep the same game mechanics, check out `convex/agent`.
If you would like to add new gameplay elements (that both humans and agents can interact with), add
the feature to `convex/game`, render it in the UI in `src/`, and then add agent behavior in `convex/agent`.

## AI Town game logic (`convex/game`)

### Data model

AI Town's data model has a few concepts:

- Players (`convex/game/players.ts`) are the core characters in the game and stored in the `players` table.
  Players have human readable names and descriptions, and they may be associated with a human user.
  At any point in time, a player may be pathfinding towards some destination and has a current location.
- Locations (`convex/game/locations.ts`) keep track of a player's position, orientation, and velocity
  in the `locations` table. We store the orientation as a normalized vector.
- Conversations (`convex/game/conversations.ts`) are created by a player and end at some point in time.
- Conversation memberships (`convex/game/conversationMembers.ts`) indicate that a player is a member
  of a conversation. Players may only be in one active conversation at any point in time, and conversations
  currently have exactly two members. Memberships may be in one of four states:
  - `invited`: The player has been invited to the conversation but hasn't accepted yet.
  - `walkingOver`: The player has accepted the invite to the conversation but is too far away to talk. The
    player will automatically join the conversation when they get close enough.
  - `participating`: The player is actively participating in the conversation.
  - `left`: The player has left the conversation, and we keep the row around for historical queries.

### Inputs (`convex/game/inputs.ts`)

AI Town modifies its data model by processing inputs. Inputs are submitted by players and agents and
processed by the game engine. We specify inputs in the `inputs` object in `convex/game/inputs.ts`, specifying
the expected arguments and return value types with a Convex validator. With these validators, we can ensure
end-to-end type-safety both in the client and in agents.

- Joining (`join`) and leaving (`leave`) the game.
- Moving a player to a particular location (`moveTo`): Movement in AI Town is similar to RTS games, where
  the players specify where they want to go, and the engine figures out how to get there.
- Starting a conversation (`startConversation`), accepting an invite (`acceptInvite`), rejecting an invite
  (`rejectInvite`), and leaving a conversation (`leaveConversation`).

Each of these inputs' implementations is in the `AiTown.handleInput` method in `convex/game/aiTown.ts`. Each
implementation method checks invariants and updates game state as desired. For example, the `moveTo` input
checks that the player isn't participating in a conversation, throwing an error telling them to leave
the conversation first if so, and then updates their pathfinding state with the desired destination.

### Simulation

Other than when processing player inputs, the game state can change over time as the simulation runs time
forward. For example, if the player has decided to move along a path, their position will gradually update
as time moves forward. Similarly, if two players collide into each other, they'll notice and replan their
paths, trying to avoid obstacles.

### Message data model

We manage the tables for tracking chat messages in separate tables not affiliated with the game engine.

- Messages (`convex/schema.ts`) are in a conversation and indicate an author and message text.
- Each conversation has a typing indicator (`convex/schema.ts`) that indicates that a player
  is currently typing. Players can still send messages while another player is typing, but
  having the indicator helps agents (and humans) not talk over each other.

These tables are queried and modified with regular Convex queries and mutations that don't directly
go through the simulation.

## Game engine (`convex/engine`)

Given the description of AI Town's game behavior in the previous section, the `Game` class in `convex/engine/game.ts`
implements actually running the simulation. The game engine has a few responsibilities:

- Coordinating incoming player inputs, feeding them into the simulation, and sending their return values (or errors) to the client.
- Running the simulation forward in time.
- Saving and loading game state from the database.
- Managing executing the game behavior, efficiently using Convex resources and minimizing input latency.

AI Town's game behavior is implemented in the `AiTown` class, which subclasses the engine's `Game` class.

### Input handling

Users submit inputs through the `insertInput` function, which inserts them into an `inputs` table, assigning a
monotonically increasing unique input number and stamping the input with the time the server received it. The
engine then processes inputs, writing their results back to the `inputs` row. Interested clients can subscribe
on an input's status with the `inputStatus` query.

`Game` provides an abstract method `handleInput` that `AiTown` implements with its specific behavior.

### Running the simulation

`AiTown` specifies how it simulates time forward with the `tick` method:

- `tick(now)` runs the simulation forward until the given timestamp
- Ticks are run at a high frequency, configurable with `tickDuration` (milliseconds). Since AI town has smooth motion,
  it runs at 60 ticks per second.
- It's generally a good idea to break up game logic into separate systems that can be ticked forward independently.
  For example, AI Town's `tick` method advances pathfinding with `tickPathfinding`, player positions with
  `tickPosition`, and conversations with `tickConversation`.

To avoid running a Convex mutation 60 times per second (which would be expensive and slow), the engine batches up
many ticks into a _step_. AI town runs steps at only 1 time per second. Here's how a step works:

1. Load the game state into memory.
2. Decide how long to run.
3. Execute many ticks for our time interval, alternating between feeding in inputs with `handleInput` and advancing
   the simulation with `tick`.
4. Write the updated game state back to the database.

The engine then schedules steps to run periodically. To avoid running steps when the game is idle, games can optionally
declare if the game is currently idle and for how long with the `idleUntil` method. If the game is idle, the engine
will automatically schedule the next step past the idleness period but also wake it up if an input comes in.

One core invariant is that the game engine is fully "single-threaded" per world. As a game developer, you'll never
have to worry about multithreaded or database race conditions: Just write your code the naive way!

### Managing game state

The engine assumes that all game state is in Convex tables, so it's easy to look at (and even modify!) game state
directly on the dashboard. Try it out: run AI town, update a player's name, and see it immediately change in the UI.

However, it's a lot more convenient to write `handleInput` and `tick` as if we're working purely in-memory state.
So, we provide `GameTable`, a class that provides a lightweight ORM for reading data from the database, accessing
it in-memory, and then writing out the rows that have changed at the end of a step.

We want to keep game state relatively small, since it's fully loaded at the beginning of each step. And, the game
engine often only cares about a small "active" subset of game state in the tables. So, subclasses of `GameTable`
can implement an `isActive` method that tells the system when a row is no longer active should be excluded from
game processing. For example, AI Town's `Conversations` class only keeps conversations that are currently active.

### Historical tables

If we're only writing updates out to the database at the end of the step, and steps are only running at once per
second, continuous quantities like position will only update every second. This, then, defeats the whole purpose
of having high-frequency ticks: Player positions will jump around and look choppy.

To solve this, we track the historical values of quantities like position _within_ a step, storing the value
at the end of each tick. Then, the client receives both the current value _and_ the past step's worth of
history, and it can "replay" the history to make the motion smooth.

We assume that most quantities do not need this high-frequency tracking, so developers have to opt into this
by subclassing `HistoricalTable` instead of `GameTable`. There are a few limitations on `HistoricalTable`:

- Historical tables can only have numeric (floating point) values and can't have nested objects or optional fields.
- Historical tables must declare which fields they'd like to track.
- Historical tables must define a `history: v.optional(v.bytes())` field in their schema that the engine uses for packing
  in a buffer of the historical values.

AI Town uses a historical table for `locations`, storing the position, orientation, and velocity as fields.

```ts
export const locations = defineTable({
  // Position.
  x: v.number(),
  y: v.number(),

  // Normalized orientation vector.
  dx: v.number(),
  dy: v.number(),

  // Velocity (in tiles/sec).
  velocity: v.number(),

  // History buffer filled out by `HistoricalTable`.
  history: v.optional(v.bytes()),
});
```

In the future, we'd also like to quantize and compress the historical values to keep the history buffers small, since
they're sent to every observing client on every step for every moving character.

## Client-side game UI (`src/`)

One guiding principle for AI Town's architecture is to keep the usage as close to "regular Convex" usage as possible. So,
game state is stored in regular tables, and the UI just uses regular `useQuery` hooks to load that state and render
it in the UI.

The one exception is for historical tables, which feed in the latest state into a `useHistoricalValue` hook that parses
the history buffer and replays time forward for smooth motion. To keep replayed time synchronized across multiple
historical buffers, we provide a `useHistoricalTime` hook for the top of your app that keeps track of the current
time and returns it for you to pass down into components.

We also provide a `useSendInput` hook that wraps `useMutation` and automatically sends inputs to the server and
waits for the engine to process them and return their outcome.

## Agent architecture (`convex/agent`)

TODO

- decoupled from engine
- mutation event loop

## Design goals and limitations

TODO

- All data loaded into memory each step
- Inputs are fed through the database
- Single threaded
- Optimistic updates
- Input latency
