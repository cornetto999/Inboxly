import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { getErrorMessage, toError } from "@/lib/errors";
import {
  countEmailFolderRows,
  getEmailFolderState,
  getEmailLabels,
  type EmailFolderStateRow,
} from "@/lib/email-folder-state";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export { EMPTY_EMAIL_FOLDER_COUNTS } from "@/lib/email-folder-state";
export type {
  EmailFolderCountKey,
  EmailFolderCounts,
} from "@/lib/email-folder-state";

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
  is_draft?: boolean | null;
  is_spam?: boolean | null;
  is_trashed?: boolean | null;
  label_ids?: string[] | null;
  labels?: string[] | null;
  has_replied?: boolean | null;
  received_at?: string | null;
  sent_at?: string | null;
  created_at?: string | null;
};

function isSentEmail(row: EmailAnalyticsRow) {
  return getEmailFolderState(row).isSent;
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

async function getEmailAnalyticsRows(context: AuthenticatedFunctionContext) {
  const selectEmails = (columns: string) =>
    context.supabase
      .from("emails")
      .select(columns)
      .eq("user_id", context.userId);

  const enhancedResult = await selectEmails(
    "is_read, is_sent, is_draft, is_spam, is_trashed, label_ids, labels, has_replied, received_at, sent_at, created_at",
  );

  if (!enhancedResult.error) {
    return (enhancedResult.data ?? []) as unknown as EmailAnalyticsRow[];
  }

  if (!isMissingSupabaseSchemaError(enhancedResult.error)) {
    throw toSupabaseError(enhancedResult.error, "public.emails");
  }

  const legacyResult = await selectEmails(
    "is_read, labels, received_at, created_at",
  );
  if (legacyResult.error) {
    throw toSupabaseError(legacyResult.error, "public.emails");
  }

  return (legacyResult.data ?? []) as unknown as EmailAnalyticsRow[];
}

function fromEmailFolderCountRpcRow(row: Record<string, unknown>) {
  return {
    all: Number(row.all_mail ?? 0),
    unread: Number(row.unread ?? 0),
    read: Number(row.read ?? 0),
    starred: Number(row.starred ?? 0),
    replied: Number(row.replied ?? 0),
    sent: Number(row.sent ?? 0),
    drafts: Number(row.drafts ?? 0),
    archived: Number(row.archived ?? 0),
    spam: Number(row.spam ?? 0),
    trash: Number(row.trash ?? 0),
  };
}

async function getEmailFolderCountsFromRpc(
  context: AuthenticatedFunctionContext,
  accountId?: string,
) {
  const rpcResult = await context.supabase.rpc("get_gmail_folder_counts_v2", {
    p_account_id: accountId ?? null,
  });
  if (!rpcResult.error) {
    const row = rpcResult.data?.[0];
    return row ? fromEmailFolderCountRpcRow(row) : null;
  }

  if (!isMissingSupabaseSchemaError(rpcResult.error)) {
    throw toSupabaseError(rpcResult.error, "public.get_gmail_folder_counts_v2");
  }

  return null;
}

async function getEmailFolderCountsFromRows(
  context: AuthenticatedFunctionContext,
  accountId?: string,
) {
  const selectEmails = (columns: string) => {
    let query = context.supabase
      .from("emails")
      .select(columns)
      .eq("user_id", context.userId);
    if (accountId) query = query.eq("account_id", accountId);
    return query;
  };

  const enhancedResult = await selectEmails(
    "id, gmail_message_id, label_ids, labels, has_replied, replied_at, is_read, is_starred, is_sent, is_draft, is_archived, is_spam, is_trashed, last_synced_at, received_at, sent_at, created_at",
  );

  if (!enhancedResult.error) {
    return countEmailFolderRows(
      (enhancedResult.data ?? []) as EmailFolderStateRow[],
    );
  }

  if (!isMissingSupabaseSchemaError(enhancedResult.error)) {
    throw toSupabaseError(enhancedResult.error, "public.emails");
  }

  const legacyResult = await selectEmails(
    "id, gmail_message_id, labels, is_read, received_at, created_at",
  );
  if (legacyResult.error) {
    throw toSupabaseError(legacyResult.error, "public.emails");
  }

  return countEmailFolderRows(
    (legacyResult.data ?? []) as EmailFolderStateRow[],
  );
}

async function getEmailFolderCountsForContext(
  context: AuthenticatedFunctionContext,
  accountId?: string,
) {
  const rpcCounts = await getEmailFolderCountsFromRpc(context, accountId);
  if (rpcCounts) return rpcCounts;

  return getEmailFolderCountsFromRows(context, accountId);
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
      emailFolderCounts,
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
      getEmailAnalyticsRows(context),
      getEmailFolderCountsForContext(context),
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
      totalEmails: emailFolderCounts.all,
      unreadEmails: emailFolderCounts.unread,
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
      emailFolderCounts,
      leadsResult,
      customersResult,
      remindersResult,
      templatesResult,
      campaignsResult,
      contactsResult,
      tasksResult,
    ] = await Promise.all([
      getEmailFolderCountsForContext(context),
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
      inbox: emailFolderCounts.unread,
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
    return getEmailFolderCountsForContext(context, data.accountId);
  });

// ---------- Email Accounts ----------
export const listEmailAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const enhanced = await context.supabase
      .from("email_accounts")
      .select(
        "id, email_address, provider, last_sync_at, last_synced_at, connection_status, last_sync_error, connected_at, created_at",
      )
      .order("created_at", { ascending: false });
    if (!enhanced.error) return enhanced.data ?? [];
    if (!isMissingSupabaseSchemaError(enhanced.error)) {
      throw toSupabaseError(enhanced.error, "public.email_accounts");
    }

    const legacy = await context.supabase
      .from("email_accounts")
      .select("id, email_address, provider, last_sync_at, created_at")
      .order("created_at", { ascending: false });
    if (legacy.error) {
      if (isMissingSupabaseSchemaError(legacy.error)) return [];
      throw toSupabaseError(legacy.error, "public.email_accounts");
    }
    return (legacy.data ?? []).map((account) => ({
      ...account,
      last_synced_at: account.last_sync_at,
      connection_status: "connected" as const,
      last_sync_error: null,
      connected_at: account.created_at,
    }));
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
    const { makeEncryptedGmailConnectionUpdate } =
      await import("./gmail-account.server");
    const incomingConnection = parseGmailConnection(data.connection_api_key);
    if (!incomingConnection.accessToken) {
      throw new Error("Google did not return a Gmail access token.");
    }

    const { data: existingAccount, error: existingError } =
      await context.supabase
        .from("email_accounts")
        .select("*")
        .eq("user_id", context.userId)
        .eq("email_address", data.email_address)
        .maybeSingle();
    if (existingError) {
      throw toSupabaseError(existingError, "public.email_accounts");
    }

    const existingConnection = existingAccount?.connection_api_key
      ? parseGmailConnection(existingAccount.connection_api_key)
      : null;
    const connection: StoredGmailConnection = {
      accessToken: incomingConnection.accessToken,
      refreshToken:
        incomingConnection.refreshToken ??
        existingConnection?.refreshToken ??
        null,
      expiresAt: incomingConnection.expiresAt ?? null,
    };

    if (!connection.refreshToken) {
      throw new Error(
        "Google did not return an offline Gmail refresh token. Reconnect Gmail again and approve all requested Gmail permissions.",
      );
    }

    const { data: membership } = await context.supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", context.userId)
      .limit(1)
      .maybeSingle();
    const tokenFields = makeEncryptedGmailConnectionUpdate(connection);
    const now = new Date().toISOString();
    const { data: account, error } = await context.supabase
      .from("email_accounts")
      .upsert(
        {
          user_id: context.userId,
          organization_id: membership?.organization_id ?? null,
          provider: "gmail",
          email_address: data.email_address,
          ...tokenFields,
          connection_status: "connected",
          last_sync_error: null,
          connected_at: now,
        },
        { onConflict: "user_id,email_address" },
      )
      .select(
        "id, email_address, provider, last_sync_at, last_synced_at, connection_status, last_sync_error, connected_at, created_at",
      )
      .single();
    if (error) {
      if (!isMissingSupabaseSchemaError(error)) {
        throw toSupabaseError(error, "public.email_accounts");
      }
      const legacyResult = await context.supabase
        .from("email_accounts")
        .upsert(
          {
            user_id: context.userId,
            provider: "gmail",
            email_address: data.email_address,
            connection_api_key: JSON.stringify(connection),
          },
          { onConflict: "user_id,email_address" },
        )
        .select("id, email_address, provider, last_sync_at, created_at")
        .single();
      if (legacyResult.error) {
        throw toSupabaseError(legacyResult.error, "public.email_accounts");
      }
      return {
        ...legacyResult.data,
        last_synced_at: legacyResult.data.last_sync_at,
        connection_status: "connected" as const,
        last_sync_error: null,
        connected_at: legacyResult.data.created_at,
      };
    }
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
  legacyId?: string;
  filename: string;
  mimeType: string;
  size: number;
  contentId?: string;
  isInline: boolean;
};

