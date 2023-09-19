import { defineTable } from 'convex/server';
import { convexToJson, v } from 'convex/values';
import {
  ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from '../../_generated/server';
import { internal } from '../../_generated/api';
import * as openai from './openai';
import { Id } from '../../_generated/dataModel';

export const debugFetchEmbeddings = internalAction({
  args: { owner: v.id('players'), texts: v.array(v.string()) },
  handler: async (ctx, args): Promise<any> => {
    return await fetchEmbeddingsBatchWithCache(ctx, args.owner, args.texts, { write: true });
  },
});

export async function fetchEmbeddingsBatchWithCache(
  ctx: ActionCtx,
  owner: Id<'players'>,
  texts: string[],
  opts: { write: boolean } = { write: false },
) {
  const start = Date.now();

  const textEncoder = new TextEncoder();
  const textHashes: Array<ArrayBuffer> = [];
  for (const text of texts) {
    const buf = textEncoder.encode(text);
    const textHash = await crypto.subtle.digest('SHA-256', buf);
    console.log(convexToJson(textHash));
    textHashes.push(textHash);
  }
  const results = new Array(texts.length);
  const cacheResults = await ctx.runQuery(internal.agent.lib.embeddings.getEmbeddingsByText, {
    textHashes,
  });
  for (const { index, embedding } of cacheResults) {
    results[index] = embedding;
  }
  if (cacheResults.length < texts.length) {
    const missingIndexes = [...results.keys()].filter((i) => !results[i]);
    const missingTexts = missingIndexes.map((i) => texts[i]);
    const response = await openai.fetchEmbeddingBatch(missingTexts);
    if (response.embeddings.length !== missingIndexes.length) {
      throw new Error(
        `Expected ${missingIndexes.length} embeddings, got ${response.embeddings.length}`,
      );
    }
    for (let i = 0; i < missingIndexes.length; i++) {
      const resultIndex = missingIndexes[i];
      results[resultIndex] = response.embeddings[i];
    }
    if (opts.write) {
      const embeddings = missingIndexes.map((resultIndex, i) => {
        return {
          owner,
          text: texts[resultIndex],
          textHash: textHashes[resultIndex],
          embedding: response.embeddings[i],
        };
      });
      await ctx.runMutation(internal.agent.lib.embeddings.writeEmbeddings, {
        embeddings,
      });
    }
  }
  return {
    embeddings: results,
    hits: cacheResults.length,
    ms: Date.now() - start,
  };
}

export const writeEmbeddings = internalMutation({
  args: {
    embeddings: v.array(
      v.object({
        owner: v.id('players'),
        text: v.string(),
        textHash: v.bytes(),
        embedding: v.array(v.float64()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const embedding of args.embeddings) {
      await ctx.db.insert('embeddings', embedding);
    }
  },
});

export const getEmbeddingsByText = internalQuery({
  args: { textHashes: v.array(v.bytes()) },
  handler: async (ctx, args) => {
    const out = [];
    for (let i = 0; i < args.textHashes.length; i++) {
      const textHash = args.textHashes[i];
      const result = await ctx.db
        .query('embeddings')
        .withIndex('text', (q) => q.eq('textHash', textHash))
        .first();
      if (result) {
        out.push({ index: i, embedding: result.embedding });
      }
    }
    return out;
  },
});

const embeddings = v.object({
  owner: v.id('players'),
  text: v.string(),
  textHash: v.bytes(),
  embedding: v.array(v.float64()),
});

export const embeddingsTables = {
  embeddings: defineTable(embeddings)
    .index('text', ['textHash'])
    .vectorIndex('embedding', {
      vectorField: 'embedding',
      filterFields: ['owner'],
      dimensions: 1536,
    }),
};
