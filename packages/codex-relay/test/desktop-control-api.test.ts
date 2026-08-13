import { rmSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";

describe("POST /v1/desktop/launch", () => {
  it("switches the app-server and launches Codex Desktop", async () => {
    const appServer = {
      appServerMode: "socket",
      ownership: "attached",
    };
    const ensureRemoteControl = vi.fn<() => Promise<void>>(async () => {});
    const stopRemoteControl = vi.fn<() => Promise<void>>(async () => {});
    const launchDesktop = vi.fn<
      (input: { workspacePath?: string }) => Promise<{
        codexBinary: string;
        launched: boolean;
        workspacePath: string;
      }>
    >(async (input: { workspacePath?: string }) => ({
      codexBinary: "/Applications/ChatGPT.app/Contents/Resources/codex",
      launched: true,
      workspacePath: input.workspacePath ?? "/tmp/codex-relay",
    }));
    const localDesktopControl = {
      ensureAvailable: vi.fn<() => Promise<void>>(async () => {}),
      isAvailable: vi.fn<() => Promise<boolean>>(async () => true),
      launchApp: vi.fn<() => Promise<void>>(async () => {}),
      openThread: vi.fn<() => Promise<void>>(async () => {}),
      sendPrompt: vi.fn<() => Promise<void>>(async () => {}),
      newThread: vi.fn<
        (input?: {
          scope?: "conversation" | "project";
          workspacePath?: string;
          anchorThreadId?: string;
        }) => Promise<{ threadId?: string; pending: boolean }>
      >(async () => ({ threadId: "019ff607-2ee1-7910-b8d0-2aeeb7743e44", pending: false })),
      stop: vi.fn<() => Promise<void>>(async () => {}),
      selectModel: vi.fn<() => Promise<{ target: string }>>(async () => ({ target: "gpt-5.5" })),
      selectReasoningMode: vi.fn<() => Promise<{ target: string }>>(async () => ({
        target: "medium",
      })),
      threadAction: vi.fn<() => Promise<{ name?: string }>>(async () => ({})),
      listModels: vi.fn<() => { key: string; id: string; displayName: string; source: "local" }[]>(
        () => [],
      ),
    };
    const app = createApp({
      appServer: appServer as never,
      desktopControl: {
        ensureRemoteControl,
        launchDesktop,
        stopRemoteControl,
      },
      localDesktopControl,
      workspacePath: process.cwd(),
    });

    const response = await app.request("/v1/desktop/launch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      launched: true,
      appServerMode: "socket",
      appServerOwnership: "attached",
    });
    expect(localDesktopControl.launchApp).toHaveBeenCalledOnce();
  });

  it("switches between CLI and Desktop session sources", async () => {
    let ownership = "stdio";
    const switchToCliServer = vi.fn<() => Promise<void>>(async () => {
      ownership = "stdio";
    });
    const appServer = {
      appServerMode: "socket",
      get ownership() {
        return ownership;
      },
      switchToCliServer,
    };
    const ensureRemoteControl = vi.fn<() => Promise<void>>(async () => {});
    const stopRemoteControl = vi.fn<() => Promise<void>>(async () => {});
    const localDesktopControl = {
      ensureAvailable: vi.fn<() => Promise<void>>(async () => {}),
      isAvailable: vi.fn<() => Promise<boolean>>(async () => true),
      launchApp: vi.fn<() => Promise<void>>(async () => {}),
      openThread: vi.fn<() => Promise<void>>(async () => {}),
      sendPrompt: vi.fn<() => Promise<void>>(async () => {}),
      newThread: vi.fn<
        (input?: {
          scope?: "conversation" | "project";
          workspacePath?: string;
          anchorThreadId?: string;
        }) => Promise<{ threadId?: string; pending: boolean }>
      >(async () => ({ threadId: "019ff607-2ee1-7910-b8d0-2aeeb7743e44", pending: false })),
      stop: vi.fn<() => Promise<void>>(async () => {}),
      selectModel: vi.fn<() => Promise<{ target: string }>>(async () => ({ target: "gpt-5.5" })),
      selectReasoningMode: vi.fn<() => Promise<{ target: string }>>(async () => ({
        target: "medium",
      })),
      threadAction: vi.fn<() => Promise<{ name?: string }>>(async () => ({})),
      listModels: vi.fn<() => { key: string; id: string; displayName: string; source: "local" }[]>(
        () => [],
      ),
    };
    const launchDesktop = vi.fn<
      () => Promise<{
        codexBinary: string;
        launched: boolean;
        workspacePath: string;
      }>
    >(async () => ({
      codexBinary: "/Applications/ChatGPT.app/Contents/Resources/codex",
      launched: true,
      workspacePath: "/tmp/codex-relay",
    }));
    const app = createApp({
      appServer: appServer as never,
      desktopControl: {
        ensureRemoteControl,
        launchDesktop,
        stopRemoteControl,
      },
      localDesktopControl,
      workspacePath: "/tmp/codex-relay",
    });

    const desktopResponse = await app.request("/v1/session-source", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "desktop" }),
    });
    expect(desktopResponse.status).toBe(200);
    await expect(desktopResponse.json()).resolves.toMatchObject({
      ok: true,
      source: "desktop",
      appServerOwnership: "stdio",
    });
    expect(localDesktopControl.ensureAvailable).toHaveBeenCalledOnce();

    const cliResponse = await app.request("/v1/session-source", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "cli" }),
    });
    expect(cliResponse.status).toBe(200);
    await expect(cliResponse.json()).resolves.toMatchObject({
      ok: true,
      source: "cli",
      appServerOwnership: "stdio",
    });
    expect(switchToCliServer).toHaveBeenCalledOnce();
  });
});

