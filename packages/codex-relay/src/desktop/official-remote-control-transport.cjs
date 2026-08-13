// FILE: official-remote-control-transport.js
// Purpose: Connects Remodex to Codex Desktop through the official Remote Control WebSocket.
// Layer: Codex transport
// Exports: createOfficialRemoteControlTransport
// Depends on: crypto, fs, child_process, ws

const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { createRequire } = require("module");
const WebSocket = require("ws");

const execFileAsync = promisify(execFile);
const CHATGPT_BACKEND_ORIGIN = "https://chatgpt.com";
const REMOTE_CONTROL_CLIENT_PATH = "/backend-api/wham/remote/control/client";
const DEVICE_KEY_MODULE_PATH = "/Applications/Codex.app/Contents/Resources/native/remote-control-device-key.node";
const REMODEX_STORE_FILE = "official-codex-remote-control.json";

class OfficialRemoteControlTransportError extends Error {
  constructor(message, type = "official_remote_control_error") {
    super(message);
    this.name = "OfficialRemoteControlTransportError";
    this.type = type;
  }
}

function createOfficialRemoteControlTransport({
  env = process.env,
  WebSocketImpl = WebSocket,
  fetchImpl = fetch,
  execFileAsyncImpl = execFileAsync,
  appPath = "",
} = {}) {
  const listeners = createListenerBag();
  const client = new OfficialRemoteControlTransportClient({
    env,
    WebSocketImpl,
    fetchImpl,
    execFileAsyncImpl,
    appPath,
    listeners,
  });

  return {
    mode: "official_remote_control",
    describe() {
      return "`Codex Desktop Remote Control`";
    },
    connect() {
      return client.connect();
    },
    isStarted() {
      return client.started === true;
    },
    send(message) {
      client.sendAppServerMessage(message).catch((error) => {
        listeners.emitError(error);
      });
    },
    onMessage(handler) {
      listeners.onMessage = handler;
    },
    onClose(handler) {
      listeners.onClose = handler;
    },
    onError(handler) {
      listeners.onError = handler;
    },
    onStarted(handler) {
      listeners.onStarted = handler;
    },
    shutdown() {
      client.shutdown();
    },
  };
}

class OfficialRemoteControlTransportClient {
  constructor({
    env,
    WebSocketImpl,
    fetchImpl,
    execFileAsyncImpl,
    appPath,
    listeners,
  }) {
    this.env = env;
    this.WebSocketImpl = WebSocketImpl;
    this.fetchImpl = fetchImpl;
    this.execFileAsync = execFileAsyncImpl;
    this.appPath = appPath;
    this.listeners = listeners;
    this.ws = null;
    this.chunkBuffer = new Map();
    this.session = null;
    this.enrollment = null;
    this.streamId = null;
    this.nextSeqId = 1;
    this.started = false;
    this.pendingMessages = [];
    this.softwarePrivateKeys = new Map();
    this.closedByUser = false;
  }

  async connect() {
    this.session = await this.restoreControllerSession();
    this.enrollment = await this.loadControllerEnrollment();
    if (!this.session || !this.enrollment) {
      throw new OfficialRemoteControlTransportError(
        "Codex Desktop Remote Control is not enrolled yet. Authorize it once with the existing codex-mobile-server flow, then restart Remodex.",
        "enrollment_required"
      );
    }

    const auth = await this.loadCodexAuth();
    if (!auth.accessToken) {
      throw new OfficialRemoteControlTransportError(
        "Codex Desktop auth was not found in ~/.codex/auth.json. Sign in to Codex Desktop first.",
        "codex_not_authorized"
      );
    }

    const accountId = auth.accountId || decodeChatGptAccountId(auth.accessToken) || "";
    const remoteControlToken = this.session.remoteControlToken;
    const tokenSha256Base64url = crypto.createHash("sha256").update(remoteControlToken).digest("base64url");
    const deviceKey = await this.createDeviceKeyClient();

    const ws = new this.WebSocketImpl(getClientWebsocketUrl(), {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "ChatGPT-Account-Id": accountId,
        "x-codex-client-id": this.enrollment.clientId,
        "x-codex-protocol-version": "3",
        "x-codex-client-session-token": `Bearer ${remoteControlToken}`,
        originator: "codex_desktop",
        "User-Agent": "Remodex/2.0.0",
      },
    });
    this.ws = ws;

