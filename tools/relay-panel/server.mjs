#!/usr/bin/env node
// Codex Relay 控制面板后端：一键启动 17878 服务、展示配对二维码、批准设备配对。
// 用法：node tools/relay-panel/server.mjs   然后浏览器打开 http://127.0.0.1:7800

import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { connect } from "node:net";
import { homedir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PANEL_PORT = Number(process.env.PANEL_PORT ?? 7800);
const RELAY_PORT = Number(process.env.RELAY_PORT ?? 17878);
const PANEL_TOKEN = process.env.PANEL_TOKEN ?? "000214";
// 公网地址不写死：设置 PUBLIC_URL 环境变量才会生成公网配对码（如 http://host:8789）
const PUBLIC_URL = process.env.PUBLIC_URL ?? "";
const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const PUBLIC_DIR = resolve(import.meta.dirname, "public");

function appDataDir() {
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "codex-relay");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "codex-relay");
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "codex-relay");
}

const DATA_DIR = appDataDir();

function nodeRuntimeBin() {
  return process.env.NODE_BIN?.trim() || process.execPath;
}

let relayProcess = null;
let relayLog = [];
let pairingPayload = "";
let publicPairingPayload = "";
let connectUrl = "";
let candidateUrls = [];

function appendLog(text) {
  relayLog.push(String(text));
  if (relayLog.length > 600) {
    relayLog = relayLog.slice(-600);
  }
}

function normalizePairingCode(code) {
  const raw = String(code ?? "").trim().toUpperCase();
  const digits = raw.replace(/[^A-Z0-9]/g, "");
  if (digits.length !== 8) {
    return "";
  }
  return `${digits.slice(0, 4)}-${digits.slice(4, 8)}`;
}

function isRelayPortBusy() {
  // 通过检查端口是否可连接来粗判（连接失败且非 ECONNREFUSED 视为占用）
  return new Promise((resolveBusy) => {
    const socket = connect(RELAY_PORT, "127.0.0.1");
    socket.setTimeout(800);
    socket.on("connect", () => {
      socket.destroy();
      resolveBusy(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolveBusy(true);
    });
    socket.on("error", (error) => {
      socket.destroy();
      resolveBusy(error.code !== "ECONNREFUSED");
    });
  });
}

function startRelay() {
  if (relayProcess) {
    return { ok: true, alreadyRunning: true };
  }
  const relayBin = process.env.RELAY_BIN;
  const relayEnv = {
    ...process.env,
    NODE_BIN: nodeRuntimeBin(),
    HOST: process.env.HOST ?? "0.0.0.0",
    PORT: String(RELAY_PORT),
    ELECTRON_RUN_AS_NODE: "1",
  };
  const child = relayBin
    ? spawn(nodeRuntimeBin(), [relayBin], {
        cwd: dirname(relayBin),
        env: relayEnv,
      })
    : spawn(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["dev"], {
        cwd: REPO_ROOT,
        env: relayEnv,
        shell: process.platform === "win32",
      });
  relayProcess = child;

  const onData = (chunk) => {
    const text = chunk.toString();
    appendLog(text);
    const pairMatch = text.match(/Pairing:\s*(codex-relay:\/\/\S+)/);
    if (pairMatch) {
      pairingPayload = pairMatch[1];
    }
    const mobileMatch = text.match(/Mobile:\s*(\S+)/);
    if (mobileMatch) {
      connectUrl = mobileMatch[1];
    }
    const candidateMatch = text.match(/candidate addresses:\s*(\d+)/i);
    if (candidateMatch) {
      candidateUrls = [];
    }
    const urlMatch = text.match(/^\s*(?:https?:\/\/\S+)/m);
    if (urlMatch && candidateUrls.indexOf(urlMatch[1]) < 0) {
      candidateUrls.push(urlMatch[1]);
    }
  };

  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("exit", (code, signal) => {
    appendLog(`\n[服务已退出 code=${code} signal=${signal}]\n`);
    if (relayProcess === child) {
      relayProcess = null;
    }
  });
  child.on("error", (error) => {
    appendLog(`[启动失败: ${error.message}]`);
    relayProcess = null;
  });

  return { ok: true, pid: child.pid };
}

function stopRelay() {
  if (!relayProcess) {
    return { ok: true, alreadyStopped: true };
  }
  const child = relayProcess;
  relayProcess = null;
  if (process.platform === "win32") {
    child.kill();
  } else {
    child.kill("SIGTERM");
  }
  setTimeout(() => {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }, 3000).unref();
  appendLog("[正在停止服务...]");
  return { ok: true };
}

async function buildAndRestartRelay() {
  const results = [];

  // 1. 重新构建服务端 dist（仅项目源码环境有 tsdown）
  const tsdownBin = resolve(REPO_ROOT, "node_modules", ".bin", "tsdown");
  const hasTsdown = await readFile(tsdownBin).then(() => true).catch(() => false);
  if (hasTsdown) {
    try {
      const { stdout, stderr } = await execFileAsync(
        nodeRuntimeBin(),
        [tsdownBin],
        {
          cwd: resolve(REPO_ROOT, "packages", "codex-relay"),
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            PATH: process.platform === "darwin"
              ? `/opt/homebrew/bin:${process.env.PATH ?? ""}`
              : process.env.PATH ?? "",
          },
          maxBuffer: 8 * 1024 * 1024,
        },
      );
      results.push(`✅ 构建成功\n${(stdout + stderr).trim()}`);
    } catch (error) {
      return { ok: false, message: `❌ 构建失败：${error.stderr || error.message}` };
    }
  } else {
    results.push("⚠️ 未找到 tsdown（桌面版环境跳过构建）");
  }

  // 2. 重启服务：优先 launchd 托管，否则重启面板启动的进程
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (uid !== undefined) {
    try {
      await execFileAsync("launchctl", ["kickstart", "-k", `gui/${uid}/com.codexrelay.project`]);
      results.push("✅ 已通过 launchd 重启服务");
    } catch (error) {
      results.push(`⚠️ launchd 重启失败：${error.message}，改用面板内重启`);
      stopRelay();
      startRelay();
      results.push("✅ 已在面板内重启服务");
    }
  } else {
    stopRelay();
    startRelay();
    results.push("✅ 已在面板内重启服务");
  }
  return { ok: true, message: results.join("\n") };
}

