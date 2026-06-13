import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";

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
    const { supabase, userId } = context;
    const isAdmin = await supabase
      .rpc("has_role", { _user_id: userId, _role: "admin" })
      .then((r) => Boolean(r.data));

    const scopeLeads = isAdmin ? supabase.from("leads").select("status", { count: "exact" })
      : supabase.from("leads").select("status", { count: "exact" }).eq("owner_id", userId);
    const scopeCustomers = isAdmin ? supabase.from("customers").select("status", { count: "exact" })
      : supabase.from("customers").select("status", { count: "exact" }).eq("owner_id", userId);

    const [{ data: leads }, { data: customers }, { data: dueReminders }] = await Promise.all([
      scopeLeads,
      scopeCustomers,
      supabase.from("reminders").select("id").eq("user_id", userId).is("completed_at", null).lte("due_at", new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()),
    ]);

    const byStatus = (rows: { status: string }[] | null, s: string) => (rows ?? []).filter((r) => r.status === s).length;
    return {
      totalLeads: leads?.length ?? 0,
      newLeads: byStatus(leads ?? null, "new"),
      followUpsDue: dueReminders?.length ?? 0,
      wonCustomers: byStatus(leads ?? null, "won"),
      lostCustomers: byStatus(leads ?? null, "lost"),
      activeCustomers: byStatus(customers ?? null, "active"),
    };
  });

// ---------- Email Accounts ----------
export const listEmailAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("email_accounts")
      .select("id, email_address, provider, last_sync_at, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const saveEmailAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      email_address: z.string().email(),
      connection_api_key: z.string().min(1),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("email_accounts").upsert({
      user_id: context.userId,
      provider: "gmail",
      email_address: data.email_address,
      connection_api_key: data.connection_api_key,
    }, { onConflict: "user_id,email_address" });
    if (error) throw error;
    return { ok: true };
  });

export const deleteEmailAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("email_accounts").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// ---------- Gmail OAuth ----------
export const startGmailConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ targetOrigin: z.string().url() }).parse(input))
  .handler(async ({ context, data }) => {
    const { authorizeAppUserOAuth } = await import("@/integrations/lovable/appUserConnector");
    const clientId = process.env.GOOGLE_APP_USER_CONNECTOR_CLIENT_ID;
    if (!clientId) {
      throw new Error(
        "Gmail OAuth is not configured. Add GOOGLE_APP_USER_CONNECTOR_CLIENT_ID in Vercel Environment Variables, then redeploy.",
      );
    }
    const { authorizationUrl } = await authorizeAppUserOAuth({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectorId: "google",
      appUserId: context.userId,
      connectorClientId: clientId,
      returnUrl: `${data.targetOrigin}/settings`,
      responseMode: "web_message",
      webMessageTargetOrigin: data.targetOrigin,
      credentialsConfiguration: {
        scopes: [
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/gmail.send",
          "https://www.googleapis.com/auth/gmail.modify",
          "https://www.googleapis.com/auth/userinfo.email",
        ],
      },
    });
    return { authorizationUrl };
  });

// ---------- Gmail Sync ----------
type GmailHeader = { name: string; value: string };
type GmailPayload = {
  headers?: GmailHeader[];
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPayload[];
};

function decodeBase64Url(s: string): string {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    if (typeof Buffer !== "undefined") return Buffer.from(b64, "base64").toString("utf-8");
    return atob(b64);
  } catch { return ""; }
}

function extractBody(payload: GmailPayload | undefined): { html: string; text: string } {
  let html = "", text = "";
  const walk = (p?: GmailPayload) => {
    if (!p) return;
    if (p.mimeType === "text/html" && p.body?.data) html ||= decodeBase64Url(p.body.data);
    if (p.mimeType === "text/plain" && p.body?.data) text ||= decodeBase64Url(p.body.data);
    p.parts?.forEach(walk);
  };
  walk(payload);
  return { html, text };
}