    ws.on("message", async (data) => {
      try {
        const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
        const message = JSON.parse(text);
        await this.handleWebSocketMessage({
          message,
          deviceKey,
          remoteControlToken,
          tokenSha256Base64url,
        });
      } catch (error) {
        this.listeners.emitError(error);
      }
    });
    ws.on("open", () => {
      // The server sends a device_key_challenge immediately after open. We mark
      // started only after that challenge is signed.
    });
    ws.on("close", (code, reason) => {
      const safeReason = reason ? reason.toString("utf8") : "no reason";
      if (!this.closedByUser) {
        this.started = false;
        this.listeners.emitClose(code, safeReason);
      }
    });
    ws.on("error", (error) => {
      this.listeners.emitError(error);
    });

    await waitForOpen(ws, this.WebSocketImpl);
  }

  async sendAppServerMessage(rawMessage) {
    const trimmed = String(rawMessage || "").trim();
    if (!trimmed) {
      return;
    }

    if (!this.started || !isWebSocketOpen(this.ws, this.WebSocketImpl)) {
      this.pendingMessages.push(trimmed);
      return;
    }

    await this.sendAppServerJson(JSON.parse(trimmed));
  }

  async sendAppServerJson(payload) {
    if (!isWebSocketOpen(this.ws, this.WebSocketImpl)) {
      this.pendingMessages.push(JSON.stringify(payload));
      return;
    }

    const envId = await this.getControllerEnvironmentId();
    if (payload?.method === "initialize" || !this.streamId) {
      this.streamId = crypto.randomUUID();
      this.nextSeqId = 1;
    }

    this.ws.send(JSON.stringify({
      type: "client_message",
      client_id: this.session.clientId,
      stream_id: this.streamId,
      env_id: envId,
      skip_history: false,
      message: payload,
      seq_id: this.nextSeqId++,
    }));
  }

  async flushPendingMessages() {
    const pending = this.pendingMessages.splice(0);
    for (const message of pending) {
      await this.sendAppServerJson(JSON.parse(message));
    }
  }

  shutdown() {
    this.closedByUser = true;
    if (isWebSocketOpen(this.ws, this.WebSocketImpl) || isWebSocketConnecting(this.ws, this.WebSocketImpl)) {
      this.ws.close();
    }
  }

  async handleWebSocketMessage({
    message,
    deviceKey,
    remoteControlToken,
    tokenSha256Base64url,
  }) {
    if (message.type === "device_key_challenge") {
      await this.handleDeviceKeyChallenge({
        challenge: message,
        deviceKey,
        remoteControlToken,
        tokenSha256Base64url,
      });
      if (!this.started) {
        this.started = true;
        this.listeners.emitStarted({
          mode: "official_remote_control",
          launchDescription: "Codex Desktop Remote Control",
        });
      }
      await this.flushPendingMessages();
      return;
    }

    if (message.type === "ack" || message.type === "ping" || message.type === "pong") {
      return;
    }

    if (message.type === "server_message_chunk") {
      const chunkKey = message.stream_id || "default";
      const chunkData = message.chunk ?? message.payload ?? message.data ?? message.message;
      let chunkText = "";
      if (typeof chunkData === "string") {
        chunkText = chunkData;
      } else if (chunkData != null) {
        chunkText = JSON.stringify(chunkData);
      }
      if (chunkText) {
        const existing = this.chunkBuffer.get(chunkKey) || "";
        this.chunkBuffer.set(chunkKey, existing + chunkText);
      }
      return;
    }

    if (message.type === "server_message" && message.message) {
      const chunkKey = message.stream_id || message.client_id || "default";
      let payload = message.message;
      if (chunkKey && this.chunkBuffer?.has(chunkKey)) {
        const buffered = this.chunkBuffer.get(chunkKey) || "";
        this.chunkBuffer.delete(chunkKey);
        try {
          payload = JSON.parse(buffered + JSON.stringify(message.message));
        } catch {
          payload = message.message;
        }
      }
      this.listeners.emitMessage(JSON.stringify(payload));
      return;
    }

    if (typeof message.id === "number" || typeof message.method === "string") {
      this.listeners.emitMessage(JSON.stringify(message));
    }
  }

  async handleDeviceKeyChallenge({
    challenge,
    deviceKey,
    _remoteControlToken,
    tokenSha256Base64url,
  }) {
    const payloadInput = {
      accountUserId: this.enrollment.accountUserId,
      audience: requireString(challenge.audience, "challenge.audience"),
      clientId: this.enrollment.clientId,
      nonce: requireString(challenge.nonce, "challenge.nonce"),
      scopes: ["remote_control_controller_websocket"],
      sessionId: requireString(challenge.sessionId, "challenge.sessionId"),
      targetOrigin: requireString(challenge.targetOrigin ?? challenge.target_origin, "challenge.targetOrigin"),
      targetPath: requireString(challenge.targetPath ?? challenge.target_path, "challenge.targetPath"),
      tokenExpiresAt: this.session.tokenExpiresAt,
      tokenSha256Base64url,
    };
    const { innerPayload, signedPayloadBase64 } = buildDeviceKeySignedPayload({
      type: "remoteControlClientConnection",
      payload: payloadInput,
    });
    const signed = await deviceKey.signDeviceKey(this.enrollment.keyId, innerPayload);
    this.ws.send(JSON.stringify({
      type: "device_key_proof",
      keyId: this.enrollment.keyId,
      signatureDerBase64: signed.signatureDerBase64,
      signedPayloadBase64: signed.signedPayloadBase64 || signedPayloadBase64,
      algorithm: signed.algorithm,
    }));
  }

  async restoreControllerSession() {
    const accountId = await this.getCurrentCodexAccountId();
    if (!accountId) {
      return null;
    }
    let enrollment = await this.loadControllerEnrollmentForAccount(accountId);
    if (!enrollment) {
      await this.migrateLegacyEnrollmentStore(accountId);
      enrollment = await this.loadControllerEnrollmentForAccount(accountId);
    }
    if (!enrollment) {
      return null;
    }
    return this.refreshControllerToken(enrollment, accountId);
  }

  async refreshControllerToken(enrollment, accountId) {
    const auth = await this.loadCodexAuth();
    if (!auth.accessToken) {
      throw new OfficialRemoteControlTransportError("Codex auth token not found.", "codex_not_authorized");
    }
    const headers = this.buildBackendHeaders(auth.accessToken, accountId);
    const startResponse = await this.postOfficialJson(
      "/backend-api/codex/remote/control/client/refresh/start",
      { client_id: enrollment.clientId },
      headers
    );
    const challenge = startResponse?.device_key_challenge;
    if (!challenge) {
      throw new OfficialRemoteControlTransportError("Remote Control refresh challenge was missing.", "refresh_challenge_missing");
    }
    const deviceKey = await this.createDeviceKeyClient();
    const finishResponse = await this.postOfficialJson(
      "/backend-api/codex/remote/control/client/refresh/finish",
      {
        client_id: enrollment.clientId,
        device_key_proof: await this.signRefreshChallenge(deviceKey, enrollment, challenge),
      },
      headers
    );
    const tokenStatus = validateRemoteControlTokenResponse(finishResponse, enrollment);
    return {
      accountId,
      clientId: finishResponse.client_id,
      remoteControlToken: finishResponse.remote_control_token,
      tokenExpiresAt: tokenStatus.tokenExpiresAt,
      scopes: tokenStatus.scopes,
    };
  }

  async signRefreshChallenge(deviceKey, enrollment, challenge) {
    const payloadInput = {
      nonce: requireString(challenge.nonce, "challenge.nonce"),
      audience: "remote_control_client_enrollment",
      challengeId: requireString(challenge.challenge_id, "challenge.challenge_id"),
      targetOrigin: requireString(challenge.target_origin, "challenge.target_origin"),
      targetPath: requireString(challenge.target_path, "challenge.target_path"),
      accountUserId: enrollment.accountUserId,
      clientId: enrollment.clientId,
      deviceIdentitySha256Base64url: stringOrNull(challenge.device_identity_hash) ?? getDeviceIdentityHash(enrollment),
      challengeExpiresAt: getRaw(challenge.challenge_expires_at)
        ?? getRaw(challenge.challengeExpiresAt)
        ?? getRaw(challenge.expires_at)
        ?? getRaw(challenge.expiresAt),
    };
    const { innerPayload, signedPayloadBase64 } = buildDeviceKeySignedPayload({
      type: "remoteControlClientEnrollment",
      payload: payloadInput,
    });
    const signed = await deviceKey.signDeviceKey(enrollment.keyId, innerPayload);
    return {
      challenge_token: requireString(challenge.challenge_token, "challenge.challenge_token"),
      key_id: enrollment.keyId,
      signature_der_base64: signed.signatureDerBase64,
      signed_payload_base64: signedPayloadBase64,
      algorithm: signed.algorithm,
    };
  }

  async getControllerEnvironmentId() {
    const host = await this.getLatestHostEnrollment();
    if (!host?.environmentId) {
      throw new OfficialRemoteControlTransportError(
        "Codex Desktop Remote Control host enrollment was not found. Open Codex Desktop and enable Remote Control first.",
        "host_enrollment_not_found"
      );
    }
    return host.environmentId;
  }

  async getLatestHostEnrollment() {
    const dbPath = this.getCodexStateDbPath();
    if (!fs.existsSync(dbPath)) {
      return null;
    }
    const accountId = await this.getCurrentCodexAccountId();
    const where = accountId ? `WHERE account_id = '${escapeSqlString(accountId)}'` : "";
    const sql = `SELECT websocket_url, account_id, app_server_client_name, server_id, environment_id, server_name, updated_at FROM remote_control_enrollments ${where} ORDER BY updated_at DESC LIMIT 1;`;
    try {
      const { stdout } = await this.execFileAsync("/usr/bin/sqlite3", ["-json", dbPath, sql], {
        timeout: 5_000,
        maxBuffer: 1024 * 1024,
      });
      const rows = JSON.parse(stdout || "[]");
      const row = rows[0];
      if (!row) {
        return null;
      }
      return {
        websocketUrl: String(row.websocket_url || ""),
        accountId: String(row.account_id || ""),
        appServerClientName: String(row.app_server_client_name || ""),
        serverId: String(row.server_id || ""),
        environmentId: String(row.environment_id || ""),
        serverName: String(row.server_name || ""),
        updatedAt: Number(row.updated_at || 0),
      };
    } catch {
      return null;
    }
  }

  getCodexStateDbPath() {
    const explicit = normalizeNonEmptyString(this.env.REMODEX_CODEX_STATE_DB);
    if (explicit) {
      return explicit;
    }
    const home = getHomeDir(this.env);
    const newPath = path.join(home, ".codex", "sqlite", "state_5.sqlite");
    const oldPath = path.join(home, ".codex", "state_5.sqlite");
    return fs.existsSync(newPath) ? newPath : oldPath;
  }

  async loadCodexAuth() {
    try {
      const raw = await fsp.readFile(path.join(getHomeDir(this.env), ".codex", "auth.json"), "utf8");
      const parsed = JSON.parse(raw);
      return {
        accessToken: parsed.tokens?.access_token ?? null,
        accountId: parsed.tokens?.account_id ?? null,
      };
    } catch {
      return { accessToken: null, accountId: null };
    }
  }

  async getCurrentCodexAccountId() {
    const auth = await this.loadCodexAuth();
    if (!auth.accessToken) {
      return null;
    }
    return auth.accountId || decodeChatGptAccountId(auth.accessToken);
  }

  async loadControllerEnrollment() {
    const accountId = await this.getCurrentCodexAccountId();
    return this.loadControllerEnrollmentForAccount(accountId);
  }

  async loadControllerEnrollmentForAccount(accountId) {
    const store = await this.readControllerEnrollmentStore();
    if (accountId && store.accounts?.[accountId]?.enrollment) {
      return store.accounts[accountId].enrollment;
    }
    if (!accountId && store.lastAccountId && store.accounts?.[store.lastAccountId]?.enrollment) {
      return store.accounts[store.lastAccountId].enrollment;
    }
    return null;
  }

  async readControllerEnrollmentStore() {
    try {
      const raw = await fsp.readFile(this.getControllerStorePath(), "utf8");
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  async writeControllerEnrollmentStore(store) {
    const filePath = this.getControllerStorePath();
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp.${process.pid}`;
    await fsp.writeFile(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
    await fsp.rename(tmp, filePath);
  }

  async migrateLegacyEnrollmentStore(accountId) {
    const own = await this.readControllerEnrollmentStore();
    if (own.accounts?.[accountId]) {
      return;
    }
    for (const legacyPath of this.getLegacyControllerStorePaths()) {
      try {
        const raw = await fsp.readFile(legacyPath, "utf8");
        const legacy = JSON.parse(raw);
        const legacyEnrollment = legacy.accounts?.[accountId]?.enrollment
          ?? (legacy.lastAccountId === accountId ? legacy.enrollment : null);
        if (!legacyEnrollment) {
          continue;
        }
        const accounts = { ...own.accounts };
        accounts[accountId] = {
          enrollment: legacyEnrollment,
          updatedAt: Date.now(),
        };
        await this.writeControllerEnrollmentStore({
          version: 2,
          lastAccountId: accountId,
          accounts,
        });
        return;
      } catch {
        // Try the next legacy store.
      }
    }
  }

  getControllerStorePath() {
    return path.join(resolveRemodexStateDir(this.env), REMODEX_STORE_FILE);
  }

  getLegacyControllerStorePaths() {
    const home = getHomeDir(this.env);
    return [
      path.join(home, ".codex-mobile-server", REMODEX_STORE_FILE),
      path.join(home, ".claude", "cc-haha", REMODEX_STORE_FILE),
    ];
  }

  async createDeviceKeyClient() {
    const native = await this.loadDeviceKeyNative();
    const useSoftwareOnly = !native;
    return {
      createDeviceKey: async () => {
        const key = createSoftwareDeviceKey();
        this.softwarePrivateKeys.set(key.keyId, key.softwarePrivateKeyPkcs8Pem);
        return key;
      },
      deleteDeviceKey: async (keyId) => {
        this.softwarePrivateKeys.delete(keyId);
      },
      signDeviceKey: async (keyId, payload) => {
        const privateKey = this.softwarePrivateKeys.get(keyId)
          || (await this.loadSoftwareEnrollmentByKeyId(keyId))?.softwarePrivateKeyPkcs8Pem;
        if (privateKey) {
          return signWithSoftwareDeviceKey(privateKey, payload);
        }
        if (!useSoftwareOnly) {
          const wrapped = Buffer.isBuffer(payload)
            ? payload
            : Buffer.from(JSON.stringify({ domain: "codex-device-key-sign-payload/v1", payload }), "utf8");
          const nativeResult = await native.signDeviceKey(keyId, wrapped);
          return {
            ...nativeResult,
            signedPayloadBase64: nativeResult.signedPayloadBase64 ?? wrapped.toString("base64"),
          };
        }
        throw new OfficialRemoteControlTransportError(
          `Cannot sign with Codex Desktop device key ${keyId}.`,
          "device_key_unavailable"
        );
      },
    };
  }

  async loadDeviceKeyNative() {
    const modulePath = resolveDeviceKeyModulePath(this.appPath);
    try {
      const requireFromHere = createRequire(__filename);
      return requireFromHere(modulePath);
    } catch {
      return null;
    }
  }

  async loadSoftwareEnrollmentByKeyId(keyId) {
    const store = await this.readControllerEnrollmentStore();
    for (const item of Object.values(store.accounts || {})) {
      if (item.enrollment?.keyId === keyId && item.enrollment?.softwarePrivateKeyPkcs8Pem) {
        return item.enrollment;
      }
    }
    return null;
  }

  async postOfficialJson(pathname, body, headers) {
    const url = new URL(pathname, CHATGPT_BACKEND_ORIGIN);
    const requestHeaders = new Headers(headers);
    requestHeaders.set("content-type", "application/json");
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new OfficialRemoteControlTransportError(
        `Official Codex Remote Control HTTP ${response.status}: ${redactSensitiveText(text).slice(0, 500)}`,
        "official_request_failed"
      );
    }
    return text.trim() ? JSON.parse(text) : {};
  }

  buildBackendHeaders(accessToken, accountId) {
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${accessToken}`);
    headers.set("ChatGPT-Account-Id", accountId);
    headers.set("originator", "codex_desktop");
    headers.set("User-Agent", "Remodex/2.0.0");
    return headers;
  }
}

