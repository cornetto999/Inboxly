import { useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { listEmailAccounts, syncGmail } from "@/lib/crm.functions";
import { getErrorMessage } from "@/lib/errors";

const LIVE_SYNC_INTERVAL_MS = 30_000;
const LIVE_SYNC_MAX_RESULTS = 25;
const ACCOUNT_REFRESH_INTERVAL_MS = 30_000;

export function AutoGmailSync() {
  const queryClient = useQueryClient();
  const listAccounts = useServerFn(listEmailAccounts);
  const sync = useServerFn(syncGmail);
  const syncing = useRef(false);
  const reconnectNotices = useRef(new Set<string>());

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => listAccounts(),
    staleTime: 10_000,
    refetchInterval: ACCOUNT_REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });

  const runAutoSync = useCallback(async () => {
    if (
      syncing.current ||
      accounts.length === 0 ||
      document.visibilityState !== "visible" ||
      navigator.onLine === false
    ) {
      return;
    }

    const syncableAccounts = accounts.filter((account) => {
      if (
        account.connection_status === "reauthentication_required" ||
        account.connection_status === "disconnected" ||
        account.connection_status === "connecting" ||
        account.connection_status === "syncing"
      ) {
        return false;
      }
      return true;
    });
    if (syncableAccounts.length === 0) return;

    syncing.current = true;
    let syncedAnyAccount = false;
    let accountStateChanged = false;
    try {
      for (const account of syncableAccounts) {
        try {
          await sync({
            data: {
              accountId: account.id,
              maxResults: LIVE_SYNC_MAX_RESULTS,
              incrementalOnly: true,
            },
          });
          syncedAnyAccount = true;
        } catch (error) {
          const message = getErrorMessage(error);
          if (message.includes("Reconnect Gmail")) {
            accountStateChanged = true;
            if (!reconnectNotices.current.has(account.id)) {
              reconnectNotices.current.add(account.id);
              toast.error(
                "Reconnect Gmail once in Settings to enable automatic sync.",
              );
            }
          } else {
            console.warn("Automatic Gmail sync failed.", error);
          }
        }
      }
    } finally {
      syncing.current = false;
    }

    if (syncedAnyAccount || accountStateChanged) {
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
      LIVE_SYNC_INTERVAL_MS,
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
