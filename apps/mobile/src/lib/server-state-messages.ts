import type {
  ChatMessage,
  QueuedThreadInput,
  ThreadDetailResponse,
  ThreadSummary,
} from "codex-relay/api-schema";
import {
  chatMessageDetailsFromPromptContext,
  promptMarkdownWithSkills,
} from "codex-relay/api-schema";

const optimisticSteeringMessageIdPrefix = "optimistic-steering:";

export function appendOptimisticSteeringMessageToDetail(
  current: ThreadDetailResponse | undefined,
  options: {
    input: QueuedThreadInput;
    nowIso: string;
    thread: ThreadSummary | undefined;
    threadId: string;
  },
): ThreadDetailResponse | undefined {
  const thread = current?.thread ?? options.thread;
  if (!thread) {
    return current;
  }
  const message: ChatMessage = {
    id: optimisticSteeringMessageId(options.input.id),
    threadId: options.threadId,
    role: "user",
    kind: "chat",
    content: promptMarkdownWithSkills(options.input.prompt, options.input.skills),
    createdAt: options.nowIso,
    details: chatMessageDetailsFromPromptContext(options.input, {
      optimisticQueuedInputId: options.input.id,
    }),
    state: "completed",
  };
  return {
    thread,
    messages: upsertMessage(current?.messages ?? [], message),
    pendingInputRequests: current?.pendingInputRequests ?? [],
  };
}

export function mergeThreadDetailState(
  current: ThreadDetailResponse | undefined,
  response: ThreadDetailResponse,
) {
  if (!current || current.thread.id !== response.thread.id || current.messages.length === 0) {
    return response;
  }
  const messages = mergeMessages(current.messages, response.messages);
  return {
    ...response,
    messages,
  };
}

export function upsertMessage(messages: ChatMessage[], message: ChatMessage) {
  const existingIndex = messages.findIndex((candidate) => candidate.id === message.id);
  if (existingIndex !== -1) {
    return messages.map((candidate) => (candidate.id === message.id ? message : candidate));
  }
  const replacementId = replacementMessageId(message);
  const replacementIndex = replacementId
    ? messages.findIndex((candidate) => candidate.id === replacementId)
    : -1;
  if (replacementIndex !== -1) {
    return messages.map((candidate, index) => (index === replacementIndex ? message : candidate));
  }
  const optimisticIndex =
    message.role === "user"
      ? messages.findIndex(
          (candidate) =>
            candidate.id.startsWith(optimisticSteeringMessageIdPrefix) &&
            candidate.role === "user" &&
            candidate.content === message.content,
        )
      : -1;
  if (optimisticIndex !== -1) {
    return messages.map((candidate, index) => (index === optimisticIndex ? message : candidate));
  }
  const lastMessage = messages[messages.length - 1];
  if (isDuplicateOptimisticQueuedMessage(lastMessage, message)) {
    return messages.map((candidate, index) =>
      index === messages.length - 1 ? message : candidate,
    );
  }
  return [...messages, message];
}

function optimisticSteeringMessageId(inputId: string) {
  return `${optimisticSteeringMessageIdPrefix}${inputId}`;
}

function mergeMessages(baseMessages: ChatMessage[], incomingMessages: ChatMessage[]) {
  const incomingById = new Map(incomingMessages.map((message) => [message.id, message]));
  const indexesById = new Map<string, number>();
  const seenIds = new Set<string>();
  const messages: ChatMessage[] = [];
  for (const candidate of [...baseMessages, ...incomingMessages]) {
    const message = incomingById.get(candidate.id) ?? candidate;
    if (seenIds.has(message.id)) {
      continue;
    }
    const replacementId = replacementMessageId(message);
    if (replacementId) {
      const replacementIndex = indexesById.get(replacementId);
      if (replacementIndex !== undefined) {
        messages[replacementIndex] = message;
        seenIds.delete(replacementId);
        seenIds.add(message.id);
        indexesById.delete(replacementId);
        indexesById.set(message.id, replacementIndex);
        continue;
      }
    }
    const lastMessage = messages[messages.length - 1];
    if (isDuplicateOptimisticQueuedMessage(lastMessage, message)) {
      messages[messages.length - 1] = message;
      seenIds.delete(lastMessage.id);
      seenIds.add(message.id);
      indexesById.delete(lastMessage.id);
      indexesById.set(message.id, messages.length - 1);
      continue;
    }
    seenIds.add(message.id);
    indexesById.set(message.id, messages.length);
    messages.push(message);
  }
  return messages;
}

function isDuplicateOptimisticQueuedMessage(
  previous: ChatMessage | undefined,
  incoming: ChatMessage,
) {
  return (
    previous?.id.startsWith(optimisticSteeringMessageIdPrefix) === true &&
    previous.threadId === incoming.threadId &&
    previous.role === incoming.role &&
    previous.content === incoming.content
  );
}

function replacementMessageId(message: ChatMessage) {
  const replacementId = message.details?.replacesMessageId;
  return typeof replacementId === "string" && replacementId.length > 0 ? replacementId : undefined;
}