function waitForOpen(ws, WebSocketImpl) {
  const openState = WebSocketImpl.OPEN ?? WebSocket.OPEN ?? 1;
  if (ws.readyState === openState) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new OfficialRemoteControlTransportError("Codex Desktop Remote Control WebSocket timed out.", "websocket_timeout"));
    }, 10_000);
    ws.once?.("open", () => {
      clearTimeout(timeout);
      resolve();
    });
    ws.once?.("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function isWebSocketOpen(ws, WebSocketImpl) {
  return ws?.readyState === (WebSocketImpl.OPEN ?? WebSocket.OPEN ?? 1);
}

function isWebSocketConnecting(ws, WebSocketImpl) {
  return ws?.readyState === (WebSocketImpl.CONNECTING ?? WebSocket.CONNECTING ?? 0);
}

function getClientWebsocketUrl() {
  const url = new URL(REMOTE_CONTROL_CLIENT_PATH, CHATGPT_BACKEND_ORIGIN);
  url.protocol = "wss:";
  return url.toString();
}

function resolveDeviceKeyModulePath(appPath) {
  const trimmed = normalizeNonEmptyString(appPath);
  if (trimmed) {
    return path.join(trimmed, "Contents", "Resources", "native", "remote-control-device-key.node");
  }
  return DEVICE_KEY_MODULE_PATH;
}

