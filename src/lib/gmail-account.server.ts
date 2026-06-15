import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type GmailConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "syncing"
  | "reauthentication_required"
  | "sync_failed";

export type GmailAccountSecureRow = {
  id: string;
  user_id: string;
  organization_id?: string | null;
  email_address: string;
  connection_api_key: string;
  access_token_encrypted?: string | null;
  refresh_token_encrypted?: string | null;
  token_expires_at?: string | null;
  connection_status?: GmailConnectionStatus | null;
  last_sync_error?: string | null;
};

export type StoredGmailConnection = {
  accessToken?: string;
  refreshToken?: string | null;
  expiresAt?: number | null;
};

export class GmailReauthenticationError extends Error {
  constructor() {
    super(
      "Gmail authorization expired. Reconnect Gmail once in Settings to enable automatic sync.",
    );
    this.name = "GmailReauthenticationError";
  }
}

function getEncryptionKey() {
  const secret =
    process.env.GMAIL_TOKEN_ENCRYPTION_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.GOOGLE_APP_USER_CONNECTOR_CLIENT_SECRET;

  if (!secret) {
    throw new Error("Gmail token encryption is not configured on the server.");
  }

  return createHash("sha256").update(secret).digest();
}

export function encryptGmailSecret(value: string | null | undefined) {
  if (!value) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptGmailSecret(value: string | null | undefined) {
  if (!value) return null;
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) {
    throw new Error("Stored Gmail credentials could not be decrypted.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function parseLegacyConnection(
  connectionApiKey: string,
): StoredGmailConnection {
  if (!connectionApiKey || connectionApiKey === "encrypted") return {};
  try {
    const parsed = JSON.parse(connectionApiKey) as StoredGmailConnection;
    if (parsed.accessToken || parsed.refreshToken) return parsed;
  } catch {
    // Legacy rows may contain a raw access token.
  }
  return { accessToken: connectionApiKey };
}

export function readGmailConnection(
  account: GmailAccountSecureRow,
): StoredGmailConnection {
  const legacy = parseLegacyConnection(account.connection_api_key);
  const encryptedAccessToken = account.access_token_encrypted
    ? decryptGmailSecret(account.access_token_encrypted)
    : null;
  const encryptedRefreshToken = account.refresh_token_encrypted
    ? decryptGmailSecret(account.refresh_token_encrypted)
    : null;
  const expiresAt = account.token_expires_at
    ? Math.floor(new Date(account.token_expires_at).getTime() / 1000)
    : legacy.expiresAt;

  return {
    accessToken: encryptedAccessToken ?? legacy.accessToken,
    refreshToken: encryptedRefreshToken ?? legacy.refreshToken ?? null,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
  };
}

export function makeEncryptedGmailConnectionUpdate(
  connection: StoredGmailConnection,
) {
  return {
    connection_api_key: "encrypted",
    access_token_encrypted: encryptGmailSecret(connection.accessToken),
    refresh_token_encrypted: encryptGmailSecret(connection.refreshToken),
    token_expires_at: connection.expiresAt
      ? new Date(connection.expiresAt * 1000).toISOString()
      : null,
  };
}

function isAccessTokenFresh(connection: StoredGmailConnection) {
  if (!connection.accessToken) return false;
  if (!connection.expiresAt) return true;
  return connection.expiresAt * 1000 > Date.now() + 60_000;
}

async function updateAccount(
  supabase: SupabaseClient,
  accountId: string,
  values: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("email_accounts")
    .update(values)
    .eq("id", accountId);
  if (error) throw error;
}

export async function getGmailAccessTokenForAccount({
  supabase,
  account,
  forceRefresh = false,
}: {
  supabase: SupabaseClient;
  account: GmailAccountSecureRow;
  forceRefresh?: boolean;
}) {
  const connection = readGmailConnection(account);
  if (!forceRefresh && isAccessTokenFresh(connection)) {
    return connection.accessToken!;
  }

  if (!connection.refreshToken) {
    await updateAccount(supabase, account.id, {
      connection_status: "reauthentication_required",
      last_sync_error: "Gmail refresh token is missing.",
    }).catch(() => undefined);
    throw new GmailReauthenticationError();
  }

  const clientId = process.env.GOOGLE_APP_USER_CONNECTOR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_APP_USER_CONNECTOR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Gmail automatic token refresh is not configured on the server.",
    );
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: connection.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const tokenPayload = (await tokenResponse.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenResponse.ok || !tokenPayload.access_token) {
    const reconnectRequired =
      tokenPayload.error === "invalid_grant" ||
      tokenPayload.error === "invalid_client";
    await updateAccount(supabase, account.id, {
      connection_status: reconnectRequired
        ? "reauthentication_required"
        : "sync_failed",
      last_sync_error:
        tokenPayload.error_description ??
        tokenPayload.error ??
        `Google token endpoint returned ${tokenResponse.status}.`,
    }).catch(() => undefined);
    if (reconnectRequired) throw new GmailReauthenticationError();
    throw new Error("Gmail token refresh failed. Please try again.");
  }

  const refreshedConnection: StoredGmailConnection = {
    accessToken: tokenPayload.access_token,
    refreshToken: tokenPayload.refresh_token ?? connection.refreshToken,
    expiresAt:
      Math.floor(Date.now() / 1000) + (tokenPayload.expires_in ?? 3600),
  };
  await updateAccount(supabase, account.id, {
    ...makeEncryptedGmailConnectionUpdate(refreshedConnection),
    connection_status: "connected",
    last_sync_error: null,
  });

  Object.assign(account, {
    ...makeEncryptedGmailConnectionUpdate(refreshedConnection),
    connection_status: "connected",
  });
  return tokenPayload.access_token;
}
