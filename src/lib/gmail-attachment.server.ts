import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import {
  getGmailAccessTokenForAccount,
  GmailReauthenticationError,
  type GmailAccountSecureRow,
} from "./gmail-account.server";

type AttachmentRow = {
  id: string;
  organization_id: string | null;
  email_account_id: string;
  email_id: string;
  gmail_message_id: string;
  gmail_attachment_id: string | null;
  gmail_part_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  content_id: string | null;
  is_inline: boolean;
  storage_path: string | null;
  body_data: string | null;
};

type GmailPayload = {
  partId?: string;
  filename?: string;
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { attachmentId?: string; data?: string; size?: number };
  parts?: GmailPayload[];
};

const requestsByUser = new Map<string, { count: number; resetAt: number }>();

function errorResponse(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

function decodeBase64Url(value: string) {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  return Buffer.from(normalized, "base64");
}

function safeFilename(value: string) {
  const withoutControlCharacters = Array.from(value)
    .filter((character) => character.charCodeAt(0) >= 32)
    .join("");
  const normalized = withoutControlCharacters
    .replace(/[\r\n]/g, "")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return (normalized || "attachment").slice(0, 180);
}

function quotedFilename(value: string) {
  return safeFilename(value).replace(/["\\]/g, "_");
}

function findPayloadPart(
  payload: GmailPayload | undefined,
  attachment: AttachmentRow,
) {
  let found: GmailPayload | undefined;
  const walk = (part: GmailPayload | undefined, path: string) => {
    if (!part || found) return;
    const partId = part.partId || path;
    const matchesPart = partId === attachment.gmail_part_id;
    const matchesFilename =
      Boolean(part.filename) && part.filename === attachment.filename;
    if (
      (matchesPart || matchesFilename) &&
      (part.body?.attachmentId || part.body?.data)
    ) {
      found = part;
      return;
    }
    part.parts?.forEach((child, index) => walk(child, `${path}.${index}`));
  };
  walk(payload, "0");
  return found;
}

function applyRateLimit(userId: string) {
  const now = Date.now();
  const current = requestsByUser.get(userId);
  if (!current || current.resetAt <= now) {
    requestsByUser.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (current.count >= 60) return false;
  current.count += 1;
  return true;
}

async function gmailRequest(
  supabase: ReturnType<typeof createClient>,
  account: GmailAccountSecureRow,
  path: string,
) {
  const makeRequest = async (forceRefresh: boolean) => {
    const accessToken = await getGmailAccessTokenForAccount({
      supabase,
      account,
      forceRefresh,
    });
    return fetch(`https://gmail.googleapis.com${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  };

  let response = await makeRequest(false);
  if (response.status === 401) response = await makeRequest(true);
  return response;
}

export async function handleGmailAttachmentRequest(
  request: Request,
  attachmentRecordId: string,
) {
  if (request.method !== "GET") {
    return errorResponse(405, "Method not allowed.");
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return errorResponse(401, "User is not authenticated.");
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    console.error("[Gmail attachment] Supabase server environment is missing.");
    return errorResponse(500, "The attachment service is not configured.");
  }

  const token = authorization.slice("Bearer ".length);
  const supabase = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: { transport: WebSocket },
  });

  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims(token);
  const userId = claimsData?.claims?.sub;
  if (claimsError || !userId) {
    return errorResponse(401, "User is not authenticated.");
  }
  if (!applyRateLimit(userId)) {
    return errorResponse(
      429,
      "Too many attachment requests. Try again shortly.",
    );
  }

  try {
    const { data: attachment, error: attachmentError } = await supabase
      .from("email_attachments")
      .select("*")
      .eq("id", attachmentRecordId)
      .maybeSingle();
    if (attachmentError) throw attachmentError;
    if (!attachment) {
      return errorResponse(404, "Attachment metadata does not exist.");
    }
    const row = attachment as AttachmentRow;

    const { data: account, error: accountError } = await supabase
      .from("email_accounts")
      .select("*")
      .eq("id", row.email_account_id)
      .maybeSingle();
    if (accountError) throw accountError;
    if (!account) {
      return errorResponse(403, "You do not have access to this attachment.");
    }
    const secureAccount = account as GmailAccountSecureRow;

    let hasAccess = secureAccount.user_id === userId;
    if (!hasAccess && row.organization_id) {
      const { data: membership } = await supabase
        .from("organization_members")
        .select("id")
        .eq("organization_id", row.organization_id)
        .eq("user_id", userId)
        .maybeSingle();
      hasAccess = Boolean(membership);
    }
    if (!hasAccess) {
      return errorResponse(403, "You do not have access to this attachment.");
    }

    let binary: Buffer | null = null;
    if (row.storage_path) {
      const { data: cached } = await supabase.storage
        .from("gmail-attachments")
        .download(row.storage_path);
      if (cached) binary = Buffer.from(await cached.arrayBuffer());
    }

    if (!binary && row.body_data) {
      binary = decodeBase64Url(row.body_data);
    }

    let gmailAttachmentId = row.gmail_attachment_id;
    if (!binary && !gmailAttachmentId) {
      const messageResponse = await gmailRequest(
        supabase,
        secureAccount,
        `/gmail/v1/users/me/messages/${encodeURIComponent(
          row.gmail_message_id,
        )}?format=full`,
      );
      if (messageResponse.status === 404) {
        return errorResponse(
          404,
          "This attachment is no longer available in Gmail.",
        );
      }
      if (!messageResponse.ok) {
        console.error(
          "[Gmail attachment] Message lookup failed.",
          messageResponse.status,
        );
        return errorResponse(502, "Gmail could not retrieve this attachment.");
      }

      const message = (await messageResponse.json()) as {
        payload?: GmailPayload;
      };
      const part = findPayloadPart(message.payload, row);
      if (!part) {
        return errorResponse(
          404,
          "This attachment is no longer available in Gmail.",
        );
      }
      gmailAttachmentId = part.body?.attachmentId ?? null;
      if (part.body?.data) binary = decodeBase64Url(part.body.data);

      await supabase
        .from("email_attachments")
        .update({
          gmail_attachment_id: gmailAttachmentId,
          body_data: part.body?.data ?? row.body_data,
          size_bytes: part.body?.size ?? row.size_bytes,
        })
        .eq("id", row.id);
    }

    if (!binary && gmailAttachmentId) {
      const attachmentResponse = await gmailRequest(
        supabase,
        secureAccount,
        `/gmail/v1/users/me/messages/${encodeURIComponent(
          row.gmail_message_id,
        )}/attachments/${encodeURIComponent(gmailAttachmentId)}`,
      );
      if (attachmentResponse.status === 404) {
        return errorResponse(
          404,
          "This attachment is no longer available in Gmail.",
        );
      }
      if (!attachmentResponse.ok) {
        console.error(
          "[Gmail attachment] Gmail attachment request failed.",
          attachmentResponse.status,
        );
        return errorResponse(502, "Gmail could not retrieve this attachment.");
      }
      const payload = (await attachmentResponse.json()) as {
        data?: string;
      };
      if (payload.data) binary = decodeBase64Url(payload.data);
    }

    if (!binary) {
      return errorResponse(
        404,
        "This attachment is no longer available in Gmail.",
      );
    }

    const disposition =
      new URL(request.url).searchParams.get("disposition") === "attachment"
        ? "attachment"
        : "inline";
    const filename = quotedFilename(row.filename);
    return new Response(binary, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Length": String(binary.byteLength),
        "Content-Type": row.mime_type || "application/octet-stream",
        "Content-Disposition": `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof GmailReauthenticationError) {
      return errorResponse(
        409,
        "Your Gmail connection has expired. Reconnect your account.",
      );
    }
    console.error("[Gmail attachment] Request failed.", error);
    return errorResponse(
      500,
      "The attachment could not be loaded. Please try again.",
    );
  }
}