function buildDeviceKeySignedPayload(input) {
  const payload = input.type === "remoteControlClientEnrollment"
    ? buildEnrollmentSignedPayload(input.payload)
    : buildConnectionSignedPayload(input.payload);
  const signedPayloadBuffer = Buffer.from(JSON.stringify({
    domain: "codex-device-key-sign-payload/v1",
    payload,
  }), "utf8");
  return {
    innerPayload: payload,
    signedPayloadBuffer,
    signedPayloadBase64: signedPayloadBuffer.toString("base64"),
  };
}

function buildEnrollmentSignedPayload(payload) {
  if (payload.challengeExpiresAt !== undefined && payload.challengeExpiresAt !== null) {
    return {
      accountUserId: payload.accountUserId,
      audience: payload.audience,
      challengeExpiresAt: payload.challengeExpiresAt,
      challengeId: payload.challengeId,
      clientId: payload.clientId,
      deviceIdentitySha256Base64url: payload.deviceIdentitySha256Base64url,
      nonce: payload.nonce,
      targetOrigin: payload.targetOrigin,
      targetPath: payload.targetPath,
      type: "remoteControlClientEnrollment",
    };
  }
  return {
    accountUserId: payload.accountUserId,
    audience: payload.audience,
    challengeId: payload.challengeId,
    clientId: payload.clientId,
    deviceIdentitySha256Base64url: payload.deviceIdentitySha256Base64url,
    nonce: payload.nonce,
    targetOrigin: payload.targetOrigin,
    targetPath: payload.targetPath,
    type: "remoteControlClientEnrollment",
  };
}

