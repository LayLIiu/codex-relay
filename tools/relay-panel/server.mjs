#!/usr/bin/env node
// Codex Relay 控制面板后端：一键启动 17878 服务、展示配对二维码、批准设备配对。
// 用法：node tools/relay-panel/server.mjs   然后浏览器打开 http://127.0.0.1:7800

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { connect } from "node:net";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";

const PANEL_PORT = Number(process.env.PANEL_PORT ?? 7800);
const RELAY_PORT = Number(process.env.RELAY_PORT ?? 17878);
const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const PUBLIC_DIR = resolve(import.meta.dirname, "public");
const DATA_DIR = join(homedir(), "Library", "Application Support", "codex-relay");

let relayProcess = null;
let relayLog = [];
let pairingPayload = "";
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
  const child = spawn("pnpm", ["dev"], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(RELAY_PORT) },
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
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }, 3000).unref();
  appendLog("[正在停止服务...]");
  return { ok: true };
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
  }
  if (disk.connectUrl) {
    connectUrl = disk.connectUrl;
  }
  if (disk.candidateUrls.length > 0) {
    candidateUrls = disk.candidateUrls;
  }
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

async function status() {
  await refreshStateFromDisk();
  const busy = await isRelayPortBusy();
  return {
    relayPort: RELAY_PORT,
    relayRunning: Boolean(relayProcess) || busy,
    pairingPayload,
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

    if (req.method === "POST" && path === "/api/approve") {
      const body = await readBody(req);
      const result = await approveCode(body.code);
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (req.method === "GET" && path === "/api/status") {
      return sendJson(res, 200, await status());
    }

    if (req.method === "GET" && path === "/api/pairing") {
      await refreshStateFromDisk();
      return sendJson(res, 200, {
        pairingPayload,
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
