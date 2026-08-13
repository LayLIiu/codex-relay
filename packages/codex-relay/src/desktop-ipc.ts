import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import net from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const METHOD_VERSIONS: Record<string, number> = {
  initialize: 1,
  "thread-follower-start-turn": 1,
  "thread-follower-interrupt-turn": 3,
  "thread-follower-set-model-and-reasoning": 1,
  "thread-follower-update-thread-settings": 1,
  "thread-follower-compact-thread": 1,
  "thread-follower-steer-turn": 1,
  "thread-follower-command-approval-decision": 1,
  "thread-follower-file-approval-decision": 1,
  "thread-follower-permissions-request-approval-response": 1,
  "thread-follower-submit-user-input": 1,
  "thread-follower-set-collaboration-mode": 1,
  "thread-follower-set-queued-follow-ups-state": 1,
  "thread-follower-load-complete-history": 1,
  "client-status-changed": 1,
};
type Timer = ReturnType<typeof setTimeout>;

type IpcEnvelope = {
  type?: string;
  requestId?: string;
  method?: string;
  resultType?: string;
  result?: unknown;
  error?: unknown;
  sourceClientId?: string;
  version?: number;
  params?: Record<string, unknown>;
  request?: { method?: string; params?: Record<string, unknown> };
};

export type DesktopIpcBroadcastEnvelope = {
  method?: string;
  params?: Record<string, unknown>;
  sourceClientId?: string;
  type: "broadcast";
  version?: number;
};

export type DesktopIpcClient = {
  sendRequest(method: string, params: Record<string, unknown>): Promise<unknown>;
  isAvailable(): Promise<boolean>;
  close(): void;
};

export function createDesktopIpcClient(
  options: {
    onBroadcast?: (envelope: DesktopIpcBroadcastEnvelope) => void;
    requestTimeoutMs?: number;
  } = {},
): DesktopIpcClient {
  const requestTimeoutMs = options.requestTimeoutMs ?? 6_000;
  const onBroadcast = options.onBroadcast;
  let socket: net.Socket | null = null;
  let clientId = "";
  let initialized = false;
  let connecting: Promise<void> | null = null;
  let buffer = Buffer.alloc(0);
  const pendingRequests = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: Timer }
  >();

  function socketPathCandidates() {
    const codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
    const uid = typeof process.getuid === "function" ? process.getuid() : 0;
    return [join(codexHome, "ipc", "ipc.sock"), join(tmpdir(), "codex-ipc", `ipc-${uid}.sock`)];
  }

  function findSocketPath() {
    return socketPathCandidates().find((candidate) => existsSync(candidate));
  }

  function writeFrame(payload: string) {
    if (!socket || socket.destroyed) {
      return false;
    }
    const body = Buffer.from(payload, "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    socket.write(Buffer.concat([header, body]));
    return true;
  }

  function readFrames() {
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (length > 256 * 1024 * 1024) {
        buffer = Buffer.alloc(0);
        closeSocket();
        return;
      }
      if (buffer.length < 4 + length) {
        return;
      }
      const payload = buffer.subarray(4, 4 + length).toString("utf8");
      buffer = buffer.subarray(4 + length);
      let envelope: IpcEnvelope;
      try {
        envelope = JSON.parse(payload) as IpcEnvelope;
      } catch {
        continue;
      }
      handleEnvelope(envelope);
    }
  }

  function handleEnvelope(envelope: IpcEnvelope) {
    if (envelope.type === "broadcast") {
      onBroadcast?.({
        method: envelope.method,
        params: envelope.params,
        sourceClientId: envelope.sourceClientId,
        type: "broadcast",
        version: envelope.version,
      });
      return;
    }
    if (envelope.type === "client-discovery-request") {
      writeFrame(
        JSON.stringify({
          type: "client-discovery-response",
          requestId: envelope.requestId,
          response: { canHandle: false },
        }),
      );
      return;
    }

    if (envelope.type === "response" && envelope.requestId) {
      const pending = pendingRequests.get(envelope.requestId);
      if (!pending) {
        return;
      }
      pendingRequests.delete(envelope.requestId);
      clearTimeout(pending.timer);
      if (envelope.resultType === "success") {
        pending.resolve(envelope.result ?? null);
      } else {
        pending.reject(new Error(String(envelope.error ?? "Desktop IPC request failed")));
      }
    }
  }

  function closeSocket() {
    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Desktop IPC connection closed"));
    }
    pendingRequests.clear();
    socket?.destroy();
    socket = null;
    initialized = false;
    clientId = "";
  }

  function connect() {
    if (socket && !socket.destroyed) {
      return Promise.resolve();
    }
    if (connecting) {
      return connecting;
    }

    const socketPath = findSocketPath();
    if (!socketPath) {
      return Promise.reject(new Error("Desktop IPC socket not found"));
    }

    connecting = new Promise<void>((resolve, reject) => {
      const nextSocket = net.createConnection(socketPath);
      socket = nextSocket;
      const timeout = setTimeout(() => {
        nextSocket.destroy();
        reject(new Error("Desktop IPC connect timeout"));
      }, 2_000);

      nextSocket.once("connect", () => {
        clearTimeout(timeout);
        sendRequest("initialize", { clientType: "remodex-bridge" }, true)
          .then((result) => {
            clientId =
              typeof (result as { clientId?: unknown })?.clientId === "string"
                ? String((result as { clientId: string }).clientId)
                : "";
            initialized = true;
            connecting = null;
            resolve();
          })
          .catch((error: Error) => {
            connecting = null;
            closeSocket();
            reject(error);
          });
      });
      nextSocket.on("data", (data) => {
        buffer = Buffer.concat([buffer, data]);
        readFrames();
      });
      nextSocket.on("error", (error) => {
        clearTimeout(timeout);
        connecting = null;
        closeSocket();
        reject(error);
      });
      nextSocket.on("close", () => {
        clearTimeout(timeout);
        if (connecting) {
          connecting = null;
          reject(new Error("Desktop IPC socket closed before initialize"));
        }
        closeSocket();
      });
    });
    return connecting;
  }

  function sendRequest(method: string, params: Record<string, unknown>, initializing = false) {
    if (!socket || socket.destroyed || (!initialized && !initializing)) {
      return Promise.reject(new Error("Desktop IPC is not connected"));
    }
    const requestId = `codex-relay-${Date.now().toString(36)}-${randomUUID()}`;
    const envelope = {
      type: "request",
      requestId,
      sourceClientId: initializing ? "initializing-client" : clientId || "remodex-bridge",
      version: METHOD_VERSIONS[method] ?? 1,
      method,
      params,
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error(`Desktop IPC request timed out: ${method}`));
      }, requestTimeoutMs);
      pendingRequests.set(requestId, { resolve, reject, timer });
      if (!writeFrame(JSON.stringify(envelope))) {
        clearTimeout(timer);
        pendingRequests.delete(requestId);
        reject(new Error("Desktop IPC write failed"));
      }
    });
  }

  return {
    sendRequest(method, params) {
      return connect().then(() => sendRequest(method, params));
    },
    async isAvailable() {
      try {
        await connect();
        return true;
      } catch {
        return false;
      }
    },
    close() {
      closeSocket();
    },
  };
}