function buildConnectionSignedPayload(payload) {
  return {
    accountUserId: payload.accountUserId,
    audience: payload.audience,
    clientId: payload.clientId,
    nonce: payload.nonce,
    scopes: payload.scopes,
    sessionId: payload.sessionId,
    targetOrigin: payload.targetOrigin,
    targetPath: payload.targetPath,
    tokenExpiresAt: payload.tokenExpiresAt,
    tokenSha256Base64url: payload.tokenSha256Base64url,
    type: "remoteControlClientConnection",
  };
}

function validateRemoteControlTokenResponse(response, enrollment) {
  if (response.client_id !== enrollment.clientId || response.account_user_id !== enrollment.accountUserId) {
    throw new OfficialRemoteControlTransportError("Remote Control token response did not match the saved enrollment.", "token_mismatch");
  }
  if (!response.remote_control_token) {
    throw new OfficialRemoteControlTransportError("Remote Control token response did not include a token.", "token_missing");
  }
  const tokenExpiresAt = Date.parse(response.expires_at);
  if (!Number.isFinite(tokenExpiresAt) || tokenExpiresAt <= Date.now()) {
    throw new OfficialRemoteControlTransportError("Remote Control token response has an invalid expiration.", "token_invalid");
  }
  const scopes = Array.isArray(response.scopes) ? response.scopes : [];
  if (scopes.length !== 1 || scopes[0] !== "remote_control_controller_websocket") {
    throw new OfficialRemoteControlTransportError("Remote Control token response has unexpected scopes.", "token_scope_invalid");
  }
  return {
    tokenExpiresAt: Math.floor(tokenExpiresAt / 1000),
    scopes,
  };
}

