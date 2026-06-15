import { useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { listEmailAccounts, syncGmail } from "@/lib/crm.functions";
import { getErrorMessage } from "@/lib/errors";

const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const AUTO_SYNC_STALE_MS = 4 * 60 * 1000;

export function AutoGmailSync() {
  const queryClient = useQueryClient();
  const listAccounts = useServerFn(listEmailAccounts);
  const sync = useServerFn(syncGmail);
  const syncing = useRef(false);
  const reconnectNotices = useRef(new Set<string>());

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => listAccounts(),
    staleTime: 60_000,
  });

  const runAutoSync = useCallback(async () => {
    if (syncing.current || accounts.length === 0) return;

    const staleAccounts = accounts.filter((account) => {
      if (!account.last_sync_at) return true;
      return (
        Date.now() - new Date(account.last_sync_at).getTime() >=
        AUTO_SYNC_STALE_MS
      );
    });
    if (staleAccounts.length === 0) return;

    syncing.current = true;
    let syncedAnyAccount = false;
    try {
      for (const account of staleAccounts) {
        try {
          await sync({ data: { accountId: account.id, maxResults: 100 } });
          syncedAnyAccount = true;
        } catch (error) {
          const message = getErrorMessage(error);
          if (
            message.includes("Reconnect Gmail") &&
            !reconnectNotices.current.has(account.id)
          ) {
            reconnectNotices.current.add(account.id);
            toast.error(
              "Reconnect Gmail once in Settings to enable automatic sync.",
            );
          } else {
            console.warn("Automatic Gmail sync failed.", error);
          }
        }
      }
    } finally {
      syncing.current = false;
    }

    if (syncedAnyAccount) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["emails"] }),
        queryClient.invalidateQueries({ queryKey: ["email-folder-counts"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["sidebar-counters"] }),
      ]);
    }
  }, [accounts, queryClient, sync]);

  useEffect(() => {
    void runAutoSync();

    const intervalId = window.setInterval(
      () => void runAutoSync(),
      AUTO_SYNC_INTERVAL_MS,
    );
    const handleResume = () => void runAutoSync();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void runAutoSync();
    };

    window.addEventListener("focus", handleResume);
    window.addEventListener("online", handleResume);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleResume);
      window.removeEventListener("online", handleResume);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [runAutoSync]);

  return null;
}
