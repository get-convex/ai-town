import { defineTable } from 'convex/server';
import { convexToJson, v } from 'convex/values';
import {
  ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from '../../_generated/server';
import { internal } from '../../_generated/api';
import * as openai from '../lib/openai';
import { Id } from '../../_generated/dataModel';

const selfInternal = internal.agent.classic.embeddings;

export const debugFetchEmbeddings = internalAction({
  args: { tag1: v.optional(v.string()), tag2: v.optional(v.string()), texts: v.array(v.string()) },
  handler: async (ctx, args): Promise<any> => {
    return await fetchBatch(ctx, args.texts);
  },
});

export async function insert(ctx: ActionCtx, text: string, tag1?: string, tag2?: string) {
  const textHash = await hashText(text);
  let embedding;
  const [result] = await ctx.runQuery(selfInternal.getEmbeddingsByText, { textHashes: [textHash] });
  if (result !== undefined) {
    embedding = result.embedding;
    if (result.tag1 == tag1 || result.tag2 == tag2) {
      return result.embeddingId;
    }
  }
  if (!embedding) {
    const response = await openai.fetchEmbedding(text);
    embedding = response.embedding;
  }
  const insertion = { tag1, tag2, text, textHash, embedding };
  const [embeddingId] = await ctx.runMutation(selfInternal.writeEmbeddings, {
    embeddings: [insertion],
  });
  return embeddingId;
}

export async function fetchBatch(ctx: ActionCtx, texts: string[]) {
  const start = Date.now();

  const textHashes = await Promise.all(texts.map((text) => hashText(text)));
  const results = new Array<{ embeddingId?: Id<'embeddings'>; embedding: number[] }>(texts.length);
  const cacheResults = await ctx.runQuery(internal.agent.classic.embeddings.getEmbeddingsByText, {
    textHashes,
  });
  for (const { index, embeddingId, embedding } of cacheResults) {
    results[index] = { embeddingId, embedding };
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
      results[resultIndex] = { embedding: response.embeddings[i] };
    }
  }
  return {
    embeddings: results,
    hits: cacheResults.length,
    ms: Date.now() - start,
  };
}

async function hashText(text: string) {
  const textEncoder = new TextEncoder();
  const buf = textEncoder.encode(text);
  const textHash = await crypto.subtle.digest('SHA-256', buf);
  return textHash;
}

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
        out.push({
          index: i,
          embeddingId: result._id,
          embedding: result.embedding,
          tag1: result.tag1,
          tag2: result.tag2,
        });
      }
    }
    return out;
  },
});

export const writeEmbeddings = internalMutation({
  args: {
    embeddings: v.array(
      v.object({
        tag1: v.optional(v.string()),
        tag2: v.optional(v.string()),
        text: v.string(),
        textHash: v.bytes(),
        embedding: v.array(v.float64()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const ids = [];
    for (const embedding of args.embeddings) {
      ids.push(await ctx.db.insert('embeddings', embedding));
    }
    return ids;
  },
});

const embeddings = v.object({
  // Unstructured tags for filtering.
  tag1: v.optional(v.string()),
  tag2: v.optional(v.string()),

  text: v.string(),
  textHash: v.bytes(),

  embedding: v.array(v.float64()),
});

export const embeddingsTables = {
  embeddings: defineTable(embeddings)
    .index('text', ['textHash'])
    .vectorIndex('embedding', {
      vectorField: 'embedding',
      filterFields: ['tag1', 'tag2'],
      dimensions: 1536,
    }),
};