type GmailAttachmentPart = GmailAttachmentSummary & {
  path: string;
  partId?: string;
  gmailAttachmentId?: string;
  contentId?: string;
  data?: string;
};

function normalizeAttachmentContentId(value: string) {
  return value.trim().replace(/^<|>$/g, "");
}

function makeAttachmentId({
  path,
  partId,
  filename,
  mimeType,
  size,
  contentId,
}: {
  path: string;
  partId?: string;
  filename: string;
  mimeType: string;
  size: number;
  contentId?: string;
}) {
  return [
    "part",
    partId || path,
    filename,
    mimeType,
    String(size),
    contentId || "",
  ]
    .map((value) => encodeURIComponent(value))
    .join(":");
}

function collectGmailAttachments(
  payload: GmailPayload | undefined,
): GmailAttachmentPart[] {
  const attachments: GmailAttachmentPart[] = [];

  const walk = (part: GmailPayload | undefined, path: string) => {
    if (!part) return;
    const filename = part.filename?.trim() ?? "";
    const disposition = getHeader(part.headers, "Content-Disposition");
    const body = part.body;
    const contentId = normalizeAttachmentContentId(
      getHeader(part.headers, "Content-ID"),
    );
    const hasAttachmentContent = Boolean(body?.attachmentId || body?.data);
    const looksLikeAttachment =
      hasAttachmentContent &&
      Boolean(
        filename ||
        contentId ||
        disposition.toLowerCase().includes("attachment") ||
        disposition.toLowerCase().includes("inline"),
      );

    if (looksLikeAttachment) {
      const attachmentId = body?.attachmentId;
      const mimeType = part.mimeType ?? "application/octet-stream";
      const size = body?.size ?? 0;
      const isInline =
        Boolean(contentId) || disposition.toLowerCase().includes("inline");
      const resolvedFilename =
        filename ||
        `attachment-${attachments.length + 1}.${mimeType.split("/").pop()}`;
      attachments.push({
        id: makeAttachmentId({
          path,
          partId: part.partId,
          filename: resolvedFilename,
          mimeType,
          size,
          contentId,
        }),
        legacyId: attachmentId
          ? `gmail:${attachmentId}`
          : `part:${part.partId ?? path}`,
        path,
        partId: part.partId,
        gmailAttachmentId: attachmentId,
        contentId,
        isInline,
        data: body?.data,
        filename: resolvedFilename,
        mimeType,
        size,
      });
    }

    part.parts?.forEach((child, index) => walk(child, `${path}.${index}`));
  };

  walk(payload, "0");
  return attachments;
}

