import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { relayDebugLog } from "./debug-log.js";
import { createDesktopIpcClient } from "./desktop-ipc.js";

const execFileAsync = promisify(execFile);

const CODEX_DEEPLINK_SETTLE_MS = 560;
const CODEX_APP_FOCUS_SETTLE_MS = 100;
const CODEX_CLICK_SETTLE_MS = 60;
const TEXT_PASTE_SETTLE_MS = 140;
const CODEX_COMMAND_SETTLE_MS = 180;
const CODEX_MODEL_COMMAND_SETTLE_MS = 450;
const CODEX_REASONING_COMMAND_SETTLE_MS = 450;

export type LocalDesktopThreadAction = "archive" | "pin" | "unpin" | "rename";

export type LocalDesktopModel = {
  key: string;
  id: string;
  displayName: string;
  description?: string;
  source: "local";
};

export type LocalDesktopControl = {
  ensureAvailable(): Promise<void>;
  isAvailable(): Promise<boolean>;
  launchApp(): Promise<void>;
  openThread(threadId: string): Promise<void>;
  sendPrompt(input: { prompt: string; threadId: string }): Promise<void>;
  newThread(input?: {
    scope?: "conversation" | "project";
    workspacePath?: string;
    anchorThreadId?: string;
  }): Promise<{ threadId?: string; pending: boolean }>;
  stop(input?: { threadId?: string }): Promise<void>;
  selectModel(input?: { threadId?: string; target?: string }): Promise<{ target: string }>;
  selectReasoningMode(input?: { threadId?: string; target?: string }): Promise<{ target: string }>;
  threadAction(input: {
    threadId: string;
    action: LocalDesktopThreadAction;
    name?: string;
  }): Promise<{ name?: string }>;
  listModels(): LocalDesktopModel[];
};

export type LocalDesktopControlOptions = {
  readonly appPath?: string;
  readonly bundleId?: string;
  readonly cdpPort?: number;
  readonly env?: NodeJS.ProcessEnv;
};

const REASONING_MODE_TARGETS: Record<string, { key: string; value: string; label: string }> = {
  low: { key: "low", value: "low", label: "低" },
  medium: { key: "medium", value: "medium", label: "中" },
  high: { key: "high", value: "high", label: "高" },
  xhigh: { key: "xhigh", value: "xhigh", label: "超高" },
};

