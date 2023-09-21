Instructions:

1. `npx convex dev` to start up a new deployment.
2. Set `OPENAI_API_KEY` and `CLERK_ISSUER_URL` in your dev deployment's environment variables.
3. Open up the game at `http://localhost:5173/ai-town`.
4. Run `engine:step` in the dashboard with `{ reschedule: 1000 }` to start the game loop. You should see the debug buffer health in the top-right become a sawtooth pattern centered around ~750ms.
5. Run `agent/classic/init:initializeAgents` with `{ count: 8 }` to start eight AI agents. You can follow along with what they're doing in the log view.
6. To stop the game, first run `agent/classic/debug:clearAllLeases` to signal to the agents that they should stop.
7. "Cancel All" scheduled functions in the "Schedules" view in the dashboard.
8. Repeatedly run `debug:clear` until it returns "ok!" to clear all game state.
