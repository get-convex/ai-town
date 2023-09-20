import { ActionCtx } from '../../_generated/server';
import { api } from '../../_generated/api';
import { InputArgs, InputReturnValue, inputHandlers } from '../../schema/input';

export async function sendInput<Name extends keyof typeof inputHandlers>(
  ctx: ActionCtx,
  name: Name,
  args: InputArgs<Name>,
): Promise<InputReturnValue<Name>> {
  const { inputId, serverTimestamp } = await ctx.runMutation(api.engine.sendInput, {
    inputArgs: {
      kind: name,
      args: args as any,
    },
  });
  // TODO: Would love to have a way to subscribe on the input result.
  let backoff = 128;
  for (let i = 0; i < 8; i++) {
    const queryResult = await ctx.runQuery(api.engine.inputStatus, { inputId });
    if (queryResult.status === 'notFound') {
      throw new Error(`Input ${inputId} not found!`);
    }
    if (queryResult.status === 'processing') {
      await new Promise((resolve) => setTimeout(resolve, backoff));
      backoff = Math.min(backoff * 2, 8192);
      continue;
    }
    if (queryResult.status === 'done') {
      const r = queryResult.returnValue;
      if (!r) {
        throw new Error(`Input ${inputId} returned no value!`);
      }
      if (r.kind !== name) {
        throw new Error(`Expected input ${inputId} to return ${name}, but got ${r.kind}!`);
      }
      if ((r.returnValue as any).err !== undefined) {
        throw new Error((r.returnValue as any).message);
      }
      if ((r.returnValue as any).ok === undefined) {
        throw new Error(`Input ${inputId} returned neither ok nor err!`);
      }
      return (r.returnValue as any).ok;
    }
  }
  throw new Error(`Timed out waiting for ${inputId}`);
}