async function readApprovalSecret() {
  if (process.env.CODEX_RELAY_APPROVAL_SECRET) {
    return process.env.CODEX_RELAY_APPROVAL_SECRET;
  }
  try {
    return (await readFile(join(DATA_DIR, "approval-secret"), "utf8")).trim();
  } catch {
    return "";
  }
}

async function readServerStateFromDisk() {
  try {
    const text = await readFile(join(DATA_DIR, "server-state.json"), "utf8");
    const state = JSON.parse(text);
    return {
      pairingPayload: typeof state.pairingPayload === "string" ? state.pairingPayload : "",
      connectUrl: typeof state.connectUrl === "string" ? state.connectUrl : "",
      candidateUrls: Array.isArray(state.connectUrlCandidates)
        ? state.connectUrlCandidates
            .map((item) => (item && typeof item.url === "string" ? item.url : ""))
            .filter(Boolean)
        : [],
    };
  } catch {
    return { pairingPayload: "", connectUrl: "", candidateUrls: [] };
  }
}

async function refreshStateFromDisk() {
  const disk = await readServerStateFromDisk();
  if (disk.pairingPayload) {
    pairingPayload = disk.pairingPayload;
    publicPairingPayload = buildPublicPairingPayload(disk.pairingPayload);
  }
  if (disk.connectUrl) {
    connectUrl = disk.connectUrl;
  }
  if (disk.candidateUrls.length > 0) {
    candidateUrls = disk.candidateUrls;
  }
}

function buildPublicPairingPayload(payload) {
  if (!payload || !PUBLIC_URL) {
    return "";
  }
  const encodedPublicUrl = encodeURIComponent(PUBLIC_URL);
  return payload.replace(/serverUrl=[^&]+/, `serverUrl=${encodedPublicUrl}`);
}

async function approveCode(rawCode) {
  const approvalCode = normalizePairingCode(rawCode);
  if (!approvalCode) {
    return { ok: false, message: "配对码格式应为 XXXX-XXXX（8 位字母数字）" };
  }
  const secret = await readApprovalSecret();
  if (!secret) {
    return { ok: false, message: "读取不到审批密钥（approval-secret）" };
  }
  try {
    const response = await fetch(`http://127.0.0.1:${RELAY_PORT}/v1/pair/approve`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-codex-relay-approve-secret": secret,
      },
      body: JSON.stringify({ approvalCode }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        payload && payload.error && typeof payload.error === "object" && payload.error.message
          ? String(payload.error.message)
          : `批准失败（HTTP ${response.status}）`;
      return { ok: false, status: response.status, message };
    }
    return { ok: true, status: response.status, message: "配对已批准" };
  } catch (error) {
    return { ok: false, message: `无法连接服务：${error.message}` };
  }
}

