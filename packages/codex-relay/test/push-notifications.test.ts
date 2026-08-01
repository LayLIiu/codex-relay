import {
  constants as cryptoConstants,
  generateKeyPairSync,
  verify as verifySignature,
} from "node:crypto";

import { describe, expect, it } from "vitest";

import { createTursoPairingSessionStore } from "../src/pairing-store.js";
import {
  createExpoPushNotificationSender,
  createHmsPushNotificationSender,
  createPushNotificationDispatcher,
  loadHmsPushConfiguration,
  type HmsPushConfiguration,
  type PushNotificationSender,
  type RelayPushNotification,
} from "../src/push-notifications.js";

const hmsKeyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const hmsConfiguration: HmsPushConfiguration = {
  keyId: "key-id",
  privateKey: hmsKeyPair.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  projectId: "project-id",
  subAccount: "service-account@example.com",
};

describe("Expo push notification sender", () => {
  it("sends generic relay payloads and identifies invalid device tokens", async () => {
    const requests: Array<{ init?: RequestInit; input: RequestInfo | URL }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ init, input });
      return new Response(
        JSON.stringify({
          data: [
            { id: "ticket-ok", status: "ok" },
            {
              details: { error: "DeviceNotRegistered" },
              message: "The device is not registered for push notifications.",
              status: "error",
            },
          ],
        }),
        { status: 200 },
      );
    };
    const sender = createExpoPushNotificationSender(fetchImpl as typeof fetch);

    const delivery = await sender.send([
      relayNotification("ExponentPushToken[active]", "thread-1", "turn-1"),
      relayNotification("ExponentPushToken[stale]", "thread-2"),
    ]);

    expect(delivery.invalidTokens).toEqual(["ExponentPushToken[stale]"]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe("https://exp.host/--/api/v2/push/send");
    expect(requests[0]?.init).toMatchObject({ method: "POST" });
    const payload = JSON.parse(String(requests[0]?.init?.body));
    expect(payload).toEqual([
      expect.objectContaining({
        data: { intent: "turn_terminal", threadId: "thread-1", turnId: "turn-1" },
        title: "Codex Relay",
      }),
      expect.objectContaining({
        data: { intent: "turn_terminal", threadId: "thread-2" },
        title: "Codex Relay",
      }),
    ]);
  });
});

describe("Harmony Push Kit sender", () => {
  it("uses a PS256 service-account assertion and sends a v3 Harmony notification", async () => {
    const requests: Array<{ init?: RequestInit; input: RequestInfo | URL }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ init, input });
      if (String(input).includes("/oauth2/v3/token")) {
        return new Response(JSON.stringify({ access_token: "hms-access-token", expires_in: 3600 }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ code: "80000000", msg: "Success" }), {
        status: 200,
      });
    };
    const now = Date.UTC(2026, 6, 31, 12);
    const sender = createHmsPushNotificationSender(
      hmsConfiguration,
      fetchImpl as typeof fetch,
      () => now,
    );

    const delivery = await sender.send([
      relayNotification("hms-device-token", "thread-1", "turn-1"),
    ]);

    expect(delivery.invalidTokens).toEqual([]);
    expect(requests).toHaveLength(2);
    const oauthBody = new URLSearchParams(String(requests[0]?.init?.body));
    expect(oauthBody.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );
    const assertion = oauthBody.get("assertion")!;
    const [encodedHeader, encodedPayload, encodedSignature] = assertion.split(".");
    expect(JSON.parse(Buffer.from(encodedHeader!, "base64url").toString())).toEqual({
      alg: "PS256",
      kid: "key-id",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(encodedPayload!, "base64url").toString())).toMatchObject({
      aud: "https://oauth-login.cloud.huawei.com/oauth2/v3/token",
      iss: "service-account@example.com",
      sub: "service-account@example.com",
    });
    expect(
      verifySignature(
        "sha256",
        Buffer.from(`${encodedHeader}.${encodedPayload}`),
        {
          key: hmsKeyPair.publicKey,
          padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
          saltLength: cryptoConstants.RSA_PSS_SALTLEN_DIGEST,
        },
        Buffer.from(encodedSignature!, "base64url"),
      ),
    ).toBe(true);

    expect(requests[1]?.input).toBe(
      "https://push-api.cloud.huawei.com/v3/project-id/messages:send",
    );
    expect(requests[1]?.init?.headers).toMatchObject({
      authorization: "Bearer hms-access-token",
      "push-type": "0",
    });
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
      payload: {
        notification: {
          body: "A Codex turn has finished.",
          category: "SOCIAL_COMMUNICATION",
          clickAction: {
            actionType: 0,
            data: { intent: "turn_terminal", threadId: "thread-1", turnId: "turn-1" },
          },
          title: "Codex Relay",
        },
      },
      pushOptions: { testMessage: false, ttl: 86_400 },
      target: { token: ["hms-device-token"] },
    });
  });

  it("marks every token invalid when Push Kit rejects the target list", async () => {
    const fetchImpl = async (input: RequestInfo | URL) =>
      String(input).includes("/oauth2/v3/token")
        ? new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }), { status: 200 })
        : new Response(JSON.stringify({ code: "80300007", msg: "All tokens are invalid" }), {
            status: 200,
          });
    const sender = createHmsPushNotificationSender(
      hmsConfiguration,
      fetchImpl as typeof fetch,
    );

    await expect(
      sender.send([
        relayNotification("invalid-hms-token-1", "thread-1"),
        relayNotification("invalid-hms-token-2", "thread-1"),
      ]),
    ).resolves.toEqual({
      invalidTokens: ["invalid-hms-token-1", "invalid-hms-token-2"],
    });
  });
});

