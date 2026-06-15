import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { getErrorMessage, toError } from "@/lib/errors";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const GMAIL_API_BASE_URL = "https://gmail.googleapis.com";

type AuthenticatedFunctionContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
};

function isMissingSupabaseSchemaError(error: unknown) {
  const message = getErrorMessage(error, "");
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;

  return (
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    code === "PGRST202" ||
    message.includes("schema cache") ||
    message.includes("does not exist") ||
    message.includes("Could not find the") ||
    message.includes("Could not find the table") ||
    message.includes("Could not find the function")
  );
}

function toSupabaseError(error: unknown, objectName: string) {
  if (isMissingSupabaseSchemaError(error)) {
    return new Error(
      `Inboxly backend schema is not installed in Supabase. Missing ${objectName}. Apply the Supabase migrations, then try again.`,
    );
  }

  return toError(error);
}

function getTodayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setMilliseconds(end.getMilliseconds() - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function isBetweenIso(
  value: string | null | undefined,
  startIso: string,
  endIso: string,
) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return (
    time >= new Date(startIso).getTime() && time <= new Date(endIso).getTime()
  );
}

function dayKey(value: string | null | undefined) {
  if (!value) return "Unknown";
  return new Date(value).toISOString().slice(0, 10);
}

function countRowsByField<T extends Record<string, unknown>>(
  rows: T[],
  field: keyof T,
) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = String(row[field] ?? "Unassigned");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function groupRowsByDay(rows: { created_at?: string | null }[]) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = dayKey(row.created_at);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

type EmailAnalyticsRow = {
  is_read: boolean;
  is_sent?: boolean | null;
  labels?: string[] | null;
  received_at?: string | null;
  sent_at?: string | null;
  created_at?: string | null;
};

const EMAIL_FOLDER_COUNT_KEYS = [
  "all",
  "unread",
  "read",
  "starred",
  "sent",
  "drafts",
  "archived",
  "spam",
  "trash",
] as const;

export type EmailFolderCountKey = (typeof EMAIL_FOLDER_COUNT_KEYS)[number];
export type EmailFolderCounts = Record<EmailFolderCountKey, number>;

export const EMPTY_EMAIL_FOLDER_COUNTS: EmailFolderCounts =
  EMAIL_FOLDER_COUNT_KEYS.reduce(
    (counts, key) => ({ ...counts, [key]: 0 }),
    {} as EmailFolderCounts,
  );

type EmailFolderCountRow = {
  is_read?: boolean | null;
  is_starred?: boolean | null;
  is_sent?: boolean | null;
  is_draft?: boolean | null;
  is_archived?: boolean | null;
  is_spam?: boolean | null;
  is_trashed?: boolean | null;
  labels?: unknown;
};

function normalizeLabels(labels: unknown) {
  if (!Array.isArray(labels)) return [];
  return labels
    .filter((label): label is string => typeof label === "string")
    .map((label) => label.toUpperCase());
}

function getEmailFolderState(row: EmailFolderCountRow) {
  const labels = normalizeLabels(row.labels);
  const hasLabels = labels.length > 0;
  const hasLabel = (label: string) => labels.includes(label);
  const isSent = Boolean(row.is_sent) || hasLabel("SENT");
  const isDraft = Boolean(row.is_draft) || hasLabel("DRAFT");
  const isSpam = Boolean(row.is_spam) || hasLabel("SPAM");
  const isTrashed = Boolean(row.is_trashed) || hasLabel("TRASH");
  const isArchived =
    (Boolean(row.is_archived) ||
      (hasLabels &&
        !hasLabel("INBOX") &&
        !hasLabel("SENT") &&
        !hasLabel("DRAFT") &&
        !hasLabel("SPAM") &&
        !hasLabel("TRASH"))) &&
    !isSent &&
    !isDraft &&
    !isSpam &&
    !isTrashed;

  return {
    isRead: Boolean(row.is_read),
    isStarred: Boolean(row.is_starred) || hasLabel("STARRED"),
    isSent,
    isDraft,
    isArchived,
    isSpam,
    isTrashed,
  };
}

function countEmailFolderRows(rows: EmailFolderCountRow[]) {
  const counts = { ...EMPTY_EMAIL_FOLDER_COUNTS };

  for (const row of rows) {
    const state = getEmailFolderState(row);
    counts.all += 1;
    if (!state.isRead) counts.unread += 1;
    if (
      state.isRead &&
      !state.isSpam &&
      !state.isTrashed &&
      !state.isDraft
    ) {
      counts.read += 1;
    }
    if (state.isStarred) counts.starred += 1;
    if (state.isSent) counts.sent += 1;
    if (state.isDraft) counts.drafts += 1;
    if (state.isArchived) counts.archived += 1;
    if (state.isSpam) counts.spam += 1;
    if (state.isTrashed) counts.trash += 1;
  }

  return counts;
}

function isSentEmail(row: EmailAnalyticsRow) {
  return (
    Boolean(row.is_sent) ||
    Boolean(row.labels?.some((label) => label.toUpperCase() === "SENT"))
  );
}

function getEmailActivityDate(row: EmailAnalyticsRow) {
  return isSentEmail(row)
    ? (row.sent_at ?? row.received_at ?? row.created_at)
    : (row.received_at ?? row.created_at);
}

function groupEmailsByDay(rows: EmailAnalyticsRow[]) {
  const byDay: Record<string, { received: number; sent: number }> = {};
  for (const row of rows) {
    const sent = isSentEmail(row);
    const key = dayKey(getEmailActivityDate(row));
    byDay[key] ??= { received: 0, sent: 0 };
    if (sent) byDay[key].sent += 1;
    else byDay[key].received += 1;
  }
  return byDay;
}

async function getEmailAnalyticsRows(supabase: SupabaseClient<Database>) {
  const enhancedResult = await supabase
    .from("emails")
    .select("is_read, is_sent, labels, received_at, sent_at, created_at");

  if (!enhancedResult.error) {
    return (enhancedResult.data ?? []) as unknown as EmailAnalyticsRow[];
  }

  if (!isMissingSupabaseSchemaError(enhancedResult.error)) {
    throw toSupabaseError(enhancedResult.error, "public.emails");
  }

  const legacyResult = await supabase
    .from("emails")
    .select("is_read, labels, received_at, created_at");
  if (legacyResult.error) {
    throw toSupabaseError(legacyResult.error, "public.emails");
  }

  return (legacyResult.data ?? []) as EmailAnalyticsRow[];
}

// ---------- Roles ----------
export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const roles = (data ?? []).map((r) => r.role);
    return { roles, isAdmin: roles.includes("admin") };
  });

