import { defineTable } from "convex/server";
import { v } from "convex/values";

// API
// start conversation
// invite to conversation
// accept invite
// reject invite
// -> implicitly join when close enough, rotates orientation
// - startTyping
// - startMessage(hasMore:?)
// - appendMessage (out of band)
// - finishMessage
// leave conversation
// ## Conversation state
const conversations = defineTable({
    creator: v.id("players"),
    typing: v.optional(v.id("players")),
    finished: v.optional(v.number()),
});

const conversationMembers = defineTable({
    conversationId: v.id("conversations"),
    playerId: v.id("players"),
    status: v.union(
        v.literal("invited"),
        v.literal("walkingOver"),
        v.literal("participating")
    ),
});

const messages = defineTable({
    conversation: v.id("conversations"),
    author: v.id("players"),
    doneWriting: v.boolean(),
});

// Separate out the actual message text to be state not managed by the game engine. This way we can
// append chunks to it out of band when streaming in tokens from OpenAI.
const messageText = defineTable({
    message: v.id("messages"),
    text: v.string(),
});

export const conversationsTables = {
    conversations: conversations
        .index("finished", ["finished"]),
    conversationMembers: conversationMembers
        .index("conversationid", ["conversationId"]),
    messages: messages
        .index("conversation", ["conversation", "doneWriting"]),
    messageText: messageText
        .index("message", ["message"]),
};
