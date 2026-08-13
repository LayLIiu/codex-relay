import { execFile, spawn } from "node:child_process";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";

import { resolveCodexDesktopBinary } from "./codex-binary.js";

const REMOTE_CONTROL_TIMEOUT_MS = 30_000;
const SOCKET_WAIT_TIMEOUT_MS = 8_000;

export type CodexDesktopLaunchResult = {
  codexBinary: string;
  launched: boolean;
  workspacePath: string;
};

export type CodexDesktopControl = {
  ensureRemoteControl(): Promise<void>;
  launchDesktop(input?: { readonly workspacePath?: string }): Promise<CodexDesktopLaunchResult>;
  stopRemoteControl(): Promise<void>;
};

export type CodexDesktopControlOptions = {
  readonly codexBinary?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly workspacePath?: string;
};

export function supportsCodexDesktop(platform: NodeJS.Platform = process.platform) {
  return platform === "darwin";
}

export function createCodexDesktopControl(
  options: CodexDesktopControlOptions = {},
): CodexDesktopControl {
  const env = options.env ?? process.env;
  const codexBinary = options.codexBinary ?? resolveCodexDesktopBinary(env);
  const defaultWorkspacePath = resolve(
    options.workspacePath?.trim() || env.CODEX_RELAY_WORKSPACE_PATH?.trim() || process.cwd(),
  );
  const execFileAsync = promisify(execFile);

  async function ensureRemoteControl() {
    await execFileAsync(codexBinary, ["remote-control", "start"], {
      env,
      maxBuffer: 1024 * 1024,
      timeout: REMOTE_CONTROL_TIMEOUT_MS,
      windowsHide: true,
    });
    await waitForSharedAppServerSocket(env);
  }

  async function stopRemoteControl() {
    for (const args of [
      ["remote-control", "stop"],
      ["app-server", "daemon", "stop"],
    ]) {
      try {
        await execFileAsync(codexBinary, args, {
          env,
          maxBuffer: 1024 * 1024,
          timeout: 15_000,
          windowsHide: true,
        });
      } catch {
        // 没有运行中的本地 daemon 时忽略，不影响官方桌面通道。
      }
    }
  }

  async function launchDesktop(
    input: { readonly workspacePath?: string } = {},
  ): Promise<CodexDesktopLaunchResult> {
    const workspacePath = resolve(input.workspacePath?.trim() || defaultWorkspacePath);
    await new Promise<void>((resolveLaunch, rejectLaunch) => {
      const child = spawn(codexBinary, ["app", workspacePath], {
        detached: true,
        env,
        stdio: "ignore",
        windowsHide: true,
      });
      child.once("error", rejectLaunch);
      child.once("spawn", () => {
        child.unref();
        resolveLaunch();
      });
    });
    return { codexBinary, launched: true, workspacePath };
  }

  return {
    ensureRemoteControl,
    launchDesktop,
    stopRemoteControl,
  };
}

function sharedCodexAppServerSocketPath(env: NodeJS.ProcessEnv) {
  return join(
    env.CODEX_HOME?.trim() || join(homedir(), ".codex"),
    "app-server-control",
    "app-server-control.sock",
  );
}

async function waitForSharedAppServerSocket(
  env: NodeJS.ProcessEnv,
  timeoutMs = SOCKET_WAIT_TIMEOUT_MS,
) {
  const socketPath = sharedCodexAppServerSocketPath(env);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnectToUnixSocket(socketPath)) {
      return;
    }
    await setTimeout(50);
  }
  throw new Error(`Timed out waiting for Codex app-server control socket at ${socketPath}.`);
}

function canConnectToUnixSocket(socketPath: string) {
  return new Promise<boolean>((resolveConnected) => {
    const socket = connect({ path: socketPath });
    socket.once("error", () => {
      socket.destroy();
      resolveConnected(false);
    });
    socket.once("connect", () => {
      socket.destroy();
      resolveConnected(true);
    });
  });
}
