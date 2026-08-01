import {
  constants as cryptoConstants,
  createPrivateKey,
  sign as signData,
} from "node:crypto";
import { readFile } from "node:fs/promises";

import { z } from "zod";

import type { PushNotificationProvider } from "./api-schema.js";
import type { PairingSessionStore } from "./pairing-store.js";

const expoPushEndpoint = "https://exp.host/--/api/v2/push/send";
const expoPushChunkSize = 100;
const hmsOAuthAudience = "https://oauth-login.cloud.huawei.com/oauth2/v3/token";
const hmsPushEndpoint = "https://push-api.cloud.huawei.com";
const hmsPushChunkSize = 1000;
const hmsAccessTokenRefreshSkewMs = 60_000;
const hmsSuccessCode = "80000000";
const hmsPartialSuccessCode = "80100000";
const hmsAllTokensInvalidCode = "80300007";

export type PushNotificationIntent = "turn_terminal" | "action_required";

export type RelayPushNotification = {
  body: string;
  data: {
    intent: PushNotificationIntent;
    threadId: string;
    turnId?: string;
  };
  title: "Codex Relay";
  to: string;
};

export type PushNotificationEvent = {
  intent: PushNotificationIntent;
  threadId: string;
  turnId?: string;
};

export type PushNotificationDelivery = {
  invalidTokens: readonly string[];
};

export type PushNotificationSender = {
  send(notifications: readonly RelayPushNotification[]): Promise<PushNotificationDelivery>;
};

export type PushNotificationSenders = Partial<
  Record<PushNotificationProvider, PushNotificationSender>
>;

export type PushNotificationDispatcher = {
  dispatch(event: PushNotificationEvent): Promise<void>;
};

export type HmsPushConfiguration = {
  keyId: string;
  privateKey: string;
  projectId: string;
  subAccount: string;
};

type HmsAccessToken = {
  expiresAt: number;
  value: string;
};

const HmsServiceAccountSchema = z
  .object({
    key_id: z.string().trim().min(1),
    private_key: z.string().trim().min(1),
    project_id: z.string().trim().min(1),
    sub_account: z.string().trim().min(1),
  })
  .transform((serviceAccount): HmsPushConfiguration => ({
    keyId: serviceAccount.key_id,
    privateKey: serviceAccount.private_key.replaceAll("\\n", "\n"),
    projectId: serviceAccount.project_id,
    subAccount: serviceAccount.sub_account,
  }));

export async function loadHmsPushConfiguration(
  env: NodeJS.ProcessEnv = process.env,
  readFileImpl: typeof readFile = readFile,
): Promise<HmsPushConfiguration | undefined> {
  const inlineJson = env.CODEX_RELAY_HMS_SERVICE_ACCOUNT_JSON?.trim();
  const serviceAccountPath = env.CODEX_RELAY_HMS_SERVICE_ACCOUNT_PATH?.trim();
  if (!inlineJson && !serviceAccountPath) {
    return undefined;
  }
  if (inlineJson && serviceAccountPath) {
    throw new Error(
      "Configure only one of CODEX_RELAY_HMS_SERVICE_ACCOUNT_JSON or CODEX_RELAY_HMS_SERVICE_ACCOUNT_PATH.",
    );
  }

  let rawJson: string;
  if (inlineJson) {
    rawJson = inlineJson;
  } else {
    try {
      rawJson = await readFileImpl(serviceAccountPath!, "utf8");
    } catch (error) {
      throw new Error(
        `Unable to read HMS service account file ${serviceAccountPath}: ${errorMessage(error)}`,
      );
    }
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawJson);
  } catch (error) {
    throw new Error(`HMS service account is not valid JSON: ${errorMessage(error)}`);
  }

  const parsed = HmsServiceAccountSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(
      `HMS service account is missing required fields: ${parsed.error.issues
        .map((issue) => issue.path.join("."))
        .filter(Boolean)
        .join(", ")}`,
    );
  }
  try {
    createPrivateKey(parsed.data.privateKey);
  } catch (error) {
    throw new Error(`HMS service account private_key is invalid: ${errorMessage(error)}`);
  }
  return parsed.data;
}

