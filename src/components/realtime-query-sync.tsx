import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const REALTIME_FLUSH_DELAY_MS = 900;
const REALTIME_MAX_FLUSH_DELAY_MS = 2_500;

const TABLE_QUERY_KEYS: Record<string, readonly (readonly string[])[]> = {
  activity_logs: [["admin-activity"], ["dashboard"], ["lead"], ["customer"]],
  campaign_recipients: [["campaigns"], ["reports"], ["dashboard"]],
  campaigns: [["campaigns"], ["reports"], ["dashboard"], ["sidebar-counters"]],
  contacts: [["contacts"], ["sidebar-counters"]],
  customers: [
    ["customers"],
    ["customer"],
    ["contacts"],
    ["dashboard"],
    ["reports"],
    ["sidebar-counters"],
  ],
  email_accounts: [
    ["accounts"],
    ["emails"],
    ["email-folder-counts"],
    ["dashboard"],
    ["sidebar-counters"],
  ],
  email_attachments: [["email-attachments"]],
  email_threads: [
    ["emails"],
    ["email-folder-counts"],
    ["dashboard"],
    ["reports"],
    ["report-drilldown"],
    ["sidebar-counters"],
  ],
  email_templates: [["templates"], ["sidebar-counters"]],
  emails: [
    ["emails"],
    ["email-folder-counts"],
    ["email-attachments"],
    ["contacts"],
    ["lead"],
    ["customer"],
    ["dashboard"],
    ["reports"],
    ["report-drilldown"],
    ["sidebar-counters"],
  ],
  leads: [
    ["leads"],
    ["lead"],
    ["contacts"],
    ["dashboard"],
    ["reports"],
    ["sidebar-counters"],
  ],
  notes: [["lead"], ["customer"]],
  profiles: [["team"], ["admin-users"]],
  reminders: [
    ["reminders"],
    ["lead"],
    ["customer"],
    ["dashboard"],
    ["sidebar-counters"],
  ],
  tasks: [["tasks"], ["dashboard"], ["sidebar-counters"]],
  user_roles: [["team"], ["admin-users"], ["role"]],
};

const REALTIME_TABLES = Object.keys(TABLE_QUERY_KEYS);

export function RealtimeQuerySync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const pendingKeys = new Map<string, readonly string[]>();
    let flushTimer: ReturnType<typeof window.setTimeout> | undefined;
    let pendingStartedAt: number | undefined;

    const flushInvalidations = () => {
      for (const key of pendingKeys.values()) {
        queryClient.invalidateQueries({
          queryKey: [...key],
          refetchType: "active",
        });
      }
      pendingKeys.clear();
      pendingStartedAt = undefined;
    };

    const queueInvalidation = (keys: readonly (readonly string[])[]) => {
      for (const key of keys) {
        pendingKeys.set(key.join(":"), key);
      }

      window.clearTimeout(flushTimer);
      pendingStartedAt ??= Date.now();
      const elapsed = Date.now() - pendingStartedAt;
      const delay = Math.max(
        0,
        Math.min(
          REALTIME_FLUSH_DELAY_MS,
          REALTIME_MAX_FLUSH_DELAY_MS - elapsed,
        ),
      );
      flushTimer = window.setTimeout(flushInvalidations, delay);
    };

    const channel = supabase.channel("crm-realtime-query-sync");
    for (const table of REALTIME_TABLES) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => queueInvalidation(TABLE_QUERY_KEYS[table]),
      );
    }
    channel.subscribe();

    const refreshVisiblePage = () => {
      queueInvalidation([
        ["emails"],
        ["leads"],
        ["customers"],
        ["reminders"],
        ["tasks"],
        ["campaigns"],
        ["contacts"],
        ["templates"],
        ["accounts"],
        ["email-folder-counts"],
        ["sidebar-counters"],
      ]);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshVisiblePage();
    };

    window.addEventListener("focus", refreshVisiblePage);
    window.addEventListener("online", refreshVisiblePage);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearTimeout(flushTimer);
      supabase.removeChannel(channel);
      window.removeEventListener("focus", refreshVisiblePage);
      window.removeEventListener("online", refreshVisiblePage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [queryClient]);

  return null;
}
