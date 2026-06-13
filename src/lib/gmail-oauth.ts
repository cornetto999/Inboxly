export const GMAIL_CONNECT_PENDING_KEY = "inboxly:gmail-connect-pending";

export const GMAIL_OAUTH_SCOPES = [
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
].join(" ");

type GoogleSession = {
  provider_token?: string | null;
  expires_at?: number | null;
  user: {
    email?: string | null;
    user_metadata?: Record<string, unknown> | null;
  };
};

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
  if (!session.provider_token) return null;

  return JSON.stringify({
    kind: "google_oauth_access_token",
    accessToken: session.provider_token,
    expiresAt: session.expires_at ?? null,
  });
}