function getHeader(headers: GmailHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function parseFrom(raw: string): { email: string; name: string } {
  const m = raw.match(/^(.*?)<(.+?)>\s*$/);
  if (m) return { name: m[1].trim().replace(/^"|"$/g, ""), email: m[2].trim() };
  return { email: raw.trim(), name: "" };
}

export const syncGmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ accountId: z.string().uuid(), maxResults: z.number().min(1).max(100).optional() }).parse(input))
  .handler(async ({ context, data }) => {
    const { callAsAppUser } = await import("@/integrations/lovable/appUserConnector");
    const { data: account, error: accErr } = await context.supabase
      .from("email_accounts").select("*").eq("id", data.accountId).single();
    if (accErr || !account) throw new Error("Account not found");

    const listRes = await callAsAppUser({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectionAPIKey: account.connection_api_key,
      connectorId: "google_mail",
      path: `/gmail/v1/users/me/messages?maxResults=${data.maxResults ?? 25}&q=in:inbox`,
    });
    if (!listRes.ok) throw new Error(`Gmail list failed: ${listRes.status} ${await listRes.text()}`);
    const listJson = await listRes.json() as { messages?: { id: string }[] };
    const messageIds = (listJson.messages ?? []).map((m) => m.id);

    let imported = 0;
    for (const mid of messageIds) {
      // skip if exists
      const { data: existing } = await context.supabase
        .from("emails").select("id").eq("account_id", account.id).eq("gmail_message_id", mid).maybeSingle();
      if (existing) continue;

      const msgRes = await callAsAppUser({
        gatewayBaseUrl: GATEWAY_BASE_URL,
        connectionAPIKey: account.connection_api_key,
        connectorId: "google_mail",
        path: `/gmail/v1/users/me/messages/${mid}?format=full`,
      });
      if (!msgRes.ok) continue;
      const msg = await msgRes.json() as {
        id: string; threadId: string; snippet?: string; labelIds?: string[];
        internalDate?: string; payload?: GmailPayload;
      };
      const headers = msg.payload?.headers;
      const from = parseFrom(getHeader(headers, "From"));
      const to = getHeader(headers, "To").split(",").map((s) => s.trim()).filter(Boolean);
      const cc = getHeader(headers, "Cc").split(",").map((s) => s.trim()).filter(Boolean);
      const subject = getHeader(headers, "Subject");
      const { html, text } = extractBody(msg.payload);
      const receivedAt = msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : new Date().toISOString();

      await context.supabase.from("emails").insert({
        user_id: context.userId,
        account_id: account.id,
        gmail_message_id: msg.id,
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
        is_read: !(msg.labelIds ?? []).includes("UNREAD"),
        labels: msg.labelIds ?? [],
      });
      imported++;
    }

    await context.supabase.from("email_accounts").update({ last_sync_at: new Date().toISOString() }).eq("id", account.id);
    await context.supabase.from("activity_logs").insert({
      actor_id: context.userId, entity_type: "email_account", entity_id: account.id,
      action: "sync", metadata: { imported },
    });
    return { imported, scanned: messageIds.length };
  });

export const sendGmailReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    accountId: z.string().uuid(),
    to: z.string().email(),
    subject: z.string().min(1).max(998),
    body: z.string().min(1).max(50000),
    threadId: z.string().optional(),
    inReplyToEmailId: z.string().uuid().optional(),
  }).parse(input))
  .handler(async ({ context, data }) => {
    const { callAsAppUser } = await import("@/integrations/lovable/appUserConnector");
    const { data: account } = await context.supabase
      .from("email_accounts").select("*").eq("id", data.accountId).single();
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
    const raw = (typeof Buffer !== "undefined" ? Buffer.from(rfc).toString("base64") : btoa(rfc))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const body: Record<string, unknown> = { raw };
    if (data.threadId) body.threadId = data.threadId;

    const res = await callAsAppUser({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectionAPIKey: account.connection_api_key,
      connectorId: "google_mail",
      path: "/gmail/v1/users/me/messages/send",
      init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    });
    if (!res.ok) throw new Error(`Send failed: ${res.status} ${await res.text()}`);

    await context.supabase.from("activity_logs").insert({
      actor_id: context.userId, entity_type: "email", entity_id: data.inReplyToEmailId ?? null,
      action: "reply_sent", metadata: { to: data.to, subject: data.subject },
    });
    return { ok: true };
  });

// ---------- Emails ----------
export const listEmails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    search: z.string().optional(),
    status: z.string().optional(),
    fromDate: z.string().optional(),
  }).parse(input ?? {}))
  .handler(async ({ context, data }) => {
    let q = context.supabase.from("emails").select("*").order("received_at", { ascending: false }).limit(200);
    if (data.search) q = q.or(`subject.ilike.%${data.search}%,from_email.ilike.%${data.search}%,from_name.ilike.%${data.search}%`);
    if (data.fromDate) q = q.gte("received_at", data.fromDate);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

export const markEmailRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid(), isRead: z.boolean() }).parse(input))
  .handler(async ({ context, data }) => {
    await context.supabase.from("emails").update({ is_read: data.isRead }).eq("id", data.id);
    return { ok: true };
  });