// ---------- Dashboard ----------
export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const today = getTodayRange();

    const [
      leadsResult,
      customersResult,
      dueRemindersResult,
      overdueRemindersResult,
      emails,
      emailAccountsResult,
      tasksResult,
      campaignsResult,
      activityResult,
    ] = await Promise.all([
      supabase
        .from("leads")
        .select("status, source, created_at", { count: "exact" }),
      supabase
        .from("customers")
        .select("status, created_at", { count: "exact" }),
      supabase
        .from("reminders")
        .select("id")
        .is("completed_at", null)
        .gte("due_at", today.start)
        .lte("due_at", today.end),
      supabase
        .from("reminders")
        .select("id")
        .is("completed_at", null)
        .lt("due_at", today.start),
      getEmailAnalyticsRows(supabase),
      supabase
        .from("email_accounts")
        .select("last_sync_at")
        .order("last_sync_at", { ascending: false, nullsFirst: false })
        .limit(1),
      supabase
        .from("tasks")
        .select("id, status, due_at")
        .not("status", "in", '("completed","cancelled")'),
      supabase.from("campaigns").select("id, status").eq("status", "active"),
      supabase
        .from("activity_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    if (leadsResult.error) {
      throw toSupabaseError(leadsResult.error, "public.leads");
    }
    if (customersResult.error) {
      throw toSupabaseError(customersResult.error, "public.customers");
    }
    if (dueRemindersResult.error) {
      throw toSupabaseError(dueRemindersResult.error, "public.reminders");
    }
    if (overdueRemindersResult.error) {
      throw toSupabaseError(overdueRemindersResult.error, "public.reminders");
    }
    if (emailAccountsResult.error) {
      throw toSupabaseError(emailAccountsResult.error, "public.email_accounts");
    }
    if (tasksResult.error && !isMissingSupabaseSchemaError(tasksResult.error)) {
      throw toSupabaseError(tasksResult.error, "public.tasks");
    }
    if (
      campaignsResult.error &&
      !isMissingSupabaseSchemaError(campaignsResult.error)
    ) {
      throw toSupabaseError(campaignsResult.error, "public.campaigns");
    }
    if (activityResult.error) {
      throw toSupabaseError(activityResult.error, "public.activity_logs");
    }

    const byStatus = (rows: { status: string }[] | null, s: string) =>
      (rows ?? []).filter((r) => r.status === s).length;
    const tasksAvailable = !isMissingSupabaseSchemaError(tasksResult.error);
    const campaignsAvailable = !isMissingSupabaseSchemaError(
      campaignsResult.error,
    );
    const tasks = isMissingSupabaseSchemaError(tasksResult.error)
      ? []
      : (tasksResult.data ?? []);
    const campaigns = isMissingSupabaseSchemaError(campaignsResult.error)
      ? []
      : (campaignsResult.data ?? []);
    const activity = isMissingSupabaseSchemaError(activityResult.error)
      ? []
      : (activityResult.data ?? []);
    const emailRows = emails;
    const leadRows = leadsResult.data ?? [];
    const customerRows = customersResult.data ?? [];
    const emailsReceivedToday = emailRows.filter(
      (email) =>
        !isSentEmail(email) &&
        isBetweenIso(getEmailActivityDate(email), today.start, today.end),
    ).length;
    const emailsSentToday = emailRows.filter(
      (email) =>
        isSentEmail(email) &&
        isBetweenIso(getEmailActivityDate(email), today.start, today.end),
    ).length;
    const responseRate =
      emailsReceivedToday > 0
        ? Math.round((emailsSentToday / emailsReceivedToday) * 100)
        : 0;
    const conversionRate =
      leadRows.length > 0
        ? Math.round((byStatus(leadRows, "won") / leadRows.length) * 100)
        : 0;

    return {
      totalLeads: leadRows.length,
      newLeads: byStatus(leadRows, "new"),
      activeLeads: leadRows.filter(
        (lead) => !["won", "lost", "not_interested"].includes(lead.status),
      ).length,
      totalEmails: emailRows.length,
      unreadEmails: emailRows.filter((email) => !email.is_read).length,
      emailsReceivedToday,
      emailsSentToday,
      lastEmailSyncAt: emailAccountsResult.data?.[0]?.last_sync_at ?? null,
      followUpsDue: dueRemindersResult.data?.length ?? 0,
      overdueReminders: overdueRemindersResult.data?.length ?? 0,
      pendingTasks: tasks.length,
      activeCampaigns: campaigns.length,
      moduleAvailability: {
        tasks: tasksAvailable,
        campaigns: campaignsAvailable,
      },
      responseRate,
      leadConversionRate: conversionRate,
      wonCustomers: byStatus(leadRows, "won"),
      lostCustomers: byStatus(leadRows, "lost"),
      activeCustomers: customerRows.filter(
        (customer) => !["lost", "inactive", "closed"].includes(customer.status),
      ).length,
      chartData: {
        emailsByDay: groupEmailsByDay(emailRows),
        leadsByStatus: countRowsByField(leadRows, "status"),
        leadSources: countRowsByField(leadRows, "source"),
        customerGrowth: groupRowsByDay(customerRows),
      },
      activity,
    };
  });

export const getSidebarCounters = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const [
      inboxResult,
      leadsResult,
      customersResult,
      remindersResult,
      templatesResult,
      campaignsResult,
      contactsResult,
      tasksResult,
    ] = await Promise.all([
      supabase
        .from("emails")
        .select("id", { count: "exact" })
        .eq("is_read", false)
        .limit(1),
      supabase.from("leads").select("id", { count: "exact" }).limit(1),
      supabase.from("customers").select("id", { count: "exact" }).limit(1),
      supabase
        .from("reminders")
        .select("id", { count: "exact" })
        .is("completed_at", null)
        .limit(1),
      supabase
        .from("email_templates")
        .select("id", { count: "exact" })
        .limit(1),
      supabase
        .from("campaigns")
        .select("id", { count: "exact" })
        .eq("status", "active")
        .limit(1),
      supabase.from("contacts").select("id", { count: "exact" }).limit(1),
      supabase
        .from("tasks")
        .select("id", { count: "exact" })
        .not("status", "in", '("completed","cancelled")')
        .limit(1),
    ]);

    for (const [result, objectName] of [
      [inboxResult, "public.emails"],
      [leadsResult, "public.leads"],
      [customersResult, "public.customers"],
      [remindersResult, "public.reminders"],
      [templatesResult, "public.email_templates"],
    ] as const) {
      if (result.error) throw toSupabaseError(result.error, objectName);
    }

    for (const [result, objectName] of [
      [campaignsResult, "public.campaigns"],
      [contactsResult, "public.contacts"],
      [tasksResult, "public.tasks"],
    ] as const) {
      if (result.error && !isMissingSupabaseSchemaError(result.error)) {
        throw toSupabaseError(result.error, objectName);
      }
    }

    return {
      inbox: inboxResult.count ?? 0,
      leads: leadsResult.count ?? 0,
      customers: customersResult.count ?? 0,
      reminders: remindersResult.count ?? 0,
      templates: templatesResult.count ?? 0,
      campaigns: isMissingSupabaseSchemaError(campaignsResult.error)
        ? null
        : (campaignsResult.count ?? 0),
      contacts: isMissingSupabaseSchemaError(contactsResult.error)
        ? null
        : (contactsResult.count ?? 0),
      tasks: isMissingSupabaseSchemaError(tasksResult.error)
        ? null
        : (tasksResult.count ?? 0),
    };
  });

export const getEmailFolderCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ accountId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const selectEmails = (columns: string) => {
      let query = context.supabase.from("emails").select(columns);
      if (data.accountId) query = query.eq("account_id", data.accountId);
      return query;
    };

    const enhancedResult = await selectEmails(
      "is_read, is_starred, is_sent, is_draft, is_archived, is_spam, is_trashed, labels",
    );

    if (!enhancedResult.error) {
      return countEmailFolderRows(
        (enhancedResult.data ?? []) as EmailFolderCountRow[],
      );
    }

    if (!isMissingSupabaseSchemaError(enhancedResult.error)) {
      throw toSupabaseError(enhancedResult.error, "public.emails");
    }

    const legacyResult = await selectEmails("is_read, labels");
    if (legacyResult.error) {
      throw toSupabaseError(legacyResult.error, "public.emails");
    }

    return countEmailFolderRows(
      (legacyResult.data ?? []) as EmailFolderCountRow[],
    );
  });

// ---------- Email Accounts ----------
export const listEmailAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("email_accounts")
      .select("id, email_address, provider, last_sync_at, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      if (isMissingSupabaseSchemaError(error)) return [];
      throw toSupabaseError(error, "public.email_accounts");
    }
    return data ?? [];
  });

export const saveEmailAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        email_address: z.string().email(),
        connection_api_key: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { data: account, error } = await context.supabase
      .from("email_accounts")
      .upsert(
        {
          user_id: context.userId,
          provider: "gmail",
          email_address: data.email_address,
          connection_api_key: data.connection_api_key,
        },
        { onConflict: "user_id,email_address" },
      )
      .select("id, email_address, provider, last_sync_at, created_at")
      .single();
    if (error) throw toSupabaseError(error, "public.email_accounts");
    return account;
  });

export const deleteEmailAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("email_accounts")
      .delete()
      .eq("id", data.id);
    if (error) throw toSupabaseError(error, "public.email_accounts");
    return { ok: true };
  });

// ---------- Gmail Sync ----------
type GmailHeader = { name: string; value: string };
type GmailPayload = {
  partId?: string;
  filename?: string;
  headers?: GmailHeader[];
  mimeType?: string;
  body?: { attachmentId?: string; data?: string; size?: number };
  parts?: GmailPayload[];
};

function toStandardBase64(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
}

function decodeBase64Url(s: string): string {
  try {
    const b64 = toStandardBase64(s);
    if (typeof Buffer !== "undefined")
      return Buffer.from(b64, "base64").toString("utf-8");
    return atob(b64);
  } catch {
    return "";
  }
}

function extractBody(payload: GmailPayload | undefined): {
  html: string;
  text: string;
} {
  let html = "",
    text = "";
  const walk = (p?: GmailPayload) => {
    if (!p) return;
    if (p.mimeType === "text/html" && p.body?.data)
      html ||= decodeBase64Url(p.body.data);
    if (p.mimeType === "text/plain" && p.body?.data)
      text ||= decodeBase64Url(p.body.data);
    p.parts?.forEach(walk);
  };
  walk(payload);
  return { html, text };
}

function getHeader(headers: GmailHeader[] | undefined, name: string): string {
  return (
    headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ??
    ""
  );
}

type GmailAttachmentSummary = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
};