describe("desktop session control APIs", () => {
  afterEach(() => {
    delete process.env.CODEX_RELAY_DESKTOP_STATE_PATH;
    delete process.env.CODEX_RELAY_SESSION_SOURCE_PATH;
    rmSync(join(tmpdir(), "codex-relay-desktop-state-test.json"), { force: true });
    rmSync(join(tmpdir(), "codex-relay-session-source-test.txt"), { force: true });
  });

  function createDesktopApp(appServer?: unknown) {
    process.env.CODEX_RELAY_DESKTOP_STATE_PATH = join(
      tmpdir(),
      "codex-relay-desktop-state-test.json",
    );
    process.env.CODEX_RELAY_SESSION_SOURCE_PATH = join(
      tmpdir(),
      "codex-relay-session-source-test.txt",
    );
    const localDesktopControl = {
      ensureAvailable: vi.fn<() => Promise<void>>(async () => {}),
      isAvailable: vi.fn<() => Promise<boolean>>(async () => true),
      launchApp: vi.fn<() => Promise<void>>(async () => {}),
      openThread: vi.fn<() => Promise<void>>(async () => {}),
      sendPrompt: vi.fn<() => Promise<void>>(async () => {}),
      newThread: vi.fn<
        (input?: {
          scope?: "conversation" | "project";
          workspacePath?: string;
          anchorThreadId?: string;
        }) => Promise<{ threadId?: string; pending: boolean }>
      >(async () => ({
        threadId: "019fd844-a809-7f63-a0cc-e4a8362ae173",
        pending: false,
      })),
      stop: vi.fn<() => Promise<void>>(async () => {}),
      selectModel: vi.fn<
        (input?: { threadId?: string; target?: string }) => Promise<{ target: string }>
      >(async (input?: { threadId?: string; target?: string }) => ({
        target: input?.target ?? "gpt-5.5",
      })),
      selectReasoningMode: vi.fn<
        (input?: { threadId?: string; target?: string }) => Promise<{ target: string }>
      >(async (input?: { threadId?: string; target?: string }) => ({
        target: input?.target ?? "medium",
      })),
      threadAction: vi.fn<
        (input: { threadId: string; action: string; name?: string }) => Promise<{ name?: string }>
      >(async (input: { threadId: string; action: string; name?: string }) => ({
        name: input.action === "rename" ? input.name : undefined,
      })),
      listModels: vi.fn<() => { key: string; id: string; displayName: string; source: "local" }[]>(
        () => [
          {
            key: "gpt-5.5",
            id: "gpt-5.5",
            displayName: "GPT-5.5",
            source: "local",
          },
        ],
      ),
    };
    const app = createApp({
      appServer: appServer as never,
      desktopControl: {
        ensureRemoteControl: vi.fn<() => Promise<void>>(async () => {}),
        stopRemoteControl: vi.fn<() => Promise<void>>(async () => {}),
        launchDesktop: vi.fn<
          () => Promise<{
            codexBinary: string;
            launched: boolean;
            workspacePath: string;
          }>
        >(async () => ({
          codexBinary: "Codex CDP.app",
          launched: true,
          workspacePath: "/tmp/codex-relay",
        })),
      },
      localDesktopControl,
      workspacePath: "/tmp/codex-relay",
    });
    return { app, localDesktopControl };
  }

  it("creates a local desktop thread", async () => {
    const { app, localDesktopControl } = createDesktopApp();
    await app.request("/v1/session-source", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "desktop" }),
    });

    const response = await app.request("/v1/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspacePath: process.cwd() }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      thread: {
        id: "019fd844-a809-7f63-a0cc-e4a8362ae173",
        source: "desktop",
      },
    });
    expect(localDesktopControl.newThread).toHaveBeenCalledWith({
      scope: "project",
      workspacePath: process.cwd(),
    });
  });

  it("lists models from the local desktop catalog", async () => {
    const { app } = createDesktopApp();
    await app.request("/v1/session-source", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "desktop" }),
    });

    const response = await app.request("/v1/models");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      models: [{ id: "gpt-5.5", model: "gpt-5.5", displayName: "GPT-5.5" }],
    });
  });

  it("runs pin and rename thread actions", async () => {
    const { app, localDesktopControl } = createDesktopApp();
    await app.request("/v1/session-source", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "desktop" }),
    });

    const pinResponse = await app.request("/v1/desktop/thread-action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        threadId: "019fd844-a809-7f63-a0cc-e4a8362ae173",
        action: "pin",
      }),
    });
    expect(pinResponse.status).toBe(200);
    await expect(pinResponse.json()).resolves.toMatchObject({
      ok: true,
      action: "pin",
      threadId: "019fd844-a809-7f63-a0cc-e4a8362ae173",
    });
    expect(localDesktopControl.threadAction).toHaveBeenCalledWith({
      threadId: "019fd844-a809-7f63-a0cc-e4a8362ae173",
      action: "pin",
      name: undefined,
    });

    const renameResponse = await app.request("/v1/desktop/thread-action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        threadId: "019fd844-a809-7f63-a0cc-e4a8362ae173",
        action: "rename",
        name: "重构桌面端",
      }),
    });
    expect(renameResponse.status).toBe(200);
    await expect(renameResponse.json()).resolves.toMatchObject({
      ok: true,
      action: "rename",
      name: "重构桌面端",
    });
  });

  it("attaches an already running desktop thread without resending the prompt", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "codex-relay-home-"));
    const sessionsDir = join(codexHome, "sessions", "2026", "08", "12");
    await mkdir(sessionsDir, { recursive: true });
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    try {
      const { app, localDesktopControl } = createDesktopApp({
        appServerMode: "socket",
        ownership: "attached",
      });
      await app.request("/v1/session-source", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "desktop" }),
      });
      const createResponse = await app.request("/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Desktop attach", workspacePath: process.cwd() }),
      });
      const createBody = await createResponse.json();
      const threadId = createBody.thread.id as string;
      await writeFile(
        join(sessionsDir, `rollout-2026-08-12T00-00-00-${threadId}.jsonl`),
        [
          JSON.stringify({
            timestamp: "2026-08-12T00:00:01.000Z",
            type: "event_msg",
            payload: { type: "user_message", message: "desktop task" },
          }),
          JSON.stringify({
            timestamp: "2026-08-12T00:00:02.000Z",
            type: "event_msg",
            payload: { type: "agent_message", message: "desktop answer" },
          }),
          JSON.stringify({
            timestamp: "2026-08-12T00:00:03.000Z",
            type: "event_msg",
            payload: { type: "task_complete" },
          }),
        ].join("\n"),
      );

      const streamResponse = await app.request(`/v1/threads/${threadId}/runs/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const streamBody = await streamResponse.text();

      expect(streamResponse.status).toBe(200);
      expect(streamBody).toContain("thread.message.completed");
      expect(streamBody).toContain("desktop answer");
      expect(localDesktopControl.sendPrompt).not.toHaveBeenCalled();
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
      rmSync(codexHome, { force: true, recursive: true });
    }
  }, 10_000);
});