// ---------- Leads ----------
export const listLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("leads").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const getLead = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const [{ data: lead }, { data: notes }, { data: reminders }, { data: emails }, { data: activity }] = await Promise.all([
      context.supabase.from("leads").select("*").eq("id", data.id).single(),
      context.supabase.from("notes").select("*").eq("lead_id", data.id).order("created_at", { ascending: false }),
      context.supabase.from("reminders").select("*").eq("lead_id", data.id).order("due_at"),
      context.supabase.from("emails").select("*").eq("lead_id", data.id).order("received_at", { ascending: false }),
      context.supabase.from("activity_logs").select("*").eq("entity_type", "lead").eq("entity_id", data.id).order("created_at", { ascending: false }).limit(50),
    ]);
    return { lead, notes: notes ?? [], reminders: reminders ?? [], emails: emails ?? [], activity: activity ?? [] };
  });

export const createLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    email: z.string().email().max(255),
    name: z.string().max(100).optional(),
    company: z.string().max(150).optional(),
    phone: z.string().max(50).optional(),
    source: z.string().max(50).optional(),
    from_email_id: z.string().uuid().optional(),
  }).parse(input))
  .handler(async ({ context, data }) => {
    const { data: lead, error } = await context.supabase.from("leads").upsert({
      owner_id: context.userId,
      created_by: context.userId,
      email: data.email,
      name: data.name,
      company: data.company,
      phone: data.phone,
      source: data.source ?? "email",
    }, { onConflict: "owner_id,email" }).select().single();
    if (error) throw error;
    if (data.from_email_id) {
      await context.supabase.from("emails").update({ lead_id: lead.id }).eq("id", data.from_email_id);
    }
    // link any other emails from same sender
    await context.supabase.from("emails").update({ lead_id: lead.id })
      .eq("user_id", context.userId).eq("from_email", data.email).is("lead_id", null);
    await context.supabase.from("activity_logs").insert({
      actor_id: context.userId, entity_type: "lead", entity_id: lead.id, action: "created", metadata: { email: data.email },
    });
    return lead;
  });

export const updateLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    id: z.string().uuid(),
    name: z.string().max(100).nullable().optional(),
    company: z.string().max(150).nullable().optional(),
    phone: z.string().max(50).nullable().optional(),
    status: z.enum(["new", "contacted", "follow_up", "won", "lost"]).optional(),
  }).parse(input))
  .handler(async ({ context, data }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("leads").update(patch).eq("id", id);
    if (error) throw error;
    if (patch.status) {
      await context.supabase.from("activity_logs").insert({
        actor_id: context.userId, entity_type: "lead", entity_id: id, action: "status_changed", metadata: { status: patch.status },
      });
    }
    return { ok: true };
  });

export const deleteLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    await context.supabase.from("leads").delete().eq("id", data.id);
    return { ok: true };
  });

// ---------- Customers ----------
export const listCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("customers").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const getCustomer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const [{ data: customer }, { data: notes }, { data: reminders }, { data: emails }, { data: activity }] = await Promise.all([
      context.supabase.from("customers").select("*").eq("id", data.id).single(),
      context.supabase.from("notes").select("*").eq("customer_id", data.id).order("created_at", { ascending: false }),
      context.supabase.from("reminders").select("*").eq("customer_id", data.id).order("due_at"),
      context.supabase.from("emails").select("*").eq("customer_id", data.id).order("received_at", { ascending: false }),
      context.supabase.from("activity_logs").select("*").eq("entity_type", "customer").eq("entity_id", data.id).order("created_at", { ascending: false }).limit(50),
    ]);
    return { customer, notes: notes ?? [], reminders: reminders ?? [], emails: emails ?? [], activity: activity ?? [] };
  });

export const convertLeadToCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ leadId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { data: lead } = await context.supabase.from("leads").select("*").eq("id", data.leadId).single();
    if (!lead) throw new Error("Lead not found");
    const { data: customer, error } = await context.supabase.from("customers").upsert({
      owner_id: lead.owner_id, lead_id: lead.id,
      email: lead.email, name: lead.name, company: lead.company, phone: lead.phone,
    }, { onConflict: "owner_id,email" }).select().single();
    if (error) throw error;
    await context.supabase.from("leads").update({ status: "won" }).eq("id", lead.id);
    await context.supabase.from("emails").update({ customer_id: customer.id }).eq("lead_id", lead.id);
    await context.supabase.from("activity_logs").insert({
      actor_id: context.userId, entity_type: "customer", entity_id: customer.id, action: "converted_from_lead", metadata: { lead_id: lead.id },
    });
    return customer;
  });