type GmailAttachmentPart = GmailAttachmentSummary & {
  gmailAttachmentId?: string;
  data?: string;
};

function collectGmailAttachments(
  payload: GmailPayload | undefined,
): GmailAttachmentPart[] {
  const attachments: GmailAttachmentPart[] = [];

  const walk = (part: GmailPayload | undefined, path: string) => {
    if (!part) return;
    const filename = part.filename?.trim() ?? "";
    const disposition = getHeader(part.headers, "Content-Disposition");
    const body = part.body;
    const hasAttachmentContent = Boolean(body?.attachmentId || body?.data);
    const looksLikeAttachment =
      hasAttachmentContent &&
      Boolean(filename || disposition.toLowerCase().includes("attachment"));

    if (looksLikeAttachment) {
      const attachmentId = body?.attachmentId;
      attachments.push({
        id: attachmentId
          ? `gmail:${attachmentId}`
          : `part:${part.partId ?? path}`,
        gmailAttachmentId: attachmentId,
        data: body?.data,
        filename:
          filename ||
          `attachment-${attachments.length + 1}.${(part.mimeType ?? "file")
            .split("/")
            .pop()}`,
        mimeType: part.mimeType ?? "application/octet-stream",
        size: body?.size ?? 0,
      });
    }

    part.parts?.forEach((child, index) => walk(child, `${path}.${index}`));
  };

  walk(payload, "0");
  return attachments;
}

function getGmailStatusFields(labelIds: string[], payload?: GmailPayload) {
  const hasLabel = (label: string) => labelIds.includes(label);
  const isSent = hasLabel("SENT");
  const isDraft = hasLabel("DRAFT");
  const isSpam = hasLabel("SPAM");
  const isTrashed = hasLabel("TRASH");

  return {
    is_read: !hasLabel("UNREAD"),
    is_starred: hasLabel("STARRED"),
    is_archived:
      !hasLabel("INBOX") && !isSent && !isDraft && !isSpam && !isTrashed,
    is_sent: isSent,
    is_draft: isDraft,
    is_spam: isSpam,
    is_trashed: isTrashed,
    has_attachments: collectGmailAttachments(payload).length > 0,
  };
}

function updateLocalLabels(
  labels: unknown,
  addLabelIds: string[] = [],
  removeLabelIds: string[] = [],
) {
  const nextLabels = new Set(
    Array.isArray(labels)
      ? labels.filter((label): label is string => typeof label === "string")
      : [],
  );

  for (const label of removeLabelIds) nextLabels.delete(label);
  for (const label of addLabelIds) nextLabels.add(label);

  return Array.from(nextLabels);
}

function parseFrom(raw: string): { email: string; name: string } {
  const m = raw.match(/^(.*?)<(.+?)>\s*$/);
  if (m) return { name: m[1].trim().replace(/^"|"$/g, ""), email: m[2].trim() };
  return { email: raw.trim(), name: "" };
}

type StoredGmailConnection = {
  accessToken?: string;
  refreshToken?: string | null;
  expiresAt?: number | null;
};

type EmailAccountRow = Database["public"]["Tables"]["email_accounts"]["Row"];

function parseGmailConnection(connectionApiKey: string): StoredGmailConnection {
  try {
    const parsed = JSON.parse(connectionApiKey) as StoredGmailConnection;
    if (parsed.accessToken) return parsed;
  } catch {
    // Older saved rows may contain a raw token string.
  }

  return { accessToken: connectionApiKey };
}

function isGmailAccessTokenFresh(connection: StoredGmailConnection) {
  if (!connection.accessToken) return false;
  if (!connection.expiresAt) return true;
  return connection.expiresAt * 1000 > Date.now() + 60_000;
}

async function getGmailAccessToken({
  context,
  account,
  forceRefresh = false,
}: {
  context: AuthenticatedFunctionContext;
  account: EmailAccountRow;
  forceRefresh?: boolean;
}) {
  const connection = parseGmailConnection(account.connection_api_key);
  if (!forceRefresh && isGmailAccessTokenFresh(connection)) {
    return connection.accessToken!;
  }

  if (!connection.refreshToken) {
    throw new Error(
      "Gmail authorization expired. Reconnect Gmail once in Settings to enable automatic sync.",
    );
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
    if (tokenPayload.error === "invalid_grant") {
      throw new Error(
        "Gmail authorization expired. Reconnect Gmail once in Settings to enable automatic sync.",
      );
    }
    throw new Error(
      `Gmail token refresh failed: ${
        tokenPayload.error_description ??
        tokenPayload.error ??
        tokenResponse.status
      }`,
    );
  }

  const refreshedConnection: StoredGmailConnection = {
    accessToken: tokenPayload.access_token,
    refreshToken: tokenPayload.refresh_token ?? connection.refreshToken,
    expiresAt:
      Math.floor(Date.now() / 1000) + (tokenPayload.expires_in ?? 3600),
  };
  const connectionApiKey = JSON.stringify(refreshedConnection);
  const { error: updateError } = await context.supabase
    .from("email_accounts")
    .update({ connection_api_key: connectionApiKey })
    .eq("id", account.id);
  if (updateError) {
    throw toSupabaseError(updateError, "public.email_accounts");
  }

  account.connection_api_key = connectionApiKey;
  return tokenPayload.access_token;
}

async function callGmailApi({
  context,
  account,
  path,
  init,
}: {
  context: AuthenticatedFunctionContext;
  account: EmailAccountRow;
  path: string;
  init?: RequestInit;
}): Promise<Response> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const makeRequest = async (accessToken: string) => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    return fetch(`${GMAIL_API_BASE_URL}${normalizedPath}`, {
      ...init,
      headers,
    });
  };

  let accessToken = await getGmailAccessToken({ context, account });
  let response = await makeRequest(accessToken);
  if (response.status === 401) {
    accessToken = await getGmailAccessToken({
      context,
      account,
      forceRefresh: true,
    });
    response = await makeRequest(accessToken);
  }
  return response;
}