export function createExpoPushNotificationSender(
  fetchImpl: typeof fetch = fetch,
): PushNotificationSender {
  return {
    async send(notifications) {
      const invalidTokens = new Set<string>();
      for (const chunk of chunks(notifications, expoPushChunkSize)) {
        const response = await fetchImpl(expoPushEndpoint, {
          body: JSON.stringify(
            chunk.map((notification) => ({
              body: notification.body,
              channelId: "default",
              data: notification.data,
              priority: "high",
              sound: "default",
              title: notification.title,
              to: notification.to,
            })),
          ),
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          method: "POST",
        });
        const body: unknown = await response.json().catch(() => undefined);
        if (!response.ok) {
          throw new Error(`Expo push service returned ${response.status}.`);
        }

        const tickets = expoPushTickets(body);
        for (const [index, ticket] of tickets.entries()) {
          const notification = chunk[index];
          if (notification && isExpoDeviceNotRegistered(ticket)) {
            invalidTokens.add(notification.to);
          }
        }
      }

      return { invalidTokens: [...invalidTokens] };
    },
  };
}

export function createHmsPushNotificationSender(
  configuration: HmsPushConfiguration,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): PushNotificationSender {
  let cachedAccessToken: HmsAccessToken | undefined;

  const accessToken = async () => {
    const currentTime = now();
    if (
      cachedAccessToken &&
      currentTime < cachedAccessToken.expiresAt - hmsAccessTokenRefreshSkewMs
    ) {
      return cachedAccessToken.value;
    }

    const assertion = createHmsServiceAccountAssertion(configuration, currentTime);
    const response = await fetchImpl(hmsOAuthAudience, {
      body: new URLSearchParams({
        assertion,
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      }),
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new Error(`HMS OAuth service returned ${response.status}: ${hmsResponseMessage(body)}`);
    }
    const token = hmsAccessTokenFromResponse(body);
    cachedAccessToken = {
      expiresAt: currentTime + token.expiresInSeconds * 1000,
      value: token.value,
    };
    return token.value;
  };

  return {
    async send(notifications) {
      const invalidTokens = new Set<string>();
      for (const group of notificationGroups(notifications)) {
        for (const notificationChunk of chunks(group, hmsPushChunkSize)) {
          const token = await accessToken();
          const response = await fetchImpl(
            `${hmsPushEndpoint}/v3/${encodeURIComponent(configuration.projectId)}/messages:send`,
            {
              body: JSON.stringify(hmsPushRequest(notificationChunk)),
              headers: {
                accept: "application/json",
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
                "push-type": "0",
              },
              method: "POST",
            },
          );
          const body: unknown = await response.json().catch(() => undefined);
          if (!response.ok) {
            throw new Error(
              `HMS push service returned ${response.status}: ${hmsResponseMessage(body)}`,
            );
          }

          const code = hmsResponseCode(body);
          const responseInvalidTokens = hmsInvalidTokens(body);
          responseInvalidTokens.forEach((invalidToken) => invalidTokens.add(invalidToken));
          if (code === hmsAllTokensInvalidCode) {
            notificationChunk.forEach((notification) => invalidTokens.add(notification.to));
            continue;
          }
          if (
            code !== hmsSuccessCode &&
            !(code === hmsPartialSuccessCode && responseInvalidTokens.length > 0)
          ) {
            throw new Error(`HMS push service rejected the message: ${hmsResponseMessage(body)}`);
          }
        }
      }
      return { invalidTokens: [...invalidTokens] };
    },
  };
}

export function createPushNotificationDispatcher(input: {
  senders: PushNotificationSenders;
  sessions: PairingSessionStore;
}): PushNotificationDispatcher {
  return {
    async dispatch(event) {
      const subscriptions = await input.sessions.listActivePushNotificationSubscriptions(
        Date.now(),
      );
      const subscriptionsByProvider = new Map<PushNotificationProvider, Set<string>>();
      for (const subscription of subscriptions) {
        if (!notificationEnabled(subscription, event.intent)) {
          continue;
        }
        const tokens =
          subscriptionsByProvider.get(subscription.provider) ?? new Set<string>();
        tokens.add(subscription.token);
        subscriptionsByProvider.set(subscription.provider, tokens);
      }

      for (const [provider, tokens] of subscriptionsByProvider) {
        const sender = input.senders[provider];
        if (!sender) {
          throw new Error(`Push notification provider ${provider} is not configured.`);
        }
        const delivery = await sender.send(
          [...tokens].map((token) => notificationForEvent(token, event)),
        );
        await Promise.all(
          delivery.invalidTokens.map((invalidToken) =>
            input.sessions.deletePushNotificationSubscriptionsByToken(provider, invalidToken),
          ),
        );
      }
    },
  };
}

function notificationEnabled(
  subscription: { actionRequired: boolean; turnTerminal: boolean },
  intent: PushNotificationIntent,
) {
  return intent === "action_required" ? subscription.actionRequired : subscription.turnTerminal;
}

function notificationForEvent(
  token: string,
  event: PushNotificationEvent,
): RelayPushNotification {
  return {
    body:
      event.intent === "action_required"
        ? "Codex needs your attention."
        : "A Codex turn has finished.",
    data: {
      intent: event.intent,
      threadId: event.threadId,
      ...(event.turnId ? { turnId: event.turnId } : {}),
    },
    title: "Codex Relay",
    to: token,
  };
}

function createHmsServiceAccountAssertion(
  configuration: HmsPushConfiguration,
  now: number,
) {
  const issuedAt = Math.floor(now / 1000);
  const header = base64UrlJson({
    alg: "PS256",
    kid: configuration.keyId,
    typ: "JWT",
  });
  const payload = base64UrlJson({
    aud: hmsOAuthAudience,
    exp: issuedAt + 3600,
    iat: issuedAt,
    iss: configuration.subAccount,
    sub: configuration.subAccount,
  });
  const signingInput = `${header}.${payload}`;
  const signature = signData("sha256", Buffer.from(signingInput), {
    key: configuration.privateKey,
    padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
    saltLength: cryptoConstants.RSA_PSS_SALTLEN_DIGEST,
  });
  return `${signingInput}.${signature.toString("base64url")}`;
}

function hmsPushRequest(notifications: readonly RelayPushNotification[]) {
  const notification = notifications[0]!;
  return {
    payload: {
      notification: {
        body: notification.body,
        category: "SOCIAL_COMMUNICATION",
        clickAction: {
          actionType: 0,
          data: notification.data,
        },
        title: notification.title,
      },
    },
    pushOptions: {
      testMessage: false,
      ttl: 24 * 60 * 60,
    },
    target: {
      token: notifications.map((item) => item.to),
    },
  };
}

function notificationGroups(notifications: readonly RelayPushNotification[]) {
  const groups = new Map<string, RelayPushNotification[]>();
  for (const notification of notifications) {
    const key = JSON.stringify({
      body: notification.body,
      data: notification.data,
      title: notification.title,
    });
    const group = groups.get(key) ?? [];
    group.push(notification);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function hmsAccessTokenFromResponse(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new Error("HMS OAuth service returned an invalid response.");
  }
  const response = value as { access_token?: unknown; expires_in?: unknown };
  if (typeof response.access_token !== "string" || response.access_token.length === 0) {
    throw new Error(`HMS OAuth service did not return access_token: ${hmsResponseMessage(value)}`);
  }
  const expiresInSeconds = Number(response.expires_in);
  if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new Error("HMS OAuth service did not return a valid expires_in value.");
  }
  return { expiresInSeconds, value: response.access_token };
}

function hmsResponseCode(value: unknown) {
  if (!value || typeof value !== "object") {
    return "";
  }
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number" ? String(code) : "";
}

function hmsResponseMessage(value: unknown) {
  if (!value || typeof value !== "object") {
    return "invalid response";
  }
  const response = value as { code?: unknown; message?: unknown; msg?: unknown };
  const message =
    typeof response.message === "string"
      ? response.message
      : typeof response.msg === "string"
        ? response.msg
        : "unknown error";
  const code = hmsResponseCode(value);
  return code ? `${code} ${message}` : message;
}

function hmsInvalidTokens(value: unknown) {
  if (!value || typeof value !== "object") {
    return [];
  }
  const ext = (value as { ext?: unknown }).ext;
  if (!ext || typeof ext !== "object") {
    return [];
  }
  const record = ext as { illegalTokens?: unknown; invalidTokens?: unknown };
  const tokens = Array.isArray(record.invalidTokens)
    ? record.invalidTokens
    : Array.isArray(record.illegalTokens)
      ? record.illegalTokens
      : [];
  return tokens.filter((token): token is string => typeof token === "string");
}

function base64UrlJson(value: object) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function expoPushTickets(value: unknown) {
  if (!value || typeof value !== "object") {
    return [];
  }
  const data = (value as { data?: unknown }).data;
  return Array.isArray(data) ? data : [];
}

function isExpoDeviceNotRegistered(ticket: unknown) {
  if (!ticket || typeof ticket !== "object") {
    return false;
  }
  const record = ticket as { details?: unknown; status?: unknown };
  if (record.status !== "error" || !record.details || typeof record.details !== "object") {
    return false;
  }
  return (record.details as { error?: unknown }).error === "DeviceNotRegistered";
}

function chunks<T>(items: readonly T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
