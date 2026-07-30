import type { ListThreadsResponse } from "codex-relay/api-schema";
import type { QueryClient } from "@tanstack/react-query";

import { serverStateKeys } from "@/lib/server-state";
import { chatStore$, setActiveThread } from "@/state/chat-store";

export function restoreChatStoreFromQueryCache(queryClient: QueryClient) {
  const threads = queryClient.getQueryData<ListThreadsResponse>(serverStateKeys.threads());
  if (!chatStore$.activeThreadId.peek() && threads?.threads[0]) {
    setActiveThread(threads.threads[0].id);
  }
}
