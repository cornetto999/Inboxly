import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const COMMON_QUERY_KEYS = [
  ["dashboard"],
  ["reports"],
  ["report-drilldown"],
  ["sidebar-counters"],
] as const;

const TABLE_QUERY_KEYS: Record<string, readonly (readonly string[])[]> = {
  activity_logs: [["admin-activity"], ["dashboard"], ["lead"], ["customer"]],
  campaign_recipients: [["campaigns"], ["reports"], ["dashboard"]],
  campaigns: [["campaigns"]],
  contacts: [["contacts"]],
  customers: [["customers"], ["customer"], ["contacts"]],
  email_accounts: [["accounts"], ["emails"], ["email-folder-counts"]],
  email_attachments: [["email-attachments"]],
  email_threads: [["emails"], ["email-folder-counts"]],
  email_templates: [["templates"]],
  emails: [
    ["emails"],
    ["email-folder-counts"],
    ["email-attachments"],
    ["contacts"],
    ["lead"],
    ["customer"],
  ],
  leads: [["leads"], ["lead"], ["contacts"]],
  notes: [["lead"], ["customer"]],
  profiles: [["team"], ["admin-users"]],
  reminders: [["reminders"], ["lead"], ["customer"]],
  tasks: [["tasks"]],
  user_roles: [["team"], ["admin-users"], ["role"]],
};

const REALTIME_TABLES = Object.keys(TABLE_QUERY_KEYS);

export function RealtimeQuerySync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const pendingKeys = new Map<string, readonly string[]>();
    let flushTimer: ReturnType<typeof window.setTimeout> | undefined;

    const queueInvalidation = (keys: readonly (readonly string[])[]) => {
      for (const key of [...COMMON_QUERY_KEYS, ...keys]) {
        pendingKeys.set(key.join(":"), key);
      }

      window.clearTimeout(flushTimer);
      flushTimer = window.setTimeout(() => {
        for (const key of pendingKeys.values()) {
          queryClient.invalidateQueries({ queryKey: [...key] });
        }
        pendingKeys.clear();
      }, 250);
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