function findGmailAttachment(
  attachments: GmailAttachmentPart[],
  lookup: {
    attachmentId: string;
    filename?: string;
    mimeType?: string;
    size?: number;
  },
) {
  const exact = attachments.find((candidate) => {
    if (candidate.id === lookup.attachmentId) return true;
    if (candidate.legacyId === lookup.attachmentId) return true;
    if (candidate.gmailAttachmentId === lookup.attachmentId) return true;
    if (candidate.gmailAttachmentId) {
      return `gmail:${candidate.gmailAttachmentId}` === lookup.attachmentId;
    }
    return false;
  });
  if (exact) return exact;

  if (!lookup.filename && !lookup.mimeType) return undefined;

  return attachments.find((candidate) => {
    const filenameMatches =
      !lookup.filename || candidate.filename === lookup.filename;
    const mimeMatches =
      !lookup.mimeType || candidate.mimeType === lookup.mimeType;
    const sizeMatches =
      lookup.size == null ||
      lookup.size === 0 ||
      candidate.size === 0 ||
      candidate.size === lookup.size;

    return filenameMatches && mimeMatches && sizeMatches;
  });
}

function getGmailStatusFields(labelIds: string[], payload?: GmailPayload) {
  const hasLabel = (label: string) => labelIds.includes(label);
  const isSpam = hasLabel("SPAM");
  const isTrashed = hasLabel("TRASH");

  return {
    is_read: !hasLabel("UNREAD"),
    is_starred: hasLabel("STARRED"),
    is_archived: !hasLabel("INBOX") && !isSpam && !isTrashed,
    is_sent: hasLabel("SENT"),
    is_draft: hasLabel("DRAFT"),
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

function getCurrentLabelIds(email: { label_ids?: unknown; labels?: unknown }) {
  return getEmailLabels(email);
}

function getEmailLabelUpdate(
  email: { label_ids?: unknown; labels?: unknown },
  addLabelIds: string[] = [],
  removeLabelIds: string[] = [],
) {
  const labels = updateLocalLabels(
    getCurrentLabelIds(email),
    addLabelIds,
    removeLabelIds,
  );
  return getEmailLabelUpdateFromLabels(labels);
}

function getEmailLabelUpdateFromLabels(
  labels: string[],
  options: { historyId?: string | null; payload?: GmailPayload } = {},
) {
  const statusFields = getGmailStatusFields(labels, options.payload);

  return {
    ...statusFields,
    labels,
    label_ids: labels,
    ...(options.historyId ? { gmail_history_id: options.historyId } : {}),
    last_synced_at: new Date().toISOString(),
  };
}

type EmailLabelUpdatePayload = ReturnType<typeof getEmailLabelUpdate>;

function getLegacyEmailLabelUpdate(update: EmailLabelUpdatePayload) {
  return {
    is_read: update.is_read,
    is_starred: update.is_starred,
    is_archived: update.is_archived,
    is_sent: update.is_sent,
    is_draft: update.is_draft,
    is_spam: update.is_spam,
    is_trashed: update.is_trashed,
    has_attachments: update.has_attachments,
    labels: update.labels,
  };
}

async function updateEmailLabelState(
  context: AuthenticatedFunctionContext,
  emailId: string,
  update: EmailLabelUpdatePayload,
) {
  let { error } = await context.supabase
    .from("emails")
    .update(update)
    .eq("id", emailId);

  if (error && isMissingSupabaseSchemaError(error)) {
    const legacyUpdate = getLegacyEmailLabelUpdate(update);
    const legacyResult = await context.supabase
      .from("emails")
      .update(legacyUpdate)
      .eq("id", emailId);
    error = legacyResult.error;
  }

  if (error) throw toSupabaseError(error, "public.emails");
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
type EmailRow = Database["public"]["Tables"]["emails"]["Row"];

function parseGmailConnection(connectionApiKey: string): StoredGmailConnection {
  try {
    const parsed = JSON.parse(connectionApiKey) as StoredGmailConnection;
    if (parsed.accessToken) return parsed;
  } catch {
    // Older saved rows may contain a raw token string.
  }

  return { accessToken: connectionApiKey };
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
  const { getGmailAccessTokenForAccount } =
    await import("./gmail-account.server");
  return getGmailAccessTokenForAccount({
    supabase: context.supabase,
    account,
    forceRefresh,
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientGmailStatus(status: number) {
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

async function markGmailReconnectRequired({
  context,
  account,
  reason,
}: {
  context: AuthenticatedFunctionContext;
  account: EmailAccountRow;
  reason: string;
}) {
  const { error } = await context.supabase
    .from("email_accounts")
    .update({
      connection_status: "reauthentication_required",
      last_sync_error: reason,
    })
    .eq("id", account.id);

  if (error && !isMissingSupabaseSchemaError(error)) {
    console.warn("Unable to update Gmail reconnect state.", error);
  }

  Object.assign(account, {
    connection_status: "reauthentication_required",
    last_sync_error: reason,
  });
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
  for (const delayMs of [250, 750]) {
    if (!isTransientGmailStatus(response.status)) break;
    await sleep(delayMs);
    response = await makeRequest(accessToken);
  }
  if (response.status === 401 || response.status === 403) {
    await markGmailReconnectRequired({
      context,
      account,
      reason: `Gmail authorization failed while calling ${normalizedPath}. Reconnect Gmail in Settings.`,
    });
  }
  return response;
}

type GmailMessageSummary = {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  historyId?: string;
};

async function fetchGmailMessageSummary({
  context,
  account,
  gmailMessageId,
}: {
  context: AuthenticatedFunctionContext;
  account: EmailAccountRow;
  gmailMessageId: string;
}) {
  const res = await callGmailApi({
    context,
    account,
    path: `/gmail/v1/users/me/messages/${encodeURIComponent(
      gmailMessageId,
    )}?format=minimal`,
  });
  if (!res.ok) await throwGmailError("message refresh", res);
  return (await res.json()) as GmailMessageSummary;
}

function getFreshEmailLabelUpdate(
  email: { label_ids?: unknown; labels?: unknown },
  gmailMessage: GmailMessageSummary | null | undefined,
  addLabelIds: string[] = [],
  removeLabelIds: string[] = [],
) {
  const labels = updateLocalLabels(
    getCurrentLabelIds(email),
    addLabelIds,
    removeLabelIds,
  );
  return getEmailLabelUpdateFromLabels(labels, {
    historyId: gmailMessage?.historyId,
  });
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
  if (!email.gmail_message_id) return { email, account, gmailMessage: null };

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
  const gmailMessage = (await res
    .json()
    .catch(() => null)) as GmailMessageSummary | null;
  return { email, account, gmailMessage };
}

async function trashGmailMessage({
  context,
  emailId,
}: {
  context: AuthenticatedFunctionContext;
  emailId: string;
}) {
  const { email, account } = await getEmailAndAccount(context, emailId);
  if (!email.gmail_message_id) return { email, account, gmailMessage: null };

  const res = await callGmailApi({
    context,
    account,
    path: `/gmail/v1/users/me/messages/${email.gmail_message_id}/trash`,
    init: { method: "POST" },
  });
  if (!res.ok) await throwGmailError("trash", res);
  const gmailMessage = (await res
    .json()
    .catch(() => null)) as GmailMessageSummary | null;
  return { email, account, gmailMessage };
}

async function persistEmailAttachments({
  context,
  account,
  emailId,
  gmailMessageId,
  payload,
}: {
  context: AuthenticatedFunctionContext;
  account: EmailAccountRow;
  emailId: string;
  gmailMessageId: string;
  payload?: GmailPayload;
}) {
  const accountWithOrganization = account as EmailAccountRow & {
    organization_id?: string | null;
  };
  const attachments = collectGmailAttachments(payload);
  if (attachments.length === 0) return [];

  const rows = attachments.map((attachment) => ({
    organization_id: accountWithOrganization.organization_id ?? null,
    email_account_id: account.id,
    email_id: emailId,
    gmail_message_id: gmailMessageId,
    gmail_attachment_id: attachment.gmailAttachmentId ?? null,
    gmail_part_id: attachment.partId || attachment.path,
    filename: attachment.filename,
    mime_type: attachment.mimeType,
    size_bytes: attachment.size,
    content_id: attachment.contentId || null,
    is_inline: attachment.isInline,
    storage_path: null,
    body_data: attachment.data ?? null,
  }));
  const { error } = await context.supabase
    .from("email_attachments")
    .upsert(rows, { onConflict: "email_id,gmail_part_id,filename" });
  if (error && !isMissingSupabaseSchemaError(error)) {
    throw toSupabaseError(error, "public.email_attachments");
  }
  return attachments;
}

type ThreadEmailRow = {
  id: string;
  gmail_message_id: string;
  gmail_thread_id: string | null;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  snippet: string | null;
  received_at: string;
  sent_at?: string | null;
  is_sent?: boolean | null;
  is_trashed?: boolean | null;
  is_spam?: boolean | null;
  label_ids?: string[] | null;
  labels?: string[] | null;
};

async function upsertEmailThread({
  context,
  account,
  gmailThreadId,
  repliedByUserId,
}: {
  context: AuthenticatedFunctionContext;
  account: EmailAccountRow;
  gmailThreadId: string;
  repliedByUserId?: string | null;
}) {
  const { data, error } = await context.supabase
    .from("emails")
    .select(
      "id, gmail_message_id, gmail_thread_id, from_email, from_name, subject, snippet, received_at, sent_at, is_sent, is_spam, is_trashed, label_ids, labels",
    )
    .eq("account_id", account.id)
    .eq("gmail_thread_id", gmailThreadId)
    .order("received_at", { ascending: true });
  if (error) throw toSupabaseError(error, "public.emails");

  const allMessages = (data ?? []) as ThreadEmailRow[];
  const messages = allMessages.filter(
    (message) =>
      !getEmailFolderState(message).isSpam &&
      !getEmailFolderState(message).isTrashed,
  );
  if (messages.length === 0) {
    const { error: deleteError } = await context.supabase
      .from("email_threads")
      .delete()
      .eq("email_account_id", account.id)
      .eq("gmail_thread_id", gmailThreadId);
    if (deleteError && !isMissingSupabaseSchemaError(deleteError)) {
      throw toSupabaseError(deleteError, "public.email_threads");
    }
    return;
  }

  const accountAddress = account.email_address.toLowerCase();
  const isOutgoing = (message: ThreadEmailRow) => {
    return (
      getEmailLabels(message).some((label) => label.toUpperCase() === "SENT") &&
      message.from_email.toLowerCase() === accountAddress
    );
  };
  const firstIncoming = messages.find((message) => !isOutgoing(message));
  const incomingAt = firstIncoming
    ? new Date(firstIncoming.received_at).getTime()
    : Number.POSITIVE_INFINITY;
  const replies = messages.filter((message) => {
    const timestamp = new Date(
      message.sent_at ?? message.received_at,
    ).getTime();
    return isOutgoing(message) && timestamp > incomingAt;
  });
  const lastReply = replies.at(-1);
  const latest = messages.at(-1)!;
  const accountWithOrganization = account as EmailAccountRow & {
    organization_id?: string | null;
  };
  const { error: threadError } = await context.supabase
    .from("email_threads")
    .upsert(
      {
        organization_id: accountWithOrganization.organization_id ?? null,
        email_account_id: account.id,
        gmail_thread_id: gmailThreadId,
        representative_email_id: firstIncoming?.id ?? messages[0].id,
        has_reply: Boolean(firstIncoming && lastReply),
        last_replied_at: lastReply
          ? (lastReply.sent_at ?? lastReply.received_at)
          : null,
        last_reply_message_id: lastReply?.gmail_message_id ?? null,
        replied_by_user_id:
          firstIncoming && lastReply
            ? (repliedByUserId ?? account.user_id)
            : null,
        original_sender_email:
          firstIncoming?.from_email ?? messages[0].from_email,
        original_sender_name: firstIncoming?.from_name ?? messages[0].from_name,
        latest_subject: latest.subject,
        original_preview: firstIncoming?.snippet ?? messages[0].snippet,
        message_count: messages.length,
        latest_message_at: latest.sent_at ?? latest.received_at,
      },
      { onConflict: "email_account_id,gmail_thread_id" },
    );
  if (threadError && !isMissingSupabaseSchemaError(threadError)) {
    throw toSupabaseError(threadError, "public.email_threads");
  }

  await Promise.all(
    allMessages.map(async (message) => {
      const state = getEmailFolderState(message);
      const messageAt = new Date(
        message.sent_at ?? message.received_at,
      ).getTime();
      const reply = allMessages.find((candidate) => {
        const candidateState = getEmailFolderState(candidate);
        if (
          candidateState.isSpam ||
          candidateState.isTrashed ||
          !isOutgoing(candidate)
        ) {
          return false;
        }
        const candidateAt = new Date(
          candidate.sent_at ?? candidate.received_at,
        ).getTime();
        return candidateAt > messageAt;
      });
      const hasReplied =
        !isOutgoing(message) &&
        !state.isSpam &&
        !state.isTrashed &&
        Boolean(reply);
      const { error: updateError } = await context.supabase
        .from("emails")
        .update({
          has_replied: hasReplied,
          replied_at: reply ? (reply.sent_at ?? reply.received_at) : null,
        })
        .eq("id", message.id);
      if (updateError && !isMissingSupabaseSchemaError(updateError)) {
        throw toSupabaseError(updateError, "public.emails");
      }
    }),
  );
}

export const syncGmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        accountId: z.string().uuid(),
        maxResults: z.number().min(1).max(100).optional(),
        forceTokenRefresh: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { data: accountData, error: accErr } = await context.supabase
      .from("email_accounts")
      .select("*")
      .eq("id", data.accountId)
      .single();
    if (accErr || !accountData) throw new Error("Account not found");
    const account = accountData as EmailAccountRow;

    await context.supabase
      .from("email_accounts")
      .update({ connection_status: "syncing", last_sync_error: null })
      .eq("id", account.id);

    try {
      const enhancedSchemaResult = await context.supabase
        .from("emails")
        .select("label_ids, has_replied, replied_at, last_synced_at")
        .limit(1);
      const supportsEnhancedEmailSchema = !enhancedSchemaResult.error;
      if (
        enhancedSchemaResult.error &&
        !isMissingSupabaseSchemaError(enhancedSchemaResult.error)
      ) {
        throw toSupabaseError(enhancedSchemaResult.error, "public.emails");
      }
      const gmailHistorySchemaResult = await context.supabase
        .from("emails")
        .select("gmail_history_id")
        .limit(1);
      const supportsGmailHistoryIdColumn = !gmailHistorySchemaResult.error;
      if (
        gmailHistorySchemaResult.error &&
        !isMissingSupabaseSchemaError(gmailHistorySchemaResult.error)
      ) {
        throw toSupabaseError(gmailHistorySchemaResult.error, "public.emails");
      }

      if (data.forceTokenRefresh) {
        await getGmailAccessToken({
          context,
          account,
          forceRefresh: true,
        });
      }

      const maxResults = data.maxResults ?? 100;
      let latestHistoryId = account.history_id ?? null;
      const listMessageIds = async (path: string) => {
        const listRes = await callGmailApi({
          context,
          account,
          path,
        });
        if (!listRes.ok) await throwGmailError("list", listRes);
        const listJson = (await listRes.json()) as {
          messages?: { id: string }[];
        };
        return (listJson.messages ?? []).map((m) => m.id);
      };
      const listHistoryMessageIds = async () => {
        if (!account.history_id) return [];

        const messageIds = new Set<string>();
        let pageToken: string | undefined;
        do {
          const search = new URLSearchParams({
            startHistoryId: account.history_id,
            maxResults: "500",
          });
          search.append("historyTypes", "messageAdded");
          search.append("historyTypes", "labelAdded");
          search.append("historyTypes", "labelRemoved");
          if (pageToken) search.set("pageToken", pageToken);

          const historyRes = await callGmailApi({
            context,
            account,
            path: `/gmail/v1/users/me/history?${search.toString()}`,
          });
          if (historyRes.status === 404) return [];
          if (!historyRes.ok) await throwGmailError("history", historyRes);

          const historyJson = (await historyRes.json()) as {
            historyId?: string;
            nextPageToken?: string;
            history?: {
              messages?: { id?: string }[];
              messagesAdded?: { message?: { id?: string } }[];
              labelsAdded?: { message?: { id?: string } }[];
              labelsRemoved?: { message?: { id?: string } }[];
            }[];
          };
          if (historyJson.historyId) latestHistoryId = historyJson.historyId;
          for (const entry of historyJson.history ?? []) {
            for (const message of entry.messages ?? []) {
              if (message.id) messageIds.add(message.id);
            }
            for (const change of [
              ...(entry.messagesAdded ?? []),
              ...(entry.labelsAdded ?? []),
              ...(entry.labelsRemoved ?? []),
            ]) {
              if (change.message?.id) messageIds.add(change.message.id);
            }
          }
          pageToken = historyJson.nextPageToken;
        } while (pageToken);

        return Array.from(messageIds);
      };
      const [normalMessageIds, spamTrashMessageIds, historyMessageIds] =
        await Promise.all([
          listMessageIds(
            `/gmail/v1/users/me/messages?maxResults=${maxResults}`,
          ),
          listMessageIds(
            `/gmail/v1/users/me/messages?maxResults=${maxResults}&includeSpamTrash=true&q=${encodeURIComponent("{in:spam in:trash}")}`,
          ),
          listHistoryMessageIds(),
        ]);
      const messageIds = Array.from(
        new Set([
          ...normalMessageIds,
          ...spamTrashMessageIds,
          ...historyMessageIds,
        ]),
      );

      let imported = 0;
      let updated = 0;
      const touchedThreadIds = new Set<string>();
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
          historyId?: string;
          payload?: GmailPayload;
        };
        if (msg.historyId) latestHistoryId = msg.historyId;
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
        const lastSyncedAt = new Date().toISOString();

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
              label_ids: labelIds,
              last_synced_at: lastSyncedAt,
              sent_at: statusFields.is_sent ? receivedAt : null,
              is_starred: statusFields.is_starred,
              is_archived: statusFields.is_archived,
              is_sent: statusFields.is_sent,
              is_draft: statusFields.is_draft,
              is_spam: statusFields.is_spam,
              is_trashed: statusFields.is_trashed,
              has_attachments: statusFields.has_attachments,
              ...(supportsGmailHistoryIdColumn
                ? { gmail_history_id: msg.historyId ?? null }
                : {}),
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

        let emailId: string;
        if (existing) {
          const { error: updateError } = await context.supabase
            .from("emails")
            .update(enhancedEmailFields)
            .eq("id", existing.id);
          if (updateError) {
            throw toSupabaseError(updateError, "public.emails");
          }
          emailId = existing.id;
          updated++;
        } else {
          const legacyEmailRow = {
            user_id: context.userId,
            account_id: account.id,
            gmail_message_id: msg.id,
            ...legacyEmailFields,
          };
          const emailRow = supportsEnhancedEmailSchema
            ? {
                ...legacyEmailRow,
                label_ids: labelIds,
                last_synced_at: lastSyncedAt,
                sent_at: statusFields.is_sent ? receivedAt : null,
                is_starred: statusFields.is_starred,
                is_archived: statusFields.is_archived,
                is_sent: statusFields.is_sent,
                is_draft: statusFields.is_draft,
                is_spam: statusFields.is_spam,
                is_trashed: statusFields.is_trashed,
                has_attachments: statusFields.has_attachments,
                ...(supportsGmailHistoryIdColumn
                  ? { gmail_history_id: msg.historyId ?? null }
                  : {}),
              }
            : legacyEmailRow;
          const { data: inserted, error: insertError } = await context.supabase
            .from("emails")
            .upsert(emailRow, { onConflict: "account_id,gmail_message_id" })
            .select("id")
            .single();
          if (insertError || !inserted) {
            throw toSupabaseError(insertError, "public.emails");
          }
          emailId = inserted.id;
          imported++;
        }

        await persistEmailAttachments({
          context,
          account,
          emailId,
          gmailMessageId: msg.id,
          payload: msg.payload,
        });
        if (msg.threadId) touchedThreadIds.add(msg.threadId);
      }

      for (const gmailThreadId of touchedThreadIds) {
        await upsertEmailThread({
          context,
          account,
          gmailThreadId,
        });
      }

      const syncedAt = new Date().toISOString();
      let { error: updateErr } = await context.supabase
        .from("email_accounts")
        .update({
          last_sync_at: syncedAt,
          last_synced_at: syncedAt,
          ...(latestHistoryId ? { history_id: latestHistoryId } : {}),
          connection_status: "connected",
          last_sync_error: null,
        })
        .eq("id", account.id);
      if (updateErr && isMissingSupabaseSchemaError(updateErr)) {
        const legacyUpdate = await context.supabase
          .from("email_accounts")
          .update({ last_sync_at: syncedAt })
          .eq("id", account.id);
        updateErr = legacyUpdate.error;
      }
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
    } catch (error) {
      const message = getErrorMessage(error, "Gmail synchronization failed.");
      const reconnectRequired =
        message.includes("authorization expired") ||
        message.includes("Reconnect Gmail");
      await context.supabase
        .from("email_accounts")
        .update({
          connection_status: reconnectRequired
            ? "reauthentication_required"
            : "sync_failed",
          last_sync_error: message.slice(0, 1000),
        })
        .eq("id", account.id);
      throw error;
    }
  });

export const listEmailAttachments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ emailId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { email, account } = await getEmailAndAccount(context, data.emailId);
    if (!email.gmail_message_id) return [];

    const readRows = () =>
      context.supabase
        .from("email_attachments")
        .select("id, filename, mime_type, size_bytes, content_id, is_inline")
        .eq("email_id", email.id)
        .order("created_at", { ascending: true });
    let stored = await readRows();
    if (stored.error && !isMissingSupabaseSchemaError(stored.error)) {
      throw toSupabaseError(stored.error, "public.email_attachments");
    }
    if (stored.error) {
      throw toSupabaseError(stored.error, "public.email_attachments");
    }
    if ((stored.data ?? []).length > 0) {
      return (stored.data ?? []).map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mime_type,
        size: Number(attachment.size_bytes ?? 0),
        contentId: attachment.content_id,
        isInline: attachment.is_inline,
      }));
    }

    const res = await callGmailApi({
      context,
      account,
      path: `/gmail/v1/users/me/messages/${email.gmail_message_id}?format=full`,
    });
    if (!res.ok) await throwGmailError("attachment list", res);

    const msg = (await res.json()) as { payload?: GmailPayload };
    await persistEmailAttachments({
      context,
      account,
      emailId: email.id,
      gmailMessageId: email.gmail_message_id,
      payload: msg.payload,
    });
    stored = await readRows();
    if (stored.error) {
      throw toSupabaseError(stored.error, "public.email_attachments");
    }
    return (stored.data ?? []).map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mime_type,
      size: Number(attachment.size_bytes ?? 0),
      contentId: attachment.content_id,
      isInline: attachment.is_inline,
    }));
  });

