import { describe, expect, it } from "vitest";
import type { ChatMessage, QueuedThreadInput, ThreadSummary } from "../src/api-schema.js";

import {
  appendOptimisticSteeringMessageToDetail,
  mergeThreadDetailState,
  upsertMessage,
} from "../../../apps/mobile/src/lib/server-state-messages.js";

describe("mobile optimistic queued-input steering state", () => {
  it("shows a steered queued prompt immediately when thread detail is not cached", async () => {
    const thread = threadSummary("thread-steering");
    const input = queuedInput("queued-goal", "/goal Add tests before editing");

    const detail = appendOptimisticSteeringMessageToDetail(undefined, {
      input,
      nowIso: "2026-06-06T00:00:00.000Z",
      thread,
      threadId: thread.id,
    });

    expect(detail?.thread.id).toBe(thread.id);
    expect(detail?.messages.map((message) => [message.role, message.content])).toEqual([
      ["user", input.prompt],
    ]);
  });

  it("replaces the optimistic steering prompt when stream and refresh data arrive", async () => {
    const thread = threadSummary("thread-steering-merge");
    const input = queuedInput("queued-merge", "/goal Keep one message");
    const canonicalMessage = chatMessage("server-user", thread.id, input.prompt);
    const optimisticDetail = appendOptimisticSteeringMessageToDetail(undefined, {
      input,
      nowIso: "2026-06-06T00:00:00.000Z",
      thread,
      threadId: thread.id,
    });

    const streamedMessages = upsertMessage(optimisticDetail?.messages ?? [], canonicalMessage);
    const refreshedDetail = mergeThreadDetailState(
      { thread, messages: streamedMessages, pendingInputRequests: [] },
      { thread, messages: [canonicalMessage], pendingInputRequests: [] },
    );

    expect(refreshedDetail.messages).toHaveLength(1);
    expect(refreshedDetail.messages[0]).toMatchObject({
      content: input.prompt,
      id: canonicalMessage.id,
      role: "user",
    });
  });
});

function threadSummary(id: string): ThreadSummary {
  const now = "2026-06-06T00:00:00.000Z";
  return {
    id,
    title: id,
    createdAt: now,
    updatedAt: now,
    state: "running",
    messageCount: 0,
  };
}

function queuedInput(id: string, prompt: string): QueuedThreadInput {
  return {
    attachments: [],
    id,
    prompt,
    skills: [],
  };
}

function chatMessage(id: string, threadId: string, content: string): ChatMessage {
  return {
    id,
    threadId,
    role: "user",
    kind: "chat",
    content,
    createdAt: "2026-06-06T00:00:00.000Z",
    state: "completed",
  };
}