export function createLocalDesktopControl(
  options: LocalDesktopControlOptions = {},
): LocalDesktopControl {
  const env = options.env ?? process.env;
  const desktopIpc = createDesktopIpcClient({ requestTimeoutMs: 3_000 });
  const appPath =
    options.appPath?.trim() || env.CODEX_DESKTOP_APP_PATH?.trim() || "/Applications/ChatGPT.app";
  const bundleId =
    options.bundleId?.trim() || env.CODEX_DESKTOP_BUNDLE_ID?.trim() || "com.openai.codex";
  const cdpPort = Number(options.cdpPort ?? env.CODEX_DESKTOP_CDP_PORT ?? 39_252);
  const cdpAddress = env.CODEX_DESKTOP_CDP_ADDRESS?.trim() || "127.0.0.1";
  const repoRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  const repoLauncherPath = resolve(
    fileURLToPath(new URL("../../../tools/Codex CDP.app", import.meta.url)),
  );
  const pointToolCandidates = [
    env.CODEX_WINDOW_POINT_TOOL?.trim(),
    resolve(repoRoot, "tools", "codex-window-point"),
    "/Users/liujie/Downloads/Codex-Mini-main/bin/codex-window-point",
  ].filter((candidate): candidate is string => Boolean(candidate));

  async function isAvailable() {
    try {
      const targets = await getCdpTargets();
      return findCodexTarget(targets) !== null;
    } catch {
      return false;
    }
  }

  async function ensureAvailable() {
    if (await isAvailable()) {
      return;
    }
    if (await isCodexAppRunning()) {
      throw new Error(
        "原版 ChatGPT/Codex 正在运行但没有开启 CDP。请先退出原版，再用「Codex CDP」图标启动。",
      );
    }
    await launchApp();
  }

  async function launchApp() {
    const launcherPath = resolveLauncherAppPath();
    if (!launcherPath) {
      throw new Error("找不到 Codex CDP.app 启动器");
    }
    const launcherScript = join(launcherPath, "Contents", "MacOS", "launch");
    if (!existsSync(launcherScript)) {
      throw new Error(`Codex CDP.app 启动脚本不存在: ${launcherScript}`);
    }
    await execFileAsync("/bin/zsh", [launcherScript], {
      env: {
        ...env,
        CODEX_DESKTOP_APP_PATH: appPath,
        CODEX_DESKTOP_CDP_PORT: String(cdpPort),
        CODEX_DESKTOP_CDP_ADDRESS: cdpAddress,
      },
      timeout: 20_000,
    });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (await isAvailable()) {
        return;
      }
      await sleep(300);
    }
    throw new Error(
      "Codex Desktop CDP 未就绪。如果 ChatGPT 已经在运行，请完全退出后重试，Relay 会用本地调试接口重新启动它。",
    );
  }

  function resolveLauncherAppPath() {
    const explicit = env.CODEX_DESKTOP_CDP_LAUNCHER_APP?.trim();
    const candidates = [
      explicit,
      repoLauncherPath,
      join(homedir(), "Applications", "Codex CDP.app"),
      "/Applications/Codex CDP.app",
    ].filter((candidate): candidate is string => Boolean(candidate));
    return candidates.find((candidate) => existsSync(candidate));
  }

  async function openThread(threadId: string) {
    if (!threadId) {
      return;
    }
    await execFileAsync("/usr/bin/open", [`codex://threads/${encodeURIComponent(threadId)}`]);
    await execFileAsync("/usr/bin/open", ["-b", bundleId]);
    await sleep(CODEX_DEEPLINK_SETTLE_MS + CODEX_APP_FOCUS_SETTLE_MS);
  }

  async function newThread(
    input: {
      scope?: "conversation" | "project";
      workspacePath?: string;
      anchorThreadId?: string;
    } = {},
  ) {
    await ensureAvailable();
    const before = sessionIndexThreadIds();
    let beforeThreadId: string | undefined;
    try {
      beforeThreadId = await readDesktopThreadIdFromCdp();
    } catch {
      // 桌面端可能还没有进入可读的会话页面，先继续走深链。
    }
    const scope = input.scope ?? (input.workspacePath ? "project" : "conversation");
    if (scope === "project" && input.workspacePath) {
      await openNewThreadDeepLink(input.workspacePath);
    } else if (scope === "conversation" && input.anchorThreadId) {
      await openThread(input.anchorThreadId);
      await pressCodexShortcut("n", ["command"]);
      await sleep(CODEX_DEEPLINK_SETTLE_MS + 180);
      await focusCodexApp();
    } else {
      await openNewThreadDeepLink("");
    }
    await focusCodexApp();

    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const current = sessionIndexThreadIds();
      const next = Array.from(current).find((threadId: string) => !before.has(threadId));
      if (next) {
        return { threadId: next, pending: false };
      }
      await sleep(220);
    }

    try {
      const afterDeepLink = await readDesktopThreadIdFromCdp();
      if (afterDeepLink && afterDeepLink !== beforeThreadId) {
        return { threadId: afterDeepLink, pending: false };
      }
    } catch {
      // 继续尝试通过 UI 新建。
    }

    try {
      await clickNewThreadViaCdp(input.workspacePath);
      await sleep(800);
      const afterClick = await readDesktopThreadIdFromCdp();
      if (afterClick && afterClick !== beforeThreadId) {
        return { threadId: afterClick, pending: false };
      }
    } catch (error) {
      relayDebugLog("desktop.new_thread_cdp_failed", {
        message: errorMessage(error),
      });
    }
    return { pending: true };
  }

  async function openNewThreadDeepLink(cwd = "") {
    const url = new URL("codex://threads/new");
    if (cwd) {
      url.searchParams.set("path", cwd);
    }
    await execFileAsync("/usr/bin/open", [url.toString()]);
    await sleep(CODEX_DEEPLINK_SETTLE_MS + 180);
  }

  async function focusCodexApp() {
    await execFileAsync("/usr/bin/open", ["-b", bundleId]);
    await sleep(CODEX_APP_FOCUS_SETTLE_MS);
  }

  async function readDesktopThreadIdFromCdp() {
    const { ws } = await connectToEditorTarget();
    try {
      const result = await sendCommand(ws, "Runtime.evaluate", {
        expression: `(() => {
          const selectors = [
            "[data-app-action-sidebar-thread-id]",
            "[data-browser-sidebar-thread-id]",
            "[data-browser-sidebar-conversation-id]"
          ];
          for (const selector of selectors) {
            const el = document.querySelector(selector);
            const value = el?.getAttribute(selector.slice(1, -1)) || el?.getAttribute(selector);
            const match = String(value || "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
            if (match) return match[0];
          }
          return "";
        })()`,
        returnByValue: true,
      });
      const threadId = typeof result?.result?.value === "string" ? result.result.value.trim() : "";
      if (!threadId) {
        throw new Error("桌面端页面没有读取到线程 ID");
      }
      return threadId;
    } finally {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
  }

  async function clickNewThreadViaCdp(workspacePath = "") {
    const { ws } = await connectToEditorTarget();
    try {
      const projectName = workspacePath ? basename(workspacePath) : "";
      const result = await sendCommand(ws, "Runtime.evaluate", {
        expression: `(() => {
          const buttons = [...document.querySelectorAll('button,[role="button"]')];
          const target = buttons.find((el) => {
            const text = (el.textContent || "").trim();
            const aria = (el.getAttribute("aria-label") || "").trim();
            if (text === "新对话") return true;
            if (projectName && aria.includes("开始新聊天") && aria.includes(projectName)) return true;
            return false;
          });
          if (!target) return false;
          target.click();
          return true;
        })()`,
        returnByValue: true,
      });
      if (result?.result?.value !== true) {
        throw new Error("桌面端页面没有找到新对话按钮");
      }
    } finally {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
  }

  async function stop(input: { threadId?: string } = {}) {
    await ensureAvailable();
    if (input.threadId) {
      await openThread(input.threadId);
    }
    await pressCancelCodexResponse();
  }

  async function selectModel(input: { threadId?: string; target?: string } = {}) {
    await ensureAvailable();
    if (input.threadId) {
      await openThread(input.threadId);
    }
    const target = resolveModelTarget(input.target);
    await pasteCommandAndOption("/模型", target.displayName, CODEX_MODEL_COMMAND_SETTLE_MS);
    return { target: target.displayName };
  }

  async function selectReasoningMode(input: { threadId?: string; target?: string } = {}) {
    await ensureAvailable();
    if (input.threadId) {
      await openThread(input.threadId);
    }
    const target = resolveReasoningModeTarget(input.target);
    await pasteCommandAndOption("/推理模式", target.label, CODEX_REASONING_COMMAND_SETTLE_MS);
    return { target: target.label };
  }

  async function threadAction(input: {
    threadId: string;
    action: LocalDesktopThreadAction;
    name?: string;
  }) {
    await ensureAvailable();
    await openThread(input.threadId);
    if (input.action === "archive") {
      await pressCodexShortcut("a", ["command", "shift"]);
      await sleep(CODEX_COMMAND_SETTLE_MS);
      return {};
    }
    if (input.action === "pin" || input.action === "unpin") {
      await pressCodexShortcut("p", ["command", "option"]);
      await sleep(CODEX_COMMAND_SETTLE_MS);
      return {};
    }
    if (input.action === "rename") {
      const name = String(input.name ?? "")
        .replace(/\s+/g, " ")
        .trim();
      if (!name) {
        throw new Error("新名称不能为空");
      }
      if (name.length > 120) {
        throw new Error("新名称太长，请控制在 120 个字符以内");
      }
      await pressCodexShortcut("r", ["command", "option"]);
      await sleep(CODEX_COMMAND_SETTLE_MS);
      await copyTextToClipboard(name);
      await pressPaste();
      await sleep(80);
      await pressEnter();
      await sleep(CODEX_COMMAND_SETTLE_MS);
      return { name };
    }
    throw new Error("不支持的线程操作");
  }

  async function sendPrompt(input: { prompt: string; threadId: string }) {
    try {
      await sendPromptViaDesktopIpc(input);
      return;
    } catch (ipcError) {
      relayDebugLog("desktop.ipc_send_failed", {
        message: errorMessage(ipcError),
        threadId: input.threadId,
      });
    }
    await ensureAvailable();
    try {
      await openThread(input.threadId);
    } catch {
      // Desktop may already be showing the target conversation.
    }
    try {
      await sendPromptViaCdp(input.prompt);
      return;
    } catch (cdpError) {
      // CDP DOM 注入在 Electron 改版时可能不可用，回退到 Codex-Mini 的 macOS 自动化方案。
      try {
        await sendPromptViaMacAutomation(input.prompt);
        return;
      } catch (automationError) {
        throw new Error(
          `桌面端发送失败（CDP: ${errorMessage(cdpError)}；自动化: ${errorMessage(automationError)}）`,
        );
      }
    }
  }

  async function sendPromptViaDesktopIpc(input: { prompt: string; threadId: string }) {
    await desktopIpc.sendRequest("thread-follower-start-turn", {
      conversationId: input.threadId,
      senderRequestId: randomUUID(),
      turnStartParams: {
        threadId: input.threadId,
        input: [{ type: "text", text: input.prompt }],
        cwd: env.CODEX_RELAY_WORKSPACE_PATH || process.cwd(),
      },
    });
  }

  async function sendPromptViaCdp(prompt: string) {
    const { ws } = await connectToEditorTarget();
    try {
      await focusAndClickEditor(ws);
      await sleep(150);
      await sendCommand(ws, "Input.insertText", { text: prompt });
      await sleep(250);
      await sendCommand(ws, "Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 36,
      });
      await sendCommand(ws, "Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 36,
      });
      await sendCommand(ws, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 36,
      });
      await sleep(700);
      const textAfterEnter = await readComposerText(ws);
      if (textAfterEnter && textAfterEnter.trim().length > 0) {
        await sendCommand(ws, "Runtime.evaluate", {
          expression: clickSendButtonExpression(),
          returnByValue: true,
        });
        await sleep(700);
        const textAfterClick = await readComposerText(ws);
        if (textAfterClick && textAfterClick.trim().length > 0) {
          throw new Error(
            `输入框仍包含文本，CDP 回车未触发发送: ${textAfterClick.trim().slice(0, 40)}`,
          );
        }
      }
    } finally {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
  }

  async function readComposerText(ws: WebSocket) {
    const result = await sendCommand(ws, "Runtime.evaluate", {
      expression:
        '(function(){ const editor = document.querySelector(".ProseMirror"); return editor ? editor.textContent : ""; })()',
      returnByValue: true,
    });
    return typeof result?.result?.value === "string" ? result.result.value : "";
  }

  async function connectToEditorTarget() {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const targets = await getCdpTargets();
      const candidates = findCodexPageTargets(targets);
      for (const target of candidates) {
        if (typeof target.webSocketDebuggerUrl !== "string") {
          continue;
        }
        relayDebugLog("desktop.cdp.editor_target_try", {
          title: String(target.title || ""),
          url: String(target.url || ""),
        });
        const ws = await connectToWebSocket(target.webSocketDebuggerUrl);
        try {
          await sendCommand(ws, "Page.bringToFront", {});
          const info = await readComposerInfo(ws);
          if (info?.found) {
            relayDebugLog("desktop.cdp.editor_found", {
              title: String(target.title || ""),
              url: String(target.url || ""),
            });
            return { ws };
          }
        } catch {
          // Try the next Codex page; the visible conversation may still be loading.
        }
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      }
      await sleep(250);
    }
    relayDebugLog("desktop.cdp.editor_missing", {});
    throw new Error("找不到 Codex 桌面端输入框");
  }

  async function focusAndClickEditor(ws: WebSocket) {
    let info: { found?: boolean; x?: number; y?: number } | undefined;
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      info = await readComposerInfo(ws);
      if (info?.found) {
        break;
      }
      await sleep(250);
    }
    if (!info?.found || typeof info.x !== "number" || typeof info.y !== "number") {
      throw new Error("找不到 Codex 桌面端输入框");
    }
    await sendCommand(ws, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: info.x,
      y: info.y,
      button: "left",
      clickCount: 1,
    });
    await sendCommand(ws, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: info.x,
      y: info.y,
      button: "left",
      clickCount: 1,
    });
    await sendCommand(ws, "Runtime.evaluate", {
      expression: focusEditorExpression(),
      returnByValue: true,
    });
  }

  async function readComposerInfo(ws: WebSocket) {
    const result = await sendCommand(ws, "Runtime.evaluate", {
      expression: composerInfoExpression(),
      returnByValue: true,
    });
    return result?.result?.value as { found?: boolean; x?: number; y?: number } | undefined;
  }

  async function sendPromptViaMacAutomation(prompt: string) {
    await clickCodexComposer();
    await clearCodexComposerViaMacAutomation();
    await copyTextToClipboard(prompt);
    await pressPasteAndEnter();
  }

  async function clearCodexComposerViaMacAutomation() {
    await pressCodexShortcut("a", ["command"]);
    await sleep(60);
    await runProcess("osascript", ["-e", 'tell application "System Events" to key code 51']);
    await sleep(60);
  }

  async function pasteCommandAndOption(command: string, option: string, settleMs: number) {
    await clickCodexComposer();
    await copyTextToClipboard(command);
    await pressPasteAndEnter();
    await sleep(settleMs);
    await copyTextToClipboard(option);
    await pressPasteAndEnter();
    await sleep(CODEX_COMMAND_SETTLE_MS);
  }

  async function clickCodexComposer() {
    const point = await getCodexComposerPoint();
    const clickTool = getClickTool();
    if (clickTool) {
      await runProcess(clickTool, [`c:${toCliclickAbsolutePoint(point)}`]);
    } else {
      await runProcess("osascript", [
        "-e",
        `tell application "System Events" to click at {${point}}`,
      ]);
    }
    await sleep(CODEX_CLICK_SETTLE_MS);
  }

  async function getCodexComposerPoint() {
    const tool = pointToolCandidates.find((candidate) => existsSync(candidate));
    if (tool) {
      const { stdout } = await runProcess(tool, []);
      const point = stdout.trim();
      if (/^-?\d+,-?\d+$/.test(point)) {
        return point;
      }
    }
    const { stdout } = await runProcess(
      "/usr/bin/swift",
      [resolve(repoRoot, "tools", "codex-window-point.swift")],
      { timeout: 8_000 },
    );
    const point = stdout.trim();
    if (/^-?\d+,-?\d+$/.test(point)) {
      return point;
    }
    throw new Error("找不到 Codex 桌面端输入框坐标");
  }

  function getClickTool() {
    for (const candidate of ["/opt/homebrew/bin/cliclick", "/usr/local/bin/cliclick"]) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  function toCliclickAbsolutePoint(point: string) {
    return point
      .split(",")
      .map((part) => (part.startsWith("-") ? `=${part}` : part))
      .join(",");
  }

  async function copyTextToClipboard(text: string) {
    const filePath = join(
      tmpdir(),
      `codex-relay-clipboard-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}.txt`,
    );
    writeFileSync(filePath, String(text ?? ""), "utf8");
    try {
      await runProcess("/usr/bin/osascript", [
        "-e",
        `set the clipboard to (read (POSIX file "${appleScriptString(filePath)}") as «class utf8»)`,
      ]);
    } finally {
      rmSync(filePath, { force: true });
    }
  }

  async function pressPaste() {
    await runProcess("osascript", [
      "-e",
      'tell application "System Events" to keystroke "v" using command down',
    ]);
  }

  async function pressEnter() {
    await runProcess("osascript", ["-e", 'tell application "System Events" to key code 36']);
  }

  async function pressPasteAndEnter() {
    await pressPaste();
    await sleep(TEXT_PASTE_SETTLE_MS);
    await pressEnter();
  }

  async function pressCodexShortcut(key: string, modifiers: string[]) {
    const modifierExpr = modifiers.length
      ? ` using {${modifiers.map((item) => `${item} down`).join(", ")}}`
      : "";
    await runProcess("osascript", [
      "-e",
      `tell application "System Events" to keystroke "${appleScriptString(key)}"${modifierExpr}`,
    ]);
  }

  async function pressCancelCodexResponse() {
    await runProcess("osascript", [
      "-e",
      `
tell application "System Events"
  key code 53
  delay 0.08
  keystroke "." using command down
end tell
`,
    ]);
  }

  function resolveModelTarget(target = "") {
    const models = listModels();
    const explicit = String(target ?? "").trim();
    const match = models.find(
      (model) =>
        model.id === explicit ||
        model.key === explicit ||
        model.displayName === explicit ||
        model.displayName.toLowerCase() === explicit.toLowerCase(),
    );
    if (match) {
      return match;
    }
    if (!explicit && models.length > 0) {
      return models[0]!;
    }
    if (explicit) {
      return { key: explicit, id: explicit, displayName: explicit, source: "local" as const };
    }
    throw new Error("没有读取到可切换的模型");
  }

  function resolveReasoningModeTarget(target = "") {
    const explicit = String(target ?? "")
      .trim()
      .toLowerCase();
    if (REASONING_MODE_TARGETS[explicit]) {
      return REASONING_MODE_TARGETS[explicit]!;
    }
    const order = ["low", "medium", "high", "xhigh"];
    const next = order[(order.indexOf(explicit) + 1) % order.length] || "medium";
    return REASONING_MODE_TARGETS[next] ?? REASONING_MODE_TARGETS.medium!;
  }

  function listModels(): LocalDesktopModel[] {
    const configText = readCodexConfigText();
    const catalogPath = tomlStringValue(configText, "model_catalog_json");
    const resolvedPath = catalogPath.startsWith("~")
      ? join(homedir(), catalogPath.slice(1))
      : catalogPath;
    const fallback = () => {
      const current = tomlStringValue(configText, "model");
      return current
        ? [
            {
              key: current,
              id: current,
              displayName: current,
              source: "local" as const,
            },
          ]
        : [];
    };
    if (!resolvedPath || !existsSync(resolvedPath)) {
      return fallback();
    }
    try {
      const parsed = JSON.parse(readFileSync(resolvedPath, "utf8")) as {
        models?: Array<{
          slug?: string;
          id?: string;
          model?: string;
          display_name?: string;
          name?: string;
          label?: string;
          visibility?: string;
        }>;
      };
      const models = (parsed.models ?? [])
        .filter((row) => row && row.visibility !== "hide")
        .map((row) => {
          const id = String(row.slug || row.id || row.model || "").trim();
          if (!id) {
            return null;
          }
          const displayName = String(row.display_name || row.name || row.label || id).trim();
          return {
            key: id,
            id,
            displayName: displayName || id,
            source: "local" as const,
          };
        })
        .filter((model): model is LocalDesktopModel => Boolean(model));
      return models.length > 0 ? models : fallback();
    } catch {
      return fallback();
    }
  }

  return {
    ensureAvailable,
    isAvailable,
    launchApp,
    openThread,
    sendPrompt,
    newThread,
    stop,
    selectModel,
    selectReasoningMode,
    threadAction,
    listModels,
  };

  async function isCodexAppRunning() {
    try {
      await execFileAsync("/bin/pgrep", ["-f", `${appPath}/Contents/MacOS/ChatGPT`]);
      return true;
    } catch {
      return false;
    }
  }

  function sessionIndexThreadIds() {
    const indexPath = join(env.CODEX_HOME || join(homedir(), ".codex"), "session_index.jsonl");
    if (!existsSync(indexPath)) {
      return new Set<string>();
    }
    const ids = new Set<string>();
    for (const line of readFileSync(indexPath, "utf8").split("\n")) {
      try {
        const record = JSON.parse(line) as { id?: unknown };
        if (typeof record.id === "string" && /^[a-f0-9-]{27,}$/i.test(record.id)) {
          ids.add(record.id);
        }
      } catch {
        // Ignore malformed session index entries.
      }
    }
    return ids;
  }

  async function getCdpTargets(): Promise<Array<Record<string, unknown>>> {
    return new Promise((resolvePromise, reject) => {
      const request = http.get(
        `http://${cdpAddress}:${cdpPort}/json/list`,
        { timeout: 2_000 },
        (response) => {
          let body = "";
          response.on("data", (chunk) => {
            body += String(chunk);
          });
          response.on("end", () => {
            try {
              resolvePromise(JSON.parse(body) as Array<Record<string, unknown>>);
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      request.on("error", reject);
      request.on("timeout", () => {
        request.destroy();
        reject(new Error("CDP 端口连接超时"));
      });
    });
  }

  function findCodexTarget(targets: Array<Record<string, unknown>>) {
    const pages = targets.filter(
      (target) => target.type === "page" && typeof target.webSocketDebuggerUrl === "string",
    );
    return (
      pages.find((target) => String(target.url || "") === "app://-/index.html") ??
      pages.find(
        (target) =>
          String(target.url || "").startsWith("app://-/index.html") &&
          !String(target.url || "").includes("avatar-overlay"),
      ) ??
      pages.find(
        (target) =>
          String(target.url || "").startsWith("app://-/index.html") ||
          String(target.title || "")
            .toLowerCase()
            .includes("codex"),
      )
    );
  }

  function findCodexPageTargets(targets: Array<Record<string, unknown>>) {
    return targets
      .filter(
        (target) =>
          target.type === "page" &&
          typeof target.webSocketDebuggerUrl === "string" &&
          (String(target.url || "") === "app://-/index.html" ||
            (String(target.url || "").startsWith("app://-/index.html") &&
              !String(target.url || "").includes("avatar-overlay")) ||
            String(target.title || "")
              .toLowerCase()
              .includes("codex")),
      )
      .sort((left, right) => {
        const leftUrl = String(left.url || "");
        const rightUrl = String(right.url || "");
        const score = (url: string) =>
          url === "app://-/index.html"
            ? 2
            : url.startsWith("app://-/index.html") && !url.includes("avatar-overlay")
              ? 1
              : 0;
        return score(rightUrl) - score(leftUrl);
      });
  }

  async function connectToWebSocket(url: string) {
    const ws = new WebSocket(url, { handshakeTimeout: 5_000 });
    await new Promise<void>((resolvePromise, reject) => {
      ws.once("open", resolvePromise);
      ws.once("error", reject);
    });
    return ws;
  }

  function sendCommand(ws: WebSocket, method: string, params: Record<string, unknown>) {
    return new Promise<{ result?: { value?: unknown } }>((resolvePromise, reject) => {
      const id = Math.floor(Math.random() * 1_000_000) + 1;
      const timer = setTimeout(() => reject(new Error(`CDP 命令超时: ${method}`)), 5_000);
      const handler = (data: WebSocket.RawData) => {
        try {
          const message = JSON.parse(String(data)) as {
            error?: { message?: string };
            id?: number;
            result?: { value?: unknown };
          };
          if (message.id === id) {
            clearTimeout(timer);
            ws.off("message", handler);
            if (message.error) {
              reject(new Error(message.error.message ?? "CDP error"));
            } else {
              resolvePromise({ result: message.result });
            }
          }
        } catch {
          // Ignore non-JSON CDP frames.
        }
      };
      ws.on("message", handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  function focusEditorExpression() {
    return `(function(){
      const selectors = [".ProseMirror", "textarea", "[contenteditable='true']", "[data-testid='composer']", "[data-testid='prompt-textarea']"];
      for (const selector of selectors) {
        const editor = document.querySelector(selector);
        if (editor) {
          editor.focus();
          return true;
        }
      }
      return false;
    })()`;
  }

  function composerInfoExpression() {
    return `(function(){
      const selectors = [".ProseMirror", "textarea", "[contenteditable='true']", "[data-testid='composer']", "[data-testid='prompt-textarea']"];
      for (const selector of selectors) {
        const editor = document.querySelector(selector);
        if (!editor) continue;
        const rect = editor.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return { found: true, x: rect.left + rect.width / 2, y: rect.top + Math.min(rect.height / 2, 40) };
        }
      }
      return { found: false };
    })()`;
  }

  function clickSendButtonExpression() {
    return `(function(){
      const selectors = [
        "button[type='submit']",
        "button[aria-label*='发送']",
        "button[aria-label*='send']",
        "[data-testid*='send']",
        "[data-testid*='composer-submit']"
      ];
      for (const selector of selectors) {
        const button = document.querySelector(selector);
        if (button) {
          button.click();
          return true;
        }
      }
      const editor = document.querySelector(".ProseMirror");
      if (editor) {
        const e = new KeyboardEvent("keydown", {key:"Enter", code:"Enter", keyCode:13, which:13, bubbles:true, cancelable:true});
        editor.dispatchEvent(e);
        return true;
      }
      return false;
    })()`;
  }
}

function readCodexConfigText() {
  try {
    return readFileSync(join(homedir(), ".codex", "config.toml"), "utf8");
  } catch {
    return "";
  }
}

function tomlStringValue(text: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^\\s*${escaped}\\s*=\\s*"([^"]*)"\\s*$`, "m"));
  return match ? match[1]! : "";
}

function appleScriptString(value: string) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function runProcess(command: string, args: string[], options: { timeout?: number } = {}) {
  try {
    return await execFileAsync(command, args, {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: options.timeout,
    });
  } catch (error) {
    const raw = String((error as { stderr?: string })?.stderr || errorMessage(error));
    const lower = raw.toLowerCase();
    if (
      lower.includes("assistive") ||
      lower.includes("accessibility") ||
      lower.includes("-25211") ||
      lower.includes("not allowed") ||
      lower.includes("not authorized")
    ) {
      throw new Error(
        "Mac 还没有允许这个终端控制键盘。请到 系统设置 → 隐私与安全性 → 辅助功能，允许当前终端，然后重启服务再试。",
      );
    }
    throw error;
  }
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