export const getEmailAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        emailId: z.string().uuid(),
        attachmentId: z.string().min(1),
        filename: z.string().optional(),
        mimeType: z.string().optional(),
        size: z.number().optional(),
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
    const attachment = findGmailAttachment(
      collectGmailAttachments(msg.payload),
      {
        attachmentId: data.attachmentId,
        filename: data.filename,
        mimeType: data.mimeType,
        size: data.size,
      },
    );
    if (!attachment) throw new Error("Attachment not found.");

    let encodedData = attachment.data;
    let size = attachment.size;
    if (attachment.gmailAttachmentId) {
      const attachmentRes = await callGmailApi({
        context,
        account,
        path: `/gmail/v1/users/me/messages/${email.gmail_message_id}/attachments/${encodeURIComponent(
          attachment.gmailAttachmentId,
        )}`,
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
      historyId?: string;
    };
    const sentMessage = sent.id
      ? await fetchGmailMessageSummary({
          context,
          account,
          gmailMessageId: sent.id,
        })
      : null;
    const sentLabelIds = sentMessage?.labelIds ?? sent.labelIds ?? ["SENT"];
    const sentHistoryId = sentMessage?.historyId ?? sent.historyId;
    const sentAt = new Date().toISOString();

    const sentEmailRow = {
      user_id: context.userId,
      account_id: account.id,
      gmail_message_id: sent.id ?? crypto.randomUUID(),
      gmail_thread_id:
        sentMessage?.threadId ?? sent.threadId ?? data.threadId ?? null,
      from_email: account.email_address,
      from_name: account.email_address,
      to_emails: [data.to],
      subject: data.subject,
      snippet: data.body.replace(/<[^>]*>/g, " ").slice(0, 200),
      body_html: data.body,
      body_text: data.body.replace(/<[^>]*>/g, " "),
      received_at: sentAt,
      sent_at: sentAt,
      ...getEmailLabelUpdateFromLabels(sentLabelIds, {
        historyId: sentHistoryId,
      }),
    };
    let sentInsertResult = await context.supabase
      .from("emails")
      .upsert(sentEmailRow, { onConflict: "account_id,gmail_message_id" })
      .select("id")
      .maybeSingle();

    if (
      sentInsertResult.error &&
      isMissingSupabaseSchemaError(sentInsertResult.error)
    ) {
      const { gmail_history_id: _gmailHistoryId, ...fallbackSentEmailRow } =
        sentEmailRow;
      sentInsertResult = await context.supabase
        .from("emails")
        .upsert(fallbackSentEmailRow, {
          onConflict: "account_id,gmail_message_id",
        })
        .select("id")
        .maybeSingle();
    }
    if (sentInsertResult.error) {
      throw toSupabaseError(sentInsertResult.error, "public.emails");
    }
    const insertedEmail = sentInsertResult.data;

    if (sentHistoryId) {
      await context.supabase
        .from("email_accounts")
        .update({ history_id: sentHistoryId })
        .eq("id", account.id);
    }

    const repliedThreadId =
      sentMessage?.threadId ?? sent.threadId ?? data.threadId;
    if (repliedThreadId) {
      await upsertEmailThread({
        context,
        account,
        gmailThreadId: repliedThreadId,
        repliedByUserId: context.userId,
      });
    }

    await context.supabase.from("activity_logs").insert({
      actor_id: context.userId,
      entity_type: "email",
      entity_id: insertedEmail?.id ?? data.inReplyToEmailId ?? null,
      action: "reply_sent",
      metadata: { to: data.to, subject: data.subject },
    });
    return { ok: true, threadId: repliedThreadId ?? null };
  });

