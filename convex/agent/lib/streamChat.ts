import { v } from 'convex/values';
import { ActionCtx, internalMutation } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';
import { sendInput } from './actions';
import { ChatCompletionContent } from './openai';
import { sleep } from '../../util/sleep';
import { internal } from '../../_generated/api';

export async function streamChat(
  ctx: ActionCtx,
  playerId: Id<'players'>,
  conversationId: Id<'conversations'>,
  content: ChatCompletionContent,
  chunkSize: number = 4,
  chunksPerSec: number = 12,
) {
  async function* streamChunks() {
    let fragments = [];
    let fragmentsLen = 0;
    let lastEmitted = null;
    for await (const fragment of content.read()) {
      fragments.push(fragment);
      fragmentsLen += fragment.length;
      if (fragmentsLen >= chunkSize) {
        const now = Date.now();
        if (lastEmitted) {
          const deadline = lastEmitted + 1000 / chunksPerSec;
          if (now < deadline) {
            const toSleep = deadline - now;
            await sleep(toSleep);
          }
        }
        yield fragments.join('');
        fragments = [];
        fragmentsLen = 0;
        lastEmitted = now;
      }
    }
    if (fragmentsLen > 0) {
      yield fragments.join('');
    }
  }
  let messageId: Id<'messages'> | undefined;
  try {
    for await (const chunk of streamChunks()) {
      if (!messageId) {
        messageId = await sendInput(ctx, 'writeMessage', {
          conversationId,
          playerId,
          message: chunk,
          doneWriting: false,
        });
        continue;
      }
      await ctx.runMutation(internal.agent.lib.streamChat.writeFragment, {
        messageId,
        text: chunk,
      });
    }
  } finally {
    if (messageId) {
      await sendInput(ctx, 'finishWriting', {
        playerId,
        messageId,
      });
    }
  }
}

export const writeFragment = internalMutation({
  args: {
    messageId: v.id('messages'),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('messageText', args);
  },
});
