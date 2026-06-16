export const GMAIL_CONNECT_PENDING_KEY = "inboxly:gmail-connect-pending";
export const GMAIL_CONNECT_TOKEN_KEY = "inboxly:gmail-connect-token";

export const GMAIL_OAUTH_SCOPES = [
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
].join(" ");

type GoogleSession = {
  provider_token?: string | null;
  provider_refresh_token?: string | null;
  expires_at?: number | null;
  user: {
    email?: string | null;
    user_metadata?: Record<string, unknown> | null;
  };
};

function createStoredGmailConnectionToken({
  accessToken,
  refreshToken,
  expiresAt,
}: {
  accessToken: string | null | undefined;
  refreshToken?: string | null;
  expiresAt?: number | null;
}): string | null {
  if (!accessToken) return null;

  return JSON.stringify({
    kind: "google_oauth_access_token",
    accessToken,
    refreshToken: refreshToken ?? null,
    expiresAt: expiresAt ?? null,
  });
}

function safeSessionStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isGmailConnectPending() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(GMAIL_CONNECT_PENDING_KEY) === "1";
  } catch {
    return false;
  }
}

export function getGoogleSessionEmail(session: GoogleSession): string {
  const metadataEmail = session.user.user_metadata?.email;
  return (
    session.user.email ??
    (typeof metadataEmail === "string" ? metadataEmail : "")
  );
}

export function createGmailConnectionToken(
  session: GoogleSession,
): string | null {
  return createStoredGmailConnectionToken({
    accessToken: session.provider_token,
    refreshToken: session.provider_refresh_token,
    expiresAt: session.expires_at,
  });
}

export function savePendingGmailConnectionTokenFromUrl() {
  if (typeof window === "undefined" || !isGmailConnectPending()) return false;

  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams = new URLSearchParams(hash);
  const searchParams = new URLSearchParams(window.location.search);

  const expiresAtValue =
    hashParams.get("expires_at") ?? searchParams.get("expires_at");
  const expiresAt = expiresAtValue ? Number(expiresAtValue) : null;
  const connectionToken = createStoredGmailConnectionToken({
    accessToken:
      hashParams.get("provider_token") ?? searchParams.get("provider_token"),
    refreshToken:
      hashParams.get("provider_refresh_token") ??
      searchParams.get("provider_refresh_token"),
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
  });

  if (!connectionToken) return false;

  safeSessionStorage()?.setItem(GMAIL_CONNECT_TOKEN_KEY, connectionToken);
  return true;
}

export function savePendingGmailConnectionTokenFromSession(
  session: GoogleSession | null,
) {
  if (!session || !isGmailConnectPending()) return false;

  const connectionToken = createGmailConnectionToken(session);
  if (!connectionToken) return false;

  safeSessionStorage()?.setItem(GMAIL_CONNECT_TOKEN_KEY, connectionToken);
  return true;
}

export function getPendingGmailConnectionToken() {
  return safeSessionStorage()?.getItem(GMAIL_CONNECT_TOKEN_KEY) ?? null;
}

export function clearPendingGmailConnectionToken() {
  safeSessionStorage()?.removeItem(GMAIL_CONNECT_TOKEN_KEY);
}