async function throwGmailError(action: string, res: Response): Promise<never> {
  const details = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Gmail ${action} failed. Reconnect Gmail in Settings.`);
  }

  throw new Error(`Gmail ${action} failed: ${res.status} ${details}`);
}

async function getEmailAndAccount(
  context: AuthenticatedFunctionContext,
  emailId: string,
) {
  const { data: email, error: emailError } = await context.supabase
    .from("emails")
    .select("*")
    .eq("id", emailId)
    .single();
  if (emailError || !email) throw new Error("Email not found");

  const { data: account, error: accountError } = await context.supabase
    .from("email_accounts")
    .select("*")
    .eq("id", email.account_id)
    .single();
  if (accountError || !account) throw new Error("Email account not found");

  return { email, account };
}

async function modifyGmailLabels({
  context,
  emailId,
  addLabelIds = [],
  removeLabelIds = [],
}: {
  context: AuthenticatedFunctionContext;
  emailId: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
}) {
  const { email, account } = await getEmailAndAccount(context, emailId);
  if (!email.gmail_message_id) return { email, account };

  const res = await callGmailApi({
    context,
    account,
    path: `/gmail/v1/users/me/messages/${email.gmail_message_id}/modify`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addLabelIds, removeLabelIds }),
    },
  });
  if (!res.ok) await throwGmailError("label update", res);
  return { email, account };
}

export const syncGmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        accountId: z.string().uuid(),
        maxResults: z.number().min(1).max(100).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { data: account, error: accErr } = await context.supabase
      .from("email_accounts")
      .select("*")
      .eq("id", data.accountId)
      .single();
    if (accErr || !account) throw new Error("Account not found");

    const enhancedSchemaResult = await context.supabase
      .from("emails")
      .select("is_starred")
      .limit(1);
    const supportsEnhancedEmailSchema = !enhancedSchemaResult.error;
    if (
      enhancedSchemaResult.error &&
      !isMissingSupabaseSchemaError(enhancedSchemaResult.error)
    ) {
      throw toSupabaseError(enhancedSchemaResult.error, "public.emails");
    }

    const listRes = await callGmailApi({
      context,
      account,
      path: `/gmail/v1/users/me/messages?maxResults=${data.maxResults ?? 100}&includeSpamTrash=true`,
    });
    if (!listRes.ok) await throwGmailError("list", listRes);
    const listJson = (await listRes.json()) as { messages?: { id: string }[] };
    const messageIds = (listJson.messages ?? []).map((m) => m.id);

    let imported = 0;
    let updated = 0;
    for (const mid of messageIds) {
      const msgRes = await callGmailApi({
        context,
        account,
        path: `/gmail/v1/users/me/messages/${mid}?format=full`,
      });
      if (!msgRes.ok) continue;
      const msg = (await msgRes.json()) as {
        id: string;
        threadId: string;
        snippet?: string;
        labelIds?: string[];
        internalDate?: string;
        payload?: GmailPayload;
      };
      const headers = msg.payload?.headers;
      const from = parseFrom(getHeader(headers, "From"));
      const to = getHeader(headers, "To")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const cc = getHeader(headers, "Cc")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const subject = getHeader(headers, "Subject");
      const { html, text } = extractBody(msg.payload);
      const receivedAt = msg.internalDate
        ? new Date(Number(msg.internalDate)).toISOString()
        : new Date().toISOString();
      const labelIds = msg.labelIds ?? [];
      const statusFields = getGmailStatusFields(labelIds, msg.payload);

      const legacyEmailFields = {
        gmail_thread_id: msg.threadId,
        from_email: from.email,
        from_name: from.name,
        to_emails: to,
        cc_emails: cc,
        subject,
        snippet: msg.snippet ?? "",
        body_html: html,
        body_text: text,
        received_at: receivedAt,
        is_read: statusFields.is_read,
        labels: labelIds,
      };

      const enhancedEmailFields = supportsEnhancedEmailSchema
        ? {
            ...legacyEmailFields,
            sent_at: statusFields.is_sent ? receivedAt : null,
            is_starred: statusFields.is_starred,
            is_archived: statusFields.is_archived,
            is_sent: statusFields.is_sent,
            is_draft: statusFields.is_draft,
            is_spam: statusFields.is_spam,
            is_trashed: statusFields.is_trashed,
            has_attachments: statusFields.has_attachments,
          }
        : legacyEmailFields;

      const { data: existing, error: existingError } = await context.supabase
        .from("emails")
        .select("id")
        .eq("account_id", account.id)
        .eq("gmail_message_id", mid)
        .maybeSingle();
      if (existingError) {
        throw toSupabaseError(existingError, "public.emails");
      }

      if (existing) {
        const { error: updateError } = await context.supabase
          .from("emails")
          .update(enhancedEmailFields)
          .eq("id", existing.id);
        if (updateError) {
          throw toSupabaseError(updateError, "public.emails");
        }
        updated++;
        continue;
      }

      const legacyEmailRow = {
        user_id: context.userId,
        account_id: account.id,
        gmail_message_id: msg.id,
        ...legacyEmailFields,
      };
      const emailRow = supportsEnhancedEmailSchema
        ? {
            ...legacyEmailRow,
            sent_at: statusFields.is_sent ? receivedAt : null,
            is_starred: statusFields.is_starred,
            is_archived: statusFields.is_archived,
            is_sent: statusFields.is_sent,
            is_draft: statusFields.is_draft,
            is_spam: statusFields.is_spam,
            is_trashed: statusFields.is_trashed,
            has_attachments: statusFields.has_attachments,
          }
        : legacyEmailRow;
      const { error: insertError } = await context.supabase
        .from("emails")
        .insert(emailRow);
      if (insertError) {
        throw toSupabaseError(insertError, "public.emails");
      }
      imported++;
    }

    const syncedAt = new Date().toISOString();
    const { error: updateErr } = await context.supabase
      .from("email_accounts")
      .update({ last_sync_at: syncedAt })
      .eq("id", account.id);
    if (updateErr) throw toSupabaseError(updateErr, "public.email_accounts");

    const { error: activityErr } = await context.supabase
      .from("activity_logs")
      .insert({
        actor_id: context.userId,
        entity_type: "email_account",
        entity_id: account.id,
        action: "sync",
        metadata: { imported, updated, scanned: messageIds.length },
      });
    if (activityErr && !isMissingSupabaseSchemaError(activityErr)) {
      throw toSupabaseError(activityErr, "public.activity_logs");
    }

    return { imported, updated, scanned: messageIds.length, syncedAt };
  });

export const listEmailAttachments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ emailId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { email, account } = await getEmailAndAccount(context, data.emailId);
    if (!email.gmail_message_id) return [];

    const res = await callGmailApi({
      context,
      account,
      path: `/gmail/v1/users/me/messages/${email.gmail_message_id}?format=full`,
    });
    if (!res.ok) await throwGmailError("attachment list", res);

    const msg = (await res.json()) as { payload?: GmailPayload };
    return collectGmailAttachments(msg.payload).map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
    }));
  });

export const getEmailAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        emailId: z.string().uuid(),
        attachmentId: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { email, account } = await getEmailAndAccount(context, data.emailId);
    if (!email.gmail_message_id) throw new Error("Email has no Gmail message.");

    const msgRes = await callGmailApi({
      context,
      account,
      path: `/gmail/v1/users/me/messages/${email.gmail_message_id}?format=full`,
    });
    if (!msgRes.ok) await throwGmailError("attachment lookup", msgRes);

    const msg = (await msgRes.json()) as { payload?: GmailPayload };
    const attachment = collectGmailAttachments(msg.payload).find(
      (candidate) => candidate.id === data.attachmentId,
    );
    if (!attachment) throw new Error("Attachment not found.");

    let encodedData = attachment.data;
    let size = attachment.size;
    if (attachment.gmailAttachmentId) {
      const attachmentRes = await callGmailApi({
        context,
        account,
        path: `/gmail/v1/users/me/messages/${email.gmail_message_id}/attachments/${attachment.gmailAttachmentId}`,
      });
      if (!attachmentRes.ok)
        await throwGmailError("attachment download", attachmentRes);
      const body = (await attachmentRes.json()) as {
        data?: string;
        size?: number;
      };
      encodedData = body.data;
      size = body.size ?? size;
    }

    if (!encodedData) throw new Error("Attachment content is not available.");

    return {
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size,
      data: toStandardBase64(encodedData),
    };
  });

export const sendGmailReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        accountId: z.string().uuid(),
        to: z.string().email(),
        subject: z.string().min(1).max(998),
        body: z.string().min(1).max(50000),
        threadId: z.string().optional(),
        inReplyToEmailId: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { data: account } = await context.supabase
      .from("email_accounts")
      .select("*")
      .eq("id", data.accountId)
      .single();
    if (!account) throw new Error("Account not found");

    const rfc = [
      `To: ${data.to}`,
      `Subject: ${data.subject}`,
      `From: ${account.email_address}`,
      'Content-Type: text/html; charset="UTF-8"',
      "MIME-Version: 1.0",
      "",
      data.body,
    ].join("\r\n");
    const raw = (
      typeof Buffer !== "undefined"
        ? Buffer.from(rfc).toString("base64")
        : btoa(rfc)
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const body: Record<string, unknown> = { raw };
    if (data.threadId) body.threadId = data.threadId;

    const res = await callGmailApi({
      context,
      account,
      path: "/gmail/v1/users/me/messages/send",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    });
    if (!res.ok) await throwGmailError("send", res);
    const sent = (await res.json()) as {
      id?: string;
      threadId?: string;
      labelIds?: string[];
    };

    const { data: insertedEmail } = await context.supabase
      .from("emails")
      .insert({
        user_id: context.userId,
        account_id: account.id,
        gmail_message_id: sent.id ?? crypto.randomUUID(),
        gmail_thread_id: sent.threadId ?? data.threadId ?? null,
        from_email: account.email_address,
        from_name: account.email_address,
        to_emails: [data.to],
        subject: data.subject,
        snippet: data.body.replace(/<[^>]*>/g, " ").slice(0, 200),
        body_html: data.body,
        body_text: data.body.replace(/<[^>]*>/g, " "),
        received_at: new Date().toISOString(),
        sent_at: new Date().toISOString(),
        is_read: true,
        is_starred: false,
        is_archived: false,
        is_sent: true,
        is_draft: false,
        is_spam: false,
        is_trashed: false,
        has_attachments: false,
        labels: sent.labelIds ?? ["SENT"],
      })
      .select("id")
      .maybeSingle();

    await context.supabase.from("activity_logs").insert({
      actor_id: context.userId,
      entity_type: "email",
      entity_id: insertedEmail?.id ?? data.inReplyToEmailId ?? null,
      action: "reply_sent",
      metadata: { to: data.to, subject: data.subject },
    });
    return { ok: true };
  });

// ---------- Emails ----------
export const listEmails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        search: z.string().optional(),
        status: z
          .enum([
            "all",
            "unread",
            "read",
            "starred",
            "sent",
            "drafts",
            "archived",
            "spam",
            "trash",
          ])
          .optional(),
        fromDate: z.string().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    let q = context.supabase
      .from("emails")
      .select("*")
      .order("received_at", { ascending: false })
      .limit(200);
    if (data.search)
      q = q.or(
        `subject.ilike.%${data.search}%,from_email.ilike.%${data.search}%,from_name.ilike.%${data.search}%`,
      );
    if (data.status === "unread") q = q.eq("is_read", false);
    if (data.status === "read") {
      q = q
        .eq("is_read", true)
        .eq("is_spam", false)
        .eq("is_trashed", false)
        .eq("is_draft", false);
    }
    if (data.status === "starred") q = q.eq("is_starred", true);
    if (data.status === "sent") q = q.eq("is_sent", true);
    if (data.status === "drafts") q = q.eq("is_draft", true);
    if (data.status === "archived") {
      q = q
        .eq("is_archived", true)
        .eq("is_sent", false)
        .eq("is_draft", false)
        .eq("is_spam", false)
        .eq("is_trashed", false);
    }
    if (data.status === "spam") q = q.eq("is_spam", true);
    if (data.status === "trash") q = q.eq("is_trashed", true);
    if (data.fromDate) q = q.gte("received_at", data.fromDate);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

export const markEmailRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), isRead: z.boolean() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { email } = await modifyGmailLabels({
      context,
      emailId: data.id,
      addLabelIds: data.isRead ? [] : ["UNREAD"],
      removeLabelIds: data.isRead ? ["UNREAD"] : [],
    });
    const { error } = await context.supabase
      .from("emails")
      .update({
        is_read: data.isRead,
        labels: updateLocalLabels(
          email.labels,
          data.isRead ? [] : ["UNREAD"],
          data.isRead ? ["UNREAD"] : [],
        ),
      })
      .eq("id", data.id);
    if (error) throw toSupabaseError(error, "public.emails");
    await context.supabase.from("activity_logs").insert({
      actor_id: context.userId,
      entity_type: "email",
      entity_id: data.id,
      action: data.isRead ? "marked_read" : "marked_unread",
    });
    return { ok: true };
  });

export const starEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), isStarred: z.boolean() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { email } = await modifyGmailLabels({
      context,
      emailId: data.id,
      addLabelIds: data.isStarred ? ["STARRED"] : [],
      removeLabelIds: data.isStarred ? [] : ["STARRED"],
    });
    const { error } = await context.supabase
      .from("emails")
      .update({
        is_starred: data.isStarred,
        labels: updateLocalLabels(
          email.labels,
          data.isStarred ? ["STARRED"] : [],
          data.isStarred ? [] : ["STARRED"],
        ),
      })
      .eq("id", data.id);
    if (error) throw toSupabaseError(error, "public.emails");
    return { ok: true };
  });

export const archiveEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { email } = await modifyGmailLabels({
      context,
      emailId: data.id,
      removeLabelIds: ["INBOX"],
    });
    const { error } = await context.supabase
      .from("emails")
      .update({
        is_archived: true,
        is_trashed: false,
        is_spam: false,
        labels: updateLocalLabels(email.labels, [], ["INBOX", "TRASH", "SPAM"]),
      })
      .eq("id", data.id);
    if (error) throw toSupabaseError(error, "public.emails");
    return { ok: true };
  });

export const trashEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { email, account } = await getEmailAndAccount(context, data.id);
    const res = await callGmailApi({
      context,
      account,
      path: `/gmail/v1/users/me/messages/${email.gmail_message_id}/trash`,
      init: { method: "POST" },
    });
    if (!res.ok) await throwGmailError("trash", res);
    const { error } = await context.supabase
      .from("emails")
      .update({
        is_trashed: true,
        is_archived: false,
        is_spam: false,
        labels: updateLocalLabels(email.labels, ["TRASH"], ["INBOX"]),
      })
      .eq("id", data.id);
    if (error) throw toSupabaseError(error, "public.emails");
    return { ok: true };
  });

export const bulkUpdateEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(100),
        action: z.enum([
          "mark_read",
          "mark_unread",
          "archive",
          "trash",
          "star",
          "unstar",
        ]),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    for (const id of data.ids) {
      if (data.action === "mark_read") {
        const { email } = await modifyGmailLabels({
          context,
          emailId: id,
          removeLabelIds: ["UNREAD"],
        });
        const { error } = await context.supabase
          .from("emails")
          .update({
            is_read: true,
            labels: updateLocalLabels(email.labels, [], ["UNREAD"]),
          })
          .eq("id", id);
        if (error) throw toSupabaseError(error, "public.emails");
      }
      if (data.action === "mark_unread") {
        const { email } = await modifyGmailLabels({
          context,
          emailId: id,
          addLabelIds: ["UNREAD"],
        });
        const { error } = await context.supabase
          .from("emails")
          .update({
            is_read: false,
            labels: updateLocalLabels(email.labels, ["UNREAD"]),
          })
          .eq("id", id);
        if (error) throw toSupabaseError(error, "public.emails");
      }
      if (data.action === "archive") {
        const { email } = await modifyGmailLabels({
          context,
          emailId: id,
          removeLabelIds: ["INBOX"],
        });
        const { error } = await context.supabase
          .from("emails")
          .update({
            is_archived: true,
            is_trashed: false,
            is_spam: false,
            labels: updateLocalLabels(email.labels, [], [
              "INBOX",
              "TRASH",
              "SPAM",
            ]),
          })
          .eq("id", id);
        if (error) throw toSupabaseError(error, "public.emails");
      }
      if (data.action === "star" || data.action === "unstar") {
        const isStarred = data.action === "star";
        const { email } = await modifyGmailLabels({
          context,
          emailId: id,
          addLabelIds: isStarred ? ["STARRED"] : [],
          removeLabelIds: isStarred ? [] : ["STARRED"],
        });
        const { error } = await context.supabase
          .from("emails")
          .update({
            is_starred: isStarred,
            labels: updateLocalLabels(
              email.labels,
              isStarred ? ["STARRED"] : [],
              isStarred ? [] : ["STARRED"],
            ),
          })
          .eq("id", id);
        if (error) throw toSupabaseError(error, "public.emails");
      }
      if (data.action === "trash") {
        const { email, account } = await getEmailAndAccount(context, id);
        const res = await callGmailApi({
          context,
          account,
          path: `/gmail/v1/users/me/messages/${email.gmail_message_id}/trash`,
          init: { method: "POST" },
        });
        if (!res.ok) await throwGmailError("trash", res);
        const { error } = await context.supabase
          .from("emails")
          .update({
            is_trashed: true,
            is_archived: false,
            is_spam: false,
            labels: updateLocalLabels(email.labels, ["TRASH"], ["INBOX"]),
          })
          .eq("id", id);
        if (error) throw toSupabaseError(error, "public.emails");
      }
    }
    return { ok: true, count: data.ids.length };
  });

// ---------- Leads ----------
export const listLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const getLead = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const [
      { data: lead },
      { data: notes },
      { data: reminders },
      { data: emails },
      { data: activity },
    ] = await Promise.all([
      context.supabase.from("leads").select("*").eq("id", data.id).single(),
      context.supabase
        .from("notes")
        .select("*")
        .eq("lead_id", data.id)
        .order("created_at", { ascending: false }),
      context.supabase
        .from("reminders")
        .select("*")
        .eq("lead_id", data.id)
        .order("due_at"),
      context.supabase
        .from("emails")
        .select("*")
        .eq("lead_id", data.id)
        .order("received_at", { ascending: false }),
      context.supabase
        .from("activity_logs")
        .select("*")
        .eq("entity_type", "lead")
        .eq("entity_id", data.id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    return {
      lead,
      notes: notes ?? [],
      reminders: reminders ?? [],
      emails: emails ?? [],
      activity: activity ?? [],
    };
  });

export const createLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        email: z.string().email().max(255),
        name: z.string().max(100).optional(),
        company: z.string().max(150).optional(),
        phone: z.string().max(50).optional(),
        source: z.string().max(50).optional(),
        from_email_id: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { data: lead, error } = await context.supabase
      .from("leads")
      .upsert(
        {
          owner_id: context.userId,
          created_by: context.userId,
          email: data.email,
          name: data.name,
          company: data.company,
          phone: data.phone,
          source: data.source ?? "email",
        },
        { onConflict: "owner_id,email" },
      )
      .select()
      .single();
    if (error) throw error;
    if (data.from_email_id) {
      await context.supabase
        .from("emails")
        .update({ lead_id: lead.id })
        .eq("id", data.from_email_id);
    }
    // link any other emails from same sender
    await context.supabase
      .from("emails")
      .update({ lead_id: lead.id })
      .eq("user_id", context.userId)
      .eq("from_email", data.email)
      .is("lead_id", null);
    await context.supabase.from("activity_logs").insert({
      actor_id: context.userId,
      entity_type: "lead",
      entity_id: lead.id,
      action: "created",
      metadata: { email: data.email },
    });
    return lead;
  });

export const updateLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().max(100).nullable().optional(),
        company: z.string().max(150).nullable().optional(),
        phone: z.string().max(50).nullable().optional(),
        job_title: z.string().max(150).nullable().optional(),
        source: z.string().max(50).nullable().optional(),
        priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
        estimated_value: z.number().nullable().optional(),
        assigned_user_id: z.string().uuid().nullable().optional(),
        tags: z.array(z.string().max(50)).optional(),
        next_follow_up_at: z.string().nullable().optional(),
        status: z
          .enum([
            "new",
            "contacted",
            "qualified",
            "follow_up",
            "proposal_sent",
            "negotiation",
            "won",
            "lost",
            "not_interested",
          ])
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase
      .from("leads")
      .update(patch)
      .eq("id", id);
    if (error) throw error;
    if (patch.status) {
      await context.supabase.from("activity_logs").insert({
        actor_id: context.userId,
        entity_type: "lead",
        entity_id: id,
        action: "status_changed",
        metadata: { status: patch.status },
      });
    }
    return { ok: true };
  });

export const deleteLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await context.supabase.from("leads").delete().eq("id", data.id);
    return { ok: true };
  });

// ---------- Customers ----------
export const listCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("customers")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const getCustomer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const [
      { data: customer },
      { data: notes },
      { data: reminders },
      { data: emails },
      { data: activity },
    ] = await Promise.all([
      context.supabase.from("customers").select("*").eq("id", data.id).single(),
      context.supabase
        .from("notes")
        .select("*")
        .eq("customer_id", data.id)
        .order("created_at", { ascending: false }),
      context.supabase
        .from("reminders")
        .select("*")
        .eq("customer_id", data.id)
        .order("due_at"),
      context.supabase
        .from("emails")
        .select("*")
        .eq("customer_id", data.id)
        .order("received_at", { ascending: false }),
      context.supabase
        .from("activity_logs")
        .select("*")
        .eq("entity_type", "customer")
        .eq("entity_id", data.id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    return {
      customer,
      notes: notes ?? [],
      reminders: reminders ?? [],
      emails: emails ?? [],
      activity: activity ?? [],
    };
  });

export const convertLeadToCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ leadId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { data: lead } = await context.supabase
      .from("leads")
      .select("*")
      .eq("id", data.leadId)
      .single();
    if (!lead) throw new Error("Lead not found");
    const { data: customer, error } = await context.supabase
      .from("customers")
      .upsert(
        {
          owner_id: lead.owner_id,
          lead_id: lead.id,
          email: lead.email,
          name: lead.name,
          company: lead.company,
          phone: lead.phone,
        },
        { onConflict: "owner_id,email" },
      )
      .select()
      .single();
    if (error) throw error;
    await context.supabase
      .from("leads")
      .update({ status: "won" })
      .eq("id", lead.id);
    await context.supabase
      .from("emails")
      .update({ customer_id: customer.id })
      .eq("lead_id", lead.id);
    await context.supabase.from("activity_logs").insert({
      actor_id: context.userId,
      entity_type: "customer",
      entity_id: customer.id,
      action: "converted_from_lead",
      metadata: { lead_id: lead.id },
    });
    return customer;
  });

export const createCustomerFromEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        email: z.string().email(),
        name: z.string().max(100).optional(),
        from_email_id: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { data: customer, error } = await context.supabase
      .from("customers")
      .upsert(
        {
          owner_id: context.userId,
          email: data.email,
          name: data.name,
        },
        { onConflict: "owner_id,email" },
      )
      .select()
      .single();
    if (error) throw error;
    await context.supabase
      .from("emails")
      .update({ customer_id: customer.id })
      .eq("user_id", context.userId)
      .eq("from_email", data.email);
    if (data.from_email_id) {
      await context.supabase
        .from("emails")
        .update({ customer_id: customer.id })
        .eq("id", data.from_email_id);
    }
    await context.supabase.from("activity_logs").insert({
      actor_id: context.userId,
      entity_type: "customer",
      entity_id: customer.id,
      action: "created",
    });
    return customer;
  });

export const updateCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().max(100).nullable().optional(),
        company: z.string().max(150).nullable().optional(),
        phone: z.string().max(50).nullable().optional(),
        address: z.string().max(500).nullable().optional(),
        job_title: z.string().max(150).nullable().optional(),
        priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
        assigned_user_id: z.string().uuid().nullable().optional(),
        tags: z.array(z.string().max(50)).optional(),
        last_contact_at: z.string().nullable().optional(),
        next_follow_up_at: z.string().nullable().optional(),
        deal_value: z.number().nullable().optional(),
        status: z
          .enum([
            "active",
            "inactive",
            "vip",
            "onboarding",
            "at_risk",
            "closed",
            "lost",
          ])
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase
      .from("customers")
      .update(patch)
      .eq("id", id);
    if (error) throw error;
    return { ok: true };
  });

// ---------- Notes ----------
export const createNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        body: z.string().min(1).max(5000),
        lead_id: z.string().uuid().optional(),
        customer_id: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    if (!data.lead_id && !data.customer_id)
      throw new Error("lead_id or customer_id required");
    const { error } = await context.supabase.from("notes").insert({
      author_id: context.userId,
      body: data.body,
      lead_id: data.lead_id,
      customer_id: data.customer_id,
    });
    if (error) throw error;
    return { ok: true };
  });

// ---------- Reminders ----------
export const listMyReminders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("reminders")
      .select("*")
      .order("due_at");
    return data ?? [];
  });

export const createReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        title: z.string().min(1).max(200),
        notes: z.string().max(2000).optional(),
        due_at: z.string(),
        type: z
          .enum([
            "email_follow_up",
            "call",
            "meeting",
            "send_proposal",
            "request_documents",
            "payment_follow_up",
            "general",
          ])
          .optional(),
        priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
        assigned_user_id: z.string().uuid().optional(),
        lead_id: z.string().uuid().optional(),
        customer_id: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("reminders").insert({
      user_id: context.userId,
      ...data,
    });
    if (error) throw error;
    return { ok: true };
  });

export const completeReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), completed: z.boolean() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await context.supabase
      .from("reminders")
      .update({
        completed_at: data.completed ? new Date().toISOString() : null,
      })
      .eq("id", data.id);
    return { ok: true };
  });

export const deleteReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await context.supabase.from("reminders").delete().eq("id", data.id);
    return { ok: true };
  });

// ---------- Templates ----------
export const listTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("email_templates")
      .select("*")
      .order("created_at", { ascending: false });
    return data ?? [];
  });

export const upsertTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(100),
        subject: z.string().min(1).max(200),
        body: z.string().min(1).max(10000),
        category: z
          .enum([
            "introduction",
            "follow_up",
            "sales",
            "proposal",
            "customer_support",
            "payment_reminder",
            "meeting_invitation",
            "thank_you",
            "rejection",
            "custom",
          ])
          .optional(),
        variables: z.array(z.string().max(60)).optional(),
        visibility: z.enum(["private", "team", "public"]).optional(),
        is_shared: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const row = { ...data, user_id: context.userId };
    const { error } = await context.supabase
      .from("email_templates")
      .upsert(row);
    if (error) throw error;
    return { ok: true };
  });

export const deleteTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await context.supabase.from("email_templates").delete().eq("id", data.id);
    return { ok: true };
  });

// ---------- Contacts ----------
export const listContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ search: z.string().optional() }).parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    let q = context.supabase
      .from("contacts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    if (data.search) {
      q = q.or(
        `full_name.ilike.%${data.search}%,email.ilike.%${data.search}%,company.ilike.%${data.search}%`,
      );
    }
    const { data: rows, error } = await q;
    if (error) throw toSupabaseError(error, "public.contacts");
    return rows ?? [];
  });

export const upsertContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        email: z.string().email(),
        first_name: z.string().max(100).optional(),
        last_name: z.string().max(100).optional(),
        full_name: z.string().max(200).optional(),
        phone: z.string().max(50).optional(),
        company: z.string().max(150).optional(),
        job_title: z.string().max(150).optional(),
        source: z.string().max(50).optional(),
        tags: z.array(z.string().max(50)).optional(),
        notes: z.string().max(3000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const fullName =
      data.full_name ||
      [data.first_name, data.last_name].filter(Boolean).join(" ") ||
      data.email;
    const { data: contact, error } = await context.supabase
      .from("contacts")
      .upsert(
        {
          ...data,
          owner_id: context.userId,
          full_name: fullName,
          source: data.source ?? "manual",
        },
        { onConflict: "owner_id,email" },
      )
      .select()
      .single();
    if (error) throw toSupabaseError(error, "public.contacts");
    return contact;
  });

export const deleteContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("contacts")
      .delete()
      .eq("id", data.id);
    if (error) throw toSupabaseError(error, "public.contacts");
    return { ok: true };
  });

export const importContactsFromEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: emails, error } = await context.supabase
      .from("emails")
      .select("from_email, from_name, lead_id, customer_id, received_at")
      .eq("user_id", context.userId);
    if (error) throw toSupabaseError(error, "public.emails");

    type ImportedContactRow = {
      owner_id: string;
      email: string;
      full_name: string;
      source: string;
      lead_id: string | null;
      customer_id: string | null;
      last_contact_at: string | null;
    };

    const unique = new Map<string, ImportedContactRow>();
    for (const email of emails ?? []) {
      if (!email.from_email || unique.has(email.from_email)) continue;
      unique.set(email.from_email, {
        owner_id: context.userId,
        email: email.from_email,
        full_name: email.from_name || email.from_email,
        source: "gmail",
        lead_id: email.lead_id,
        customer_id: email.customer_id,
        last_contact_at: email.received_at,
      });
    }

    const rows = [...unique.values()];
    if (rows.length === 0) return { imported: 0 };
    const { error: upsertError } = await context.supabase
      .from("contacts")
      .upsert(rows, { onConflict: "owner_id,email" });
    if (upsertError) throw toSupabaseError(upsertError, "public.contacts");
    return { imported: rows.length };
  });

export const convertContactToLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { data: contact, error } = await context.supabase
      .from("contacts")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error || !contact) throw new Error("Contact not found");

    const { data: lead, error: leadError } = await context.supabase
      .from("leads")
      .upsert(
        {
          owner_id: context.userId,
          created_by: context.userId,
          email: contact.email,
          name: contact.full_name,
          company: contact.company,
          phone: contact.phone,
          source: contact.source ?? "contact",
          job_title: contact.job_title,
          tags: contact.tags ?? [],
        },
        { onConflict: "owner_id,email" },
      )
      .select()
      .single();
    if (leadError) throw toSupabaseError(leadError, "public.leads");
    await context.supabase
      .from("contacts")
      .update({ lead_id: lead.id })
      .eq("id", contact.id);
    return lead;
  });

export const convertContactToCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { data: contact, error } = await context.supabase
      .from("contacts")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error || !contact) throw new Error("Contact not found");

    const { data: customer, error: customerError } = await context.supabase
      .from("customers")
      .upsert(
        {
          owner_id: context.userId,
          email: contact.email,
          name: contact.full_name,
          company: contact.company,
          phone: contact.phone,
          job_title: contact.job_title,
          tags: contact.tags ?? [],
        },
        { onConflict: "owner_id,email" },
      )
      .select()
      .single();
    if (customerError) throw toSupabaseError(customerError, "public.customers");
    await context.supabase
      .from("contacts")
      .update({ customer_id: customer.id })
      .eq("id", contact.id);
    return customer;
  });

// ---------- Tasks ----------
export const listTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        status: z
          .enum([
            "all",
            "todo",
            "in_progress",
            "waiting",
            "completed",
            "cancelled",
          ])
          .optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    let q = context.supabase
      .from("tasks")
      .select("*")
      .order("due_at", { ascending: true, nullsFirst: false });
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw toSupabaseError(error, "public.tasks");
    return rows ?? [];
  });

export const upsertTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        title: z.string().min(1).max(200),
        description: z.string().max(3000).optional(),
        due_at: z.string().optional(),
        priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
        status: z
          .enum(["todo", "in_progress", "waiting", "completed", "cancelled"])
          .optional(),
        assigned_user_id: z.string().uuid().optional(),
        email_id: z.string().uuid().optional(),
        lead_id: z.string().uuid().optional(),
        customer_id: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const completed_at =
      data.status === "completed" ? new Date().toISOString() : null;
    const { data: task, error } = await context.supabase
      .from("tasks")
      .upsert({ ...data, owner_id: context.userId, completed_at })
      .select()
      .single();
    if (error) throw toSupabaseError(error, "public.tasks");
    await context.supabase.from("activity_logs").insert({
      actor_id: context.userId,
      entity_type: "task",
      entity_id: task.id,
      action: data.id ? "updated" : "created",
    });
    return task;
  });

export const deleteTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("tasks")
      .delete()
      .eq("id", data.id);
    if (error) throw toSupabaseError(error, "public.tasks");
    return { ok: true };
  });

// ---------- Campaigns ----------
export const listCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("campaigns")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw toSupabaseError(error, "public.campaigns");
    return data ?? [];
  });

export const upsertCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(200),
        subject: z.string().min(1).max(300),
        body: z.string().min(1).max(50000),
        template_id: z.string().uuid().optional(),
        status: z
          .enum(["draft", "active", "scheduled", "completed", "cancelled"])
          .optional(),
        scheduled_at: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { data: campaign, error } = await context.supabase
      .from("campaigns")
      .upsert({ ...data, owner_id: context.userId })
      .select()
      .single();
    if (error) throw toSupabaseError(error, "public.campaigns");
    return campaign;
  });

export const deleteCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("campaigns")
      .delete()
      .eq("id", data.id);
    if (error) throw toSupabaseError(error, "public.campaigns");
    return { ok: true };
  });

// ---------- Reports / Team ----------
const reportDrilldownKindSchema = z.enum([
  "emails",
  "unreadEmails",
  "leads",
  "customers",
  "reminders",
  "tasks",
  "campaigns",
  "campaignSent",
  "campaignReplies",
  "contacts",
  "templates",
]);

function formatReportDate(value: string | null | undefined) {
  if (!value) return "-";
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "-";
  return time.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatReportValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value).replace(/_/g, " ");
}

export const getReportsData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [
      emailsData,
      leadsResult,
      customersResult,
      remindersResult,
      contactsResult,
      tasksResult,
      campaignsResult,
      templatesResult,
    ] = await Promise.all([
      getEmailAnalyticsRows(context.supabase),
      context.supabase.from("leads").select("id, status, source, created_at"),
      context.supabase.from("customers").select("id, status, created_at"),
      context.supabase.from("reminders").select("id, completed_at, due_at"),
      context.supabase.from("contacts").select("id, source, created_at"),
      context.supabase.from("tasks").select("id, status, priority, created_at"),
      context.supabase
        .from("campaigns")
        .select("id, status, sent_count, reply_count, failed_count"),
      context.supabase
        .from("email_templates")
        .select("id, category, visibility, created_at"),
    ]);

    if (leadsResult.error) {
      throw toSupabaseError(leadsResult.error, "public.leads");
    }
    if (customersResult.error) {
      throw toSupabaseError(customersResult.error, "public.customers");
    }
    if (remindersResult.error) {
      throw toSupabaseError(remindersResult.error, "public.reminders");
    }
    if (
      contactsResult.error &&
      !isMissingSupabaseSchemaError(contactsResult.error)
    ) {
      throw toSupabaseError(contactsResult.error, "public.contacts");
    }
    if (tasksResult.error && !isMissingSupabaseSchemaError(tasksResult.error)) {
      throw toSupabaseError(tasksResult.error, "public.tasks");
    }
    if (
      campaignsResult.error &&
      !isMissingSupabaseSchemaError(campaignsResult.error)
    ) {
      throw toSupabaseError(campaignsResult.error, "public.campaigns");
    }
    if (templatesResult.error) {
      throw toSupabaseError(templatesResult.error, "public.email_templates");
    }

    const leadsData = leadsResult.data ?? [];
    const customersData = customersResult.data ?? [];
    const remindersData = remindersResult.data ?? [];
    const contactsData = isMissingSupabaseSchemaError(contactsResult.error)
      ? []
      : (contactsResult.data ?? []);
    const tasksData = isMissingSupabaseSchemaError(tasksResult.error)
      ? []
      : (tasksResult.data ?? []);
    const campaignsData = isMissingSupabaseSchemaError(campaignsResult.error)
      ? []
      : (campaignsResult.data ?? []);
    const templatesData = templatesResult.data ?? [];

    return {
      totals: {
        emails: emailsData.length,
        unreadEmails: emailsData.filter((email) => !email.is_read).length,
        leads: leadsData.length,
        customers: customersData.length,
        reminders: remindersData.length,
        tasks: tasksData.length,
        campaigns: campaignsData.length,
        contacts: contactsData.length,
        templates: templatesData.length,
      },
      emailsByDay: groupEmailsByDay(emailsData),
      leadsByStatus: countRowsByField(leadsData, "status"),
      customerGrowth: groupRowsByDay(customersData),
      contactsBySource: countRowsByField(contactsData, "source"),
      tasksByStatus: countRowsByField(tasksData, "status"),
      tasksByPriority: countRowsByField(tasksData, "priority"),
      campaignTotals: campaignsData.reduce(
        (acc, campaign) => {
          acc.sent += campaign.sent_count ?? 0;
          acc.replies += campaign.reply_count ?? 0;
          acc.failed += campaign.failed_count ?? 0;
          return acc;
        },
        { sent: 0, replies: 0, failed: 0 },
      ),
    };
  });

export const getReportDrilldown = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        kind: reportDrilldownKindSchema,
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    if (data.kind === "emails" || data.kind === "unreadEmails") {
      let q = context.supabase
        .from("emails")
        .select(
          "id, subject, from_email, from_name, received_at, is_read, is_sent, has_attachments",
        )
        .order("received_at", { ascending: false })
        .limit(200);
      if (data.kind === "unreadEmails") q = q.eq("is_read", false);
      const { data: rows, error } = await q;
      if (error) throw toSupabaseError(error, "public.emails");
      return {
        title: data.kind === "unreadEmails" ? "Unread emails" : "Emails",
        columns: ["Subject", "From", "Received", "Read", "Sent", "Files"],
        rows: (rows ?? []).map((row) => ({
          id: row.id,
          href: "/inbox",
          values: [
            formatReportValue(row.subject || "(no subject)"),
            formatReportValue(row.from_name || row.from_email),
            formatReportDate(row.received_at),
            formatReportValue(row.is_read),
            formatReportValue(row.is_sent),
            formatReportValue(row.has_attachments),
          ],
        })),
      };
    }

    if (data.kind === "leads") {
      const { data: rows, error } = await context.supabase
        .from("leads")
        .select("id, name, email, company, status, source, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw toSupabaseError(error, "public.leads");
      return {
        title: "Leads",
        columns: ["Name", "Email", "Company", "Status", "Source", "Created"],
        rows: (rows ?? []).map((row) => ({
          id: row.id,
          href: `/leads/${row.id}`,
          values: [
            formatReportValue(row.name || row.email),
            formatReportValue(row.email),
            formatReportValue(row.company),
            formatReportValue(row.status),
            formatReportValue(row.source),
            formatReportDate(row.created_at),
          ],
        })),
      };
    }

    if (data.kind === "customers") {
      const { data: rows, error } = await context.supabase
        .from("customers")
        .select("id, name, email, company, status, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw toSupabaseError(error, "public.customers");
      return {
        title: "Customers",
        columns: ["Name", "Email", "Company", "Status", "Created"],
        rows: (rows ?? []).map((row) => ({
          id: row.id,
          href: `/customers/${row.id}`,
          values: [
            formatReportValue(row.name || row.email),
            formatReportValue(row.email),
            formatReportValue(row.company),
            formatReportValue(row.status),
            formatReportDate(row.created_at),
          ],
        })),
      };
    }

    if (data.kind === "reminders") {
      const { data: rows, error } = await context.supabase
        .from("reminders")
        .select("id, title, type, priority, due_at, completed_at")
        .order("due_at", { ascending: true })
        .limit(200);
      if (error) throw toSupabaseError(error, "public.reminders");
      return {
        title: "Reminders",
        columns: ["Title", "Type", "Priority", "Due", "Completed"],
        rows: (rows ?? []).map((row) => ({
          id: row.id,
          href: "/reminders",
          values: [
            formatReportValue(row.title),
            formatReportValue(row.type),
            formatReportValue(row.priority),
            formatReportDate(row.due_at),
            formatReportDate(row.completed_at),
          ],
        })),
      };
    }

    if (data.kind === "tasks") {
      const { data: rows, error } = await context.supabase
        .from("tasks")
        .select("id, title, status, priority, due_at, created_at")
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(200);
      if (error) throw toSupabaseError(error, "public.tasks");
      return {
        title: "Tasks",
        columns: ["Title", "Status", "Priority", "Due", "Created"],
        rows: (rows ?? []).map((row) => ({
          id: row.id,
          href: "/tasks",
          values: [
            formatReportValue(row.title),
            formatReportValue(row.status),
            formatReportValue(row.priority),
            formatReportDate(row.due_at),
            formatReportDate(row.created_at),
          ],
        })),
      };
    }

    if (
      data.kind === "campaigns" ||
      data.kind === "campaignSent" ||
      data.kind === "campaignReplies"
    ) {
      const { data: rows, error } = await context.supabase
        .from("campaigns")
        .select(
          "id, name, status, sent_count, delivered_count, reply_count, failed_count, scheduled_at, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw toSupabaseError(error, "public.campaigns");
      const filteredRows = (rows ?? []).filter((row) => {
        if (data.kind === "campaignSent") return (row.sent_count ?? 0) > 0;
        if (data.kind === "campaignReplies") return (row.reply_count ?? 0) > 0;
        return true;
      });
      return {
        title:
          data.kind === "campaignSent"
            ? "Campaign sent"
            : data.kind === "campaignReplies"
              ? "Campaign replies"
              : "Campaigns",
        columns: [
          "Name",
          "Status",
          "Sent",
          "Delivered",
          "Replies",
          "Failed",
          "Scheduled",
        ],
        rows: filteredRows.map((row) => ({
          id: row.id,
          href: "/campaigns",
          values: [
            formatReportValue(row.name),
            formatReportValue(row.status),
            formatReportValue(row.sent_count),
            formatReportValue(row.delivered_count),
            formatReportValue(row.reply_count),
            formatReportValue(row.failed_count),
            formatReportDate(row.scheduled_at),
          ],
        })),
      };
    }

    if (data.kind === "contacts") {
      const { data: rows, error } = await context.supabase
        .from("contacts")
        .select(
          "id, full_name, email, company, source, last_contact_at, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw toSupabaseError(error, "public.contacts");
      return {
        title: "Contacts",
        columns: [
          "Name",
          "Email",
          "Company",
          "Source",
          "Last contact",
          "Created",
        ],
        rows: (rows ?? []).map((row) => ({
          id: row.id,
          href: "/contacts",
          values: [
            formatReportValue(row.full_name || row.email),
            formatReportValue(row.email),
            formatReportValue(row.company),
            formatReportValue(row.source),
            formatReportDate(row.last_contact_at),
            formatReportDate(row.created_at),
          ],
        })),
      };
    }

    const { data: rows, error } = await context.supabase
      .from("email_templates")
      .select("id, name, subject, category, visibility, updated_at")
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw toSupabaseError(error, "public.email_templates");
    return {
      title: "Templates",
      columns: ["Name", "Subject", "Category", "Visibility", "Updated"],
      rows: (rows ?? []).map((row) => ({
        id: row.id,
        href: "/templates",
        values: [
          formatReportValue(row.name),
          formatReportValue(row.subject),
          formatReportValue(row.category),
          formatReportValue(row.visibility),
          formatReportDate(row.updated_at),
        ],
      })),
    };
  });

export const listTeamMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    const { supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const client = isAdmin ? supabaseAdmin : context.supabase;
    const [{ data: roles }, { data: profiles }] = await Promise.all([
      client.from("user_roles").select("user_id, role"),
      client
        .from("profiles")
        .select("id, full_name, avatar_url, phone, created_at"),
    ]);
    const authUsers = isAdmin
      ? await supabaseAdmin.auth.admin.listUsers()
      : { data: { users: [] } };
    return (profiles ?? []).map((profile) => ({
      ...profile,
      email:
        authUsers.data.users.find((user) => user.id === profile.id)?.email ??
        null,
      roles: (roles ?? [])
        .filter((role) => role.user_id === profile.id)
        .map((role) => role.role),
    }));
  });

// ---------- Admin ----------
export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role");
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, created_at");
    const { data: users } = await supabaseAdmin.auth.admin.listUsers();
    return (users.users ?? []).map((u) => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      full_name: profiles?.find((p) => p.id === u.id)?.full_name ?? null,
      roles: (roles ?? []).filter((r) => r.user_id === u.id).map((r) => r.role),
    }));
  });

export const adminListActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { data } = await context.supabase
      .from("activity_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    return data ?? [];
  });

export const adminSetRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        user_id: z.string().uuid(),
        role: z.enum(["admin", "manager", "agent", "staff"]),
        grant: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    if (data.grant) {
      await supabaseAdmin
        .from("user_roles")
        .upsert(
          { user_id: data.user_id, role: data.role },
          { onConflict: "user_id,role" },
        );
    } else {
      await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.user_id)
        .eq("role", data.role);
    }
    return { ok: true };
  });