export const createCustomerFromEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    email: z.string().email(),
    name: z.string().max(100).optional(),
    from_email_id: z.string().uuid().optional(),
  }).parse(input))
  .handler(async ({ context, data }) => {
    const { data: customer, error } = await context.supabase.from("customers").upsert({
      owner_id: context.userId, email: data.email, name: data.name,
    }, { onConflict: "owner_id,email" }).select().single();
    if (error) throw error;
    await context.supabase.from("emails").update({ customer_id: customer.id })
      .eq("user_id", context.userId).eq("from_email", data.email);
    if (data.from_email_id) {
      await context.supabase.from("emails").update({ customer_id: customer.id }).eq("id", data.from_email_id);
    }
    await context.supabase.from("activity_logs").insert({
      actor_id: context.userId, entity_type: "customer", entity_id: customer.id, action: "created",
    });
    return customer;
  });

export const updateCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    id: z.string().uuid(),
    name: z.string().max(100).nullable().optional(),
    company: z.string().max(150).nullable().optional(),
    phone: z.string().max(50).nullable().optional(),
    address: z.string().max(500).nullable().optional(),
    status: z.enum(["active", "lost"]).optional(),
  }).parse(input))
  .handler(async ({ context, data }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("customers").update(patch).eq("id", id);
    if (error) throw error;
    return { ok: true };
  });

// ---------- Notes ----------
export const createNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    body: z.string().min(1).max(5000),
    lead_id: z.string().uuid().optional(),
    customer_id: z.string().uuid().optional(),
  }).parse(input))
  .handler(async ({ context, data }) => {
    if (!data.lead_id && !data.customer_id) throw new Error("lead_id or customer_id required");
    const { error } = await context.supabase.from("notes").insert({
      author_id: context.userId, body: data.body, lead_id: data.lead_id, customer_id: data.customer_id,
    });
    if (error) throw error;
    return { ok: true };
  });

// ---------- Reminders ----------
export const listMyReminders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("reminders").select("*").order("due_at");
    return data ?? [];
  });

export const createReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    title: z.string().min(1).max(200),
    notes: z.string().max(2000).optional(),
    due_at: z.string(),
    lead_id: z.string().uuid().optional(),
    customer_id: z.string().uuid().optional(),
  }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("reminders").insert({
      user_id: context.userId, ...data,
    });
    if (error) throw error;
    return { ok: true };
  });

export const completeReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid(), completed: z.boolean() }).parse(input))
  .handler(async ({ context, data }) => {
    await context.supabase.from("reminders").update({
      completed_at: data.completed ? new Date().toISOString() : null,
    }).eq("id", data.id);
    return { ok: true };
  });

export const deleteReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    await context.supabase.from("reminders").delete().eq("id", data.id);
    return { ok: true };
  });

// ---------- Templates ----------
export const listTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("email_templates").select("*").order("created_at", { ascending: false });
    return data ?? [];
  });

export const upsertTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    id: z.string().uuid().optional(),
    name: z.string().min(1).max(100),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(10000),
    is_shared: z.boolean().optional(),
  }).parse(input))
  .handler(async ({ context, data }) => {
    const row = { ...data, user_id: context.userId };
    const { error } = await context.supabase.from("email_templates").upsert(row);
    if (error) throw error;
    return { ok: true };
  });

export const deleteTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    await context.supabase.from("email_templates").delete().eq("id", data.id);
    return { ok: true };
  });

// ---------- Admin ----------
export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id, role");
    const { data: profiles } = await supabaseAdmin.from("profiles").select("id, full_name, created_at");
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
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { data } = await context.supabase.from("activity_logs").select("*").order("created_at", { ascending: false }).limit(200);
    return data ?? [];
  });

export const adminSetRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    user_id: z.string().uuid(),
    role: z.enum(["admin", "staff"]),
    grant: z.boolean(),
  }).parse(input))
  .handler(async ({ context, data }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.grant) {
      await supabaseAdmin.from("user_roles").upsert({ user_id: data.user_id, role: data.role }, { onConflict: "user_id,role" });
    } else {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id).eq("role", data.role);
    }
    return { ok: true };
  });
