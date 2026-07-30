import { Codex } from "@openai/codex-sdk";
import type { KnownReasoningEffort } from "./api-schema.js";

export type CodexRunResult = unknown;

export type CodexStreamedResult = {
  events: AsyncIterable<unknown>;
};

export type CodexThread = {
  id?: string | null;
  threadId?: string;
  run(prompt: string, options?: unknown): Promise<CodexRunResult>;
  runStreamed?(prompt: string, options?: unknown): Promise<CodexStreamedResult>;
};

export type CodexThreadOptions = {
  approvalPolicy?: "never" | "on-request" | "on-failure" | "untrusted";
  model?: string;
  modelReasoningEffort?: KnownReasoningEffort;
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
};

export type CodexClient = {
  startThread(options?: CodexThreadOptions): CodexThread;
  resumeThread(threadId: string, options?: CodexThreadOptions): CodexThread;
};

export function createCodexClient(): CodexClient {
  return new Codex() as CodexClient;
}

export function getThreadId(thread: CodexThread) {
  return thread.id ?? thread.threadId ?? undefined;
}

export function stringifyRunResult(result: CodexRunResult) {
  if (typeof result === "string") {
    return result;
  }

  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    const knownText =
      record.finalResponse ??
      record.final_response ??
      record.outputText ??
      record.output_text ??
      record.text;

    if (typeof knownText === "string") {
      return knownText;
    }
  }

  return JSON.stringify(result, null, 2);
}

export function extractStreamText(event: unknown) {
  if (!event || typeof event !== "object") {
    return undefined;
  }

  const record = event as Record<string, unknown>;
  const item =
    record.item && typeof record.item === "object"
      ? (record.item as Record<string, unknown>)
      : undefined;
  const candidate =
    record.delta ??
    record.text ??
    record.message ??
    item?.text ??
    item?.aggregated_output ??
    item?.command;

  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

export function classifyStreamEvent(
  event: unknown,
): "assistant" | "reasoning" | "tool" | "status" | "error" {
  if (!event || typeof event !== "object") {
    return "status";
  }

  const record = event as Record<string, unknown>;
  if (record.type === "error" || record.type === "turn.failed") {
    return "error";
  }

  const item =
    record.item && typeof record.item === "object"
      ? (record.item as Record<string, unknown>)
      : undefined;
  switch (item?.type) {
    case "agent_message":
      return "assistant";
    case "reasoning":
      return "reasoning";
    case "command_execution":
    case "file_change":
    case "mcp_tool_call":
    case "web_search":
      return "tool";
    default:
      return "status";
  }
}