function getDeviceIdentityHash(enrollment) {
  return crypto.createHash("sha256").update(JSON.stringify({
    algorithm: enrollment.algorithm,
    keyId: enrollment.keyId,
    protectionClass: enrollment.protectionClass,
    publicKeySpkiDerBase64: enrollment.publicKeySpkiDerBase64,
  })).digest("base64url");
}

function createSoftwareDeviceKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    keyId: `remodex-${crypto.randomUUID()}`,
    publicKeySpkiDerBase64: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    algorithm: "ecdsa_p256_sha256",
    protectionClass: "os_protected_nonextractable",
    softwarePrivateKeyPkcs8Pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function signWithSoftwareDeviceKey(privateKeyPkcs8Pem, payload) {
  const buf = Buffer.from(JSON.stringify({ domain: "codex-device-key-sign-payload/v1", payload }), "utf8");
  return {
    signatureDerBase64: crypto.sign("sha256", buf, privateKeyPkcs8Pem).toString("base64"),
    algorithm: "ecdsa_p256_sha256",
    signedPayloadBase64: buf.toString("base64"),
  };
}

function decodeChatGptAccountId(accessToken) {
  const parts = String(accessToken || "").split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const claims = JSON.parse(Buffer.from(base64UrlToBase64(parts[1]), "base64").toString("utf8"));
    const legacyAccountId = claims["https://api.openai.com/auth.chatgpt_account_id"];
    const auth = claims["https://api.openai.com/auth"];
    const authClaims = auth && typeof auth === "object" && !Array.isArray(auth) ? auth : {};
    return stringOrNull(authClaims.chatgpt_account_id)
      ?? stringOrNull(authClaims.account_id)
      ?? stringOrNull(legacyAccountId);
  } catch {
    return null;
  }
}