describe("HMS push configuration", () => {
  it("loads and validates an official service-account JSON document", async () => {
    await expect(
      loadHmsPushConfiguration({
        CODEX_RELAY_HMS_SERVICE_ACCOUNT_JSON: JSON.stringify({
          key_id: hmsConfiguration.keyId,
          private_key: hmsConfiguration.privateKey,
          project_id: hmsConfiguration.projectId,
          sub_account: hmsConfiguration.subAccount,
        }),
      }),
    ).resolves.toEqual({
      ...hmsConfiguration,
      privateKey: hmsConfiguration.privateKey.trim(),
    });
  });

  it("rejects ambiguous or invalid service-account configuration", async () => {
    await expect(
      loadHmsPushConfiguration({
        CODEX_RELAY_HMS_SERVICE_ACCOUNT_JSON: "{}",
        CODEX_RELAY_HMS_SERVICE_ACCOUNT_PATH: "/tmp/hms.json",
      }),
    ).rejects.toThrow(/Configure only one/);
    await expect(
      loadHmsPushConfiguration({
        CODEX_RELAY_HMS_SERVICE_ACCOUNT_JSON: JSON.stringify({
          key_id: "key-id",
          private_key: "not-a-private-key",
          project_id: "project-id",
          sub_account: "service-account",
        }),
      }),
    ).rejects.toThrow(/private_key is invalid/);
  });
});

describe("push notification dispatcher", () => {
  it("routes subscriptions by provider and removes invalid tokens without crossing providers", async () => {
    const sessions = await createTursoPairingSessionStore(":memory:");
    const expiresAt = Date.now() + 60_000;
    await sessions.createSession("expo-session-token", {
      clientSessionId: "expo-device",
      expiresAt,
    });
    await sessions.createSession("hms-session-token", {
      clientSessionId: "hms-device",
      expiresAt,
    });
    await sessions.upsertPushNotificationSubscription({
      actionRequired: false,
      clientSessionId: "expo-device",
      platform: "ios",
      provider: "expo",
      token: "ExponentPushToken[shared-token]",
      turnTerminal: true,
    });
    await sessions.upsertPushNotificationSubscription({
      actionRequired: false,
      clientSessionId: "hms-device",
      platform: "harmony",
      provider: "hms",
      token: "shared-token",
      turnTerminal: true,
    });

    const expoSent: RelayPushNotification[][] = [];
    const hmsSent: RelayPushNotification[][] = [];
    const expoSender: PushNotificationSender = {
      async send(notifications) {
        expoSent.push([...notifications]);
        return { invalidTokens: ["ExponentPushToken[shared-token]"] };
      },
    };
    const hmsSender: PushNotificationSender = {
      async send(notifications) {
        hmsSent.push([...notifications]);
        return { invalidTokens: [] };
      },
    };
    const dispatcher = createPushNotificationDispatcher({
      senders: { expo: expoSender, hms: hmsSender },
      sessions,
    });

    await dispatcher.dispatch({
      intent: "turn_terminal",
      threadId: "thread-1",
      turnId: "turn-1",
    });

    expect(expoSent[0]?.[0]?.to).toBe("ExponentPushToken[shared-token]");
    expect(hmsSent[0]?.[0]?.to).toBe("shared-token");
    expect(await sessions.getPushNotificationSubscription("expo-device")).toBeUndefined();
    expect(await sessions.getPushNotificationSubscription("hms-device")).toMatchObject({
      provider: "hms",
      token: "shared-token",
    });
  });
});

function relayNotification(
  to: string,
  threadId: string,
  turnId?: string,
): RelayPushNotification {
  return {
    body: "A Codex turn has finished.",
    data: {
      intent: "turn_terminal",
      threadId,
      ...(turnId ? { turnId } : {}),
    },
    title: "Codex Relay",
    to,
  };
}