// ---------- Emails ----------
const EMAIL_LIST_SELECT_COLUMNS = [
  "id",
  "user_id",
  "account_id",
  "gmail_message_id",
  "gmail_thread_id",
  "from_email",
  "from_name",
  "to_emails",
  "cc_emails",
  "subject",
  "snippet",
  "received_at",
  "sent_at",
  "created_at",
  "labels",
  "label_ids",
  "last_synced_at",
  "is_read",
  "is_starred",
  "is_archived",
  "is_sent",
  "is_draft",
  "is_spam",
  "is_trashed",
  "has_replied",
  "replied_at",
  "lead_id",
  "customer_id",
].join(", ");

const EMAIL_LIST_SCAN_LIMIT = 1000;
const EMAIL_LIST_DISPLAY_LIMIT = 200;

function withEmailListBodyPlaceholders(rows: Partial<EmailRow>[] | null) {
  return (rows ?? []).map((row) => ({
    ...row,
    body_html: null,
    body_text: null,
  })) as EmailRow[];
}

function getEmailListTimestamp(
  row: Partial<EmailRow>,
  status?: EmailFolderCountKey,
) {
  const value =
    status === "replied"
      ? (row.replied_at ?? row.sent_at ?? row.received_at ?? row.created_at)
      : status === "sent"
        ? (row.sent_at ?? row.received_at ?? row.created_at)
        : (row.received_at ?? row.sent_at ?? row.created_at);
  return value ? new Date(value).getTime() : 0;
}