function resolveRemodexStateDir(env = process.env) {
  return normalizeNonEmptyString(env.REMODEX_DEVICE_STATE_DIR)
    || path.join(getHomeDir(env), ".remodex");
}

function getHomeDir(env = process.env) {
  return env.HOME || os.homedir();
}

function base64UrlToBase64(value) {
  return String(value || "").replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(value || "").length / 4) * 4, "=");
}

function requireString(value, label) {
  if (typeof value !== "string" || !value) {
    throw new OfficialRemoteControlTransportError(`Remote Control challenge is missing ${label}.`, "bad_challenge");
  }
  return value;
}

function getRaw(value) {
  if (typeof value === "number" && !Number.isNaN(value)) {
    return value;
  }
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return undefined;
}

function stringOrNull(value) {
  return typeof value === "string" && value ? value : null;
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function escapeSqlString(value) {
  return String(value || "").replaceAll("'", "''");
}

function redactSensitiveText(value) {
  return String(value || "")
    .replace(/"access_token"\s*:\s*"[^"]+"/gi, '"access_token":"[redacted]"')
    .replace(/"remote_control_token"\s*:\s*"[^"]+"/gi, '"remote_control_token":"[redacted]"')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]");
}

function createListenerBag() {
  return {
    onMessage: null,
    onClose: null,
    onError: null,
    onStarted: null,
    emitMessage(message) {
      this.onMessage?.(message);
    },
    emitClose(...args) {
      this.onClose?.(...args);
    },
    emitError(error) {
      this.onError?.(error);
    },
    emitStarted(info) {
      this.onStarted?.(info);
    },
  };
}

module.exports = {
  OfficialRemoteControlTransportError,
  buildDeviceKeySignedPayload,
  createOfficialRemoteControlTransport,
  decodeChatGptAccountId,
};
