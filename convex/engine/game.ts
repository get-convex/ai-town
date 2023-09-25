import { Infer, Validator } from 'convex/values';
import { Id } from '../_generated/dataModel';
import { MutationCtx } from '../_generated/server';
import { assertNever } from '../util/assertNever';

export type InputHandler<Args extends any, ReturnValue extends any> = {
  args: Validator<Args, false, any>;
  returnValue: Validator<ReturnValue, false, any>;
};

export type InputHandlers = Record<string, InputHandler<any, any>>;

export abstract class Game<Handlers extends InputHandlers> {
  abstract worldId: Id<'worlds'>;

  abstract tickDuration: number;
  abstract stepDuration: number;
  abstract maxTicksPerStep: number;
  abstract maxInputsPerStep: number;

  abstract handleInput(
    now: number,
    name: keyof Handlers,
    args: Infer<Handlers[typeof name]['args']>,
  ): Promise<Infer<Handlers[typeof name]['returnValue']>>;

  abstract tick(now: number): void;
  abstract save(): Promise<void>;
  idleUntil(): null | number {
    return null;
  }

  async runStep(ctx: MutationCtx, generationNumber: number) {
    const world = await ctx.db.get(this.worldId);
    if (!world) {
      throw new Error(`Invalid world ID: ${this.worldId}`);
    }
    if (!world.active) {
      throw new Error(`World ${this.worldId} is not active, returning immediately.`);
    }
    if (world.generationNumber !== generationNumber) {
      throw new Error(
        `Generation mismatch (${generationNumber} vs. ${world.generationNumber}), returning`,
      );
    }
    const now = Date.now();
    if (world.currentTime && now < world.currentTime) {
      throw new Error(`Server time moving backwards: ${now} < ${world.currentTime}`);
    }

    // Collect the inputs for our step, sorting them by receipt time.
    const inputs = await ctx.db
      .query('inputs2')
      .withIndex('byInputNumber', (q) =>
        q.eq('worldId', this.worldId).gt('number', world.processedInputNumber ?? -1),
      )
      .take(this.maxInputsPerStep);

    const startTs = world.currentTime ? world.currentTime + this.tickDuration : now;
    let currentTs = startTs;
    let inputIndex = 0;
    let numTicks = 0;
    let processedInputNumber = world.processedInputNumber;
    while (true) {
      if (numTicks > this.maxTicksPerStep) {
        break;
      }
      numTicks += 1;

      // Collect all of the inputs for this tick.
      const tickInputs = [];
      while (inputIndex < inputs.length) {
        const input = inputs[inputIndex];
        if (input.received > currentTs) {
          break;
        }
        inputIndex += 1;
        processedInputNumber = input.number;
        tickInputs.push(input);
      }

      // Feed the inputs to the game.
      for (const input of tickInputs) {
        try {
          const value = await this.handleInput(currentTs, input.name, input.args);
          input.returnValue = { kind: 'ok', value };
        } catch (e: any) {
          console.error(`Input ${input._id} failed: ${e.message}`);
          input.returnValue = { kind: 'error', message: e.message };
        }
        await ctx.db.replace(input._id, input);
      }

      // Simulate the game forward one tick.
      this.tick(currentTs);

      // Decide how to advance time.
      let candidateTs = currentTs + this.tickDuration;
      let idleUntil = this.idleUntil();
      if (idleUntil) {
        if (inputIndex < inputs.length) {
          idleUntil = Math.min(idleUntil, inputs[inputIndex].received);
        }
        idleUntil = Math.min(idleUntil, now);
        console.log(`Engine idle, advancing time to ${idleUntil}`);
        candidateTs = idleUntil;
      }
      if (now < candidateTs) {
        break;
      }
      currentTs = candidateTs;
    }

    // Commit the step by moving time forward, consuming our inputs, and saving the game's state.
    await ctx.db.patch(world._id, { currentTime: currentTs, processedInputNumber });
    await this.save();

    let idleUntil = this.idleUntil();

    // Force an immediate wakeup if we have more inputs to process or more time to simulate.
    if (inputs.length === this.maxInputsPerStep) {
      console.warn(`Received max inputs (${this.maxInputsPerStep}) for step`);
      idleUntil = null;
    }
    if (numTicks === this.maxTicksPerStep) {
      console.warn(`Only simulating ${currentTs - startTs}ms due to max ticks per step limit.`);
      idleUntil = null;
    }
    const toSleep = idleUntil ? idleUntil - now : this.stepDuration;

    // Let the caller reschedule us since we don't have a reference to ourself in `api`.
    return {
      generationNumber,
      toSleep,
    };
  }
}

export async function insertInput(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  name: string,
  args: any,
): Promise<Id<'inputs2'>> {
  const prevInput = await ctx.db
    .query('inputs2')
    .withIndex('byInputNumber', (q) => q.eq('worldId', worldId))
    .order('desc')
    .first();
  const number = prevInput ? prevInput.number + 1 : 0;
  const inputId = await ctx.db.insert('inputs2', {
    worldId,
    number,
    name,
    args,
    received: Date.now(),
  });
  return inputId;
}
