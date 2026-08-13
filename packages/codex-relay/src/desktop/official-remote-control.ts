import { createRequire } from "node:module";
import { setTimeout } from "node:timers/promises";

export type OfficialDesktopRemoteControlOptions = {
  readonly appPath?: string;
  readonly env?: NodeJS.ProcessEnv;
};

export type OfficialDesktopRemoteControlTransport = {
  connect(): Promise<void>;
  readonly describe: () => string;
  readonly isStarted: () => boolean;
  readonly mode: string;
  onClose(handler: (code: number, reason: string) => void): void;
  onError(handler: (error: Error) => void): void;
  onMessage(handler: (message: string) => void): void;
  onStarted(handler: () => void): void;
  send(message: unknown): void;
  shutdown(): void;
};

const require = createRequire(import.meta.url);

export function createOfficialDesktopRemoteControlTransport(
  options: OfficialDesktopRemoteControlOptions = {},
): OfficialDesktopRemoteControlTransport {
  const env = options.env ?? process.env;
  const appPath =
    options.appPath?.trim() || env.CODEX_DESKTOP_APP_PATH?.trim() || "/Applications/ChatGPT.app";
  const module = require("./official-remote-control-transport.cjs") as {
    createOfficialRemoteControlTransport(input: {
      appPath: string;
      env: NodeJS.ProcessEnv;
    }): OfficialDesktopRemoteControlTransport;
  };
  return module.createOfficialRemoteControlTransport({ appPath, env });
}

export function waitForOfficialDesktopRemoteControl(
  transport: OfficialDesktopRemoteControlTransport,
  timeoutMs = 20_000,
) {
  if (transport.isStarted()) {
    return Promise.resolve();
  }
  return (async () => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (transport.isStarted()) {
        return;
      }
      await setTimeout(50);
    }
    throw new Error("Timed out waiting for Codex Desktop Remote Control.");
  })();
}