async function allowWindowsFirewall() {
  if (process.platform !== "win32") {
    return { ok: true, message: "当前系统无需添加 Windows 防火墙规则。" };
  }
  const nodeBin = nodeRuntimeBin();
  if (!nodeBin) {
    return { ok: false, message: "未找到内置 Node.js 运行时，无法添加防火墙规则。" };
  }
  const ruleName = `Codex Relay Panel TCP ${RELAY_PORT}`;
  const firewallArgs = [
    "advfirewall",
    "firewall",
    "add",
    "rule",
    `name=${ruleName}`,
    "dir=in",
    "action=allow",
    "protocol=TCP",
    `localport=${RELAY_PORT}`,
    `program=${nodeBin}`,
    "profile=private,domain",
  ];
  try {
    await execFileAsync("netsh", firewallArgs, {
      timeout: 15_000,
      windowsHide: true,
    });
    return {
      ok: true,
      message: `已添加防火墙规则：${ruleName}，手机应该能通过局域网地址访问 Relay。`,
    };
  } catch (error) {
    const quotedArgs = firewallArgs.map((arg) => `'${arg.replace(/'/g, "''")}'`).join(", ");
    const powershellCommand = `Start-Process -FilePath 'netsh.exe' -ArgumentList @(${quotedArgs}) -Verb RunAs -Wait`;
    try {
      await execFileAsync("powershell.exe", ["-NoProfile", "-Command", powershellCommand], {
        timeout: 60_000,
        windowsHide: true,
      });
      return {
        ok: true,
        message: `已通过管理员授权添加防火墙规则：${ruleName}，请重新扫码配对。`,
      };
    } catch (elevationError) {
      return {
        ok: false,
        message: `无法自动添加防火墙规则：${elevationError.message}。请手动允许 ${nodeBin} 访问专用网络。`,
      };
    }
  }
}

async function status() {
  await refreshStateFromDisk();
  const busy = await isRelayPortBusy();
  return {
    relayPort: RELAY_PORT,
    relayRunning: Boolean(relayProcess) || busy,
    pairingPayload,
    publicPairingPayload,
    publicUrl: PUBLIC_URL,
    connectUrl,
    candidateUrls,
    log: relayLog.slice(-120).join(""),
  };
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

async function serveStatic(req, res) {
  const urlPath = req.url.split("?")[0];
  const filePath = urlPath === "/" ? join(PUBLIC_DIR, "index.html") : join(PUBLIC_DIR, urlPath);
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  }
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PANEL_PORT}`);
  const path = url.pathname;

  try {
    // 所有 API 请求都需要访问密码（/api/auth 本身除外），页面静态文件可公开加载
    if (path.startsWith("/api/") && path !== "/api/auth") {
      const provided = req.headers["x-panel-token"];
      if (provided !== PANEL_TOKEN) {
        return sendJson(res, 401, { ok: false, message: "需要访问密码" });
      }
    }

    if (req.method === "POST" && path === "/api/auth") {
      const body = await readBody(req);
      if (body.token === PANEL_TOKEN) {
        return sendJson(res, 200, { ok: true, message: "密码正确" });
      }
      return sendJson(res, 401, { ok: false, message: "访问密码错误" });
    }

    if (req.method === "POST" && path === "/api/start") {
      const busy = await isRelayPortBusy();
      if (busy && !relayProcess) {
        return sendJson(res, 200, {
          ok: true,
          message: `${RELAY_PORT} 端口已有服务在运行（可能是之前启动的），无需重复启动`,
          alreadyRunning: true,
          ...(await status()),
        });
      }
      const result = startRelay();
      return sendJson(res, 200, {
        ok: true,
        message: result.alreadyRunning ? "服务已在运行" : `服务已启动（pid=${result.pid}）`,
        ...(await status()),
      });
    }

    if (req.method === "POST" && path === "/api/stop") {
      const result = stopRelay();
      return sendJson(res, 200, {
        ok: true,
        message: result.alreadyStopped ? "服务未在运行" : "服务已停止",
        ...(await status()),
      });
    }

    if (req.method === "POST" && path === "/api/build-restart") {
      const result = await buildAndRestartRelay();
      return sendJson(res, result.ok ? 200 : 400, {
        ...result,
        ...(await status()),
      });
    }

    if (req.method === "POST" && path === "/api/approve") {
      const body = await readBody(req);
      const result = await approveCode(body.code);
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (req.method === "POST" && path === "/api/firewall-allow") {
      const result = await allowWindowsFirewall();
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (req.method === "GET" && path === "/api/status") {
      return sendJson(res, 200, await status());
    }

    if (req.method === "GET" && path === "/api/pairing") {
      await refreshStateFromDisk();
      return sendJson(res, 200, {
        pairingPayload,
        publicPairingPayload,
        publicUrl: PUBLIC_URL,
        connectUrl,
        candidateUrls,
      });
    }

    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { ok: false, message: String(error?.message ?? error) });
  }
});

server.listen(PANEL_PORT, "127.0.0.1", () => {
  console.log("");
  console.log("  Codex Relay 控制面板已启动");
  console.log(`  打开浏览器访问: http://127.0.0.1:${PANEL_PORT}`);
  console.log(`  管理 Relay 端口: ${RELAY_PORT}`);
  console.log("");
});

process.on("SIGINT", () => {
  stopRelay();
  process.exit(0);
});