function dedupeEmailListRows(rows: EmailRow[]) {
  const latestByMessageId = new Map<string, EmailRow>();

  for (const row of rows) {
    const key = row.gmail_message_id || row.id;
    const current = latestByMessageId.get(key);
    if (
      !current ||
      getEmailListTimestamp(row) > getEmailListTimestamp(current)
    ) {
      latestByMessageId.set(key, row);
    }
  }

  return Array.from(latestByMessageId.values());
}

function emailRowMatchesStatus(row: EmailRow, status?: EmailFolderCountKey) {
  const state = getEmailFolderState(row);
  if (status === "unread") return state.isUnread;
  if (status === "read") return state.isRead;
  if (status === "starred") return state.isStarred;
  if (status === "replied") return state.isReplied;
  if (status === "sent") return state.isSent;
  if (status === "drafts") return state.isDraft;
  if (status === "archived") return state.isArchived;
  if (status === "spam") return state.isSpam;
  if (status === "trash") return state.isTrashed;
  return state.isAllMail;
}

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
            "replied",
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
      .select(EMAIL_LIST_SELECT_COLUMNS)
      .eq("user_id", context.userId)
      .order("received_at", { ascending: false })
      .limit(EMAIL_LIST_SCAN_LIMIT);
    if (data.search)
      q = q.or(
        `subject.ilike.%${data.search}%,from_email.ilike.%${data.search}%,from_name.ilike.%${data.search}%`,
      );
    const { data: rows, error } = await q;
    if (error) throw toSupabaseError(error, "public.emails");

    const status = data.status ?? "all";
    const fromDate = data.fromDate ? new Date(data.fromDate).getTime() : null;
    const filteredRows = dedupeEmailListRows((rows ?? []) as EmailRow[])
      .filter((row) => emailRowMatchesStatus(row, status))
      .filter(
        (row) =>
          fromDate == null || getEmailListTimestamp(row, status) >= fromDate,
      )
      .sort(
        (left, right) =>
          getEmailListTimestamp(right, status) -
          getEmailListTimestamp(left, status),
      )
      .slice(0, EMAIL_LIST_DISPLAY_LIMIT);

    return withEmailListBodyPlaceholders(filteredRows);
  });

export const getEmailThread = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ emailId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { email } = await getEmailAndAccount(context, data.emailId);
    if (!email.gmail_thread_id) return [email];
    const { data: messages, error } = await context.supabase
      .from("emails")
      .select("*")
      .eq("account_id", email.account_id)
      .eq("gmail_thread_id", email.gmail_thread_id)
      .order("received_at", { ascending: true });
    if (error) throw toSupabaseError(error, "public.emails");
    return messages ?? [];
  });

export const markEmailRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), isRead: z.boolean() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const addLabelIds = data.isRead ? [] : ["UNREAD"];
    const removeLabelIds = data.isRead ? ["UNREAD"] : [];
    const { email, gmailMessage } = await modifyGmailLabels({
      context,
      emailId: data.id,
      addLabelIds,
      removeLabelIds,
    });
    await updateEmailLabelState(
      context,
      data.id,
      getFreshEmailLabelUpdate(
        email,
        gmailMessage,
        addLabelIds,
        removeLabelIds,
      ),
    );
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
    const addLabelIds = data.isStarred ? ["STARRED"] : [];
    const removeLabelIds = data.isStarred ? [] : ["STARRED"];
    const { email, gmailMessage } = await modifyGmailLabels({
      context,
      emailId: data.id,
      addLabelIds,
      removeLabelIds,
    });
    await updateEmailLabelState(
      context,
      data.id,
      getFreshEmailLabelUpdate(
        email,
        gmailMessage,
        addLabelIds,
        removeLabelIds,
      ),
    );
    return { ok: true };
  });

export const archiveEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const removeLabelIds = ["INBOX"];
    const { email, gmailMessage } = await modifyGmailLabels({
      context,
      emailId: data.id,
      removeLabelIds,
    });
    await updateEmailLabelState(
      context,
      data.id,
      getFreshEmailLabelUpdate(email, gmailMessage, [], removeLabelIds),
    );
    return { ok: true };
  });

export const trashEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { email, account, gmailMessage } = await trashGmailMessage({
      context,
      emailId: data.id,
    });
    await updateEmailLabelState(
      context,
      data.id,
      getFreshEmailLabelUpdate(email, gmailMessage, ["TRASH"], ["INBOX"]),
    );
    if (email.gmail_thread_id) {
      await upsertEmailThread({
        context,
        account,
        gmailThreadId: email.gmail_thread_id,
      });
    }
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
        const removeLabelIds = ["UNREAD"];
        const { email, gmailMessage } = await modifyGmailLabels({
          context,
          emailId: id,
          removeLabelIds,
        });
        await updateEmailLabelState(
          context,
          id,
          getFreshEmailLabelUpdate(email, gmailMessage, [], removeLabelIds),
        );
      }
      if (data.action === "mark_unread") {
        const addLabelIds = ["UNREAD"];
        const { email, gmailMessage } = await modifyGmailLabels({
          context,
          emailId: id,
          addLabelIds,
        });
        await updateEmailLabelState(
          context,
          id,
          getFreshEmailLabelUpdate(email, gmailMessage, addLabelIds),
        );
      }
      if (data.action === "archive") {
        const removeLabelIds = ["INBOX"];
        const { email, gmailMessage } = await modifyGmailLabels({
          context,
          emailId: id,
          removeLabelIds,
        });
        await updateEmailLabelState(
          context,
          id,
          getFreshEmailLabelUpdate(email, gmailMessage, [], removeLabelIds),
        );
      }
      if (data.action === "star" || data.action === "unstar") {
        const isStarred = data.action === "star";
        const addLabelIds = isStarred ? ["STARRED"] : [];
        const removeLabelIds = isStarred ? [] : ["STARRED"];
        const { email, gmailMessage } = await modifyGmailLabels({
          context,
          emailId: id,
          addLabelIds,
          removeLabelIds,
        });
        await updateEmailLabelState(
          context,
          id,
          getFreshEmailLabelUpdate(
            email,
            gmailMessage,
            addLabelIds,
            removeLabelIds,
          ),
        );
      }
      if (data.action === "trash") {
        const { email, account, gmailMessage } = await trashGmailMessage({
          context,
          emailId: id,
        });
        await updateEmailLabelState(
          context,
          id,
          getFreshEmailLabelUpdate(email, gmailMessage, ["TRASH"], ["INBOX"]),
        );
        if (email.gmail_thread_id) {
          await upsertEmailThread({
            context,
            account,
            gmailThreadId: email.gmail_thread_id,
          });
        }
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
      getEmailAnalyticsRows(context),
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
        unreadEmails: emailsData.filter(
          (email) => getEmailFolderState(email).isUnread,
        ).length,
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
