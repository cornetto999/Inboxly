import { useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { listEmailAccounts, syncGmail } from "@/lib/crm.functions";
import { getErrorMessage } from "@/lib/errors";

const LIVE_SYNC_INTERVAL_MS = 30_000;
const LIVE_SYNC_MAX_RESULTS = 25;
const ACCOUNT_REFRESH_INTERVAL_MS = 30_000;
const SYNC_LEASE_KEY = "inboxly:gmail-sync-lease";
const SYNC_LAST_FINISHED_KEY = "inboxly:gmail-sync-last-finished";
const SYNC_LEASE_TTL_MS = 45_000;
const SHARED_SYNC_COOLDOWN_MS = 20_000;

type SyncLease = {
  ownerId: string;
  expiresAt: number;
};

function readNumberFromStorage(key: string) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? Number(value) : 0;
  } catch {
    return 0;
  }
}

function readSyncLease() {
  try {
    const value = window.localStorage.getItem(SYNC_LEASE_KEY);
    if (!value) return null;
    return JSON.parse(value) as SyncLease;
  } catch {
    return null;
  }
}

function createSyncOwnerId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function AutoGmailSync() {
  const queryClient = useQueryClient();
  const listAccounts = useServerFn(listEmailAccounts);
  const sync = useServerFn(syncGmail);
  const syncing = useRef(false);
  const reconnectNotices = useRef(new Set<string>());
  const syncOwnerId = useRef(createSyncOwnerId());

  const acquireSyncLease = useCallback(() => {
    const now = Date.now();
    if (
      now - readNumberFromStorage(SYNC_LAST_FINISHED_KEY) <
      SHARED_SYNC_COOLDOWN_MS
    ) {
      return false;
    }

    try {
      const currentLease = readSyncLease();
      if (
        currentLease &&
        currentLease.ownerId !== syncOwnerId.current &&
        currentLease.expiresAt > now
      ) {
        return false;
      }

      const nextLease: SyncLease = {
        ownerId: syncOwnerId.current,
        expiresAt: now + SYNC_LEASE_TTL_MS,
      };
      window.localStorage.setItem(SYNC_LEASE_KEY, JSON.stringify(nextLease));
      return readSyncLease()?.ownerId === syncOwnerId.current;
    } catch {
      return true;
    }
  }, []);

  const releaseSyncLease = useCallback(() => {
    try {
      window.localStorage.setItem(SYNC_LAST_FINISHED_KEY, String(Date.now()));
      if (readSyncLease()?.ownerId === syncOwnerId.current) {
        window.localStorage.removeItem(SYNC_LEASE_KEY);
      }
    } catch {
      // localStorage can be unavailable in strict privacy modes.
    }
  }, []);

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
    if (!acquireSyncLease()) return;

    syncing.current = true;
    let syncedAnyAccount = false;
    let accountStateChanged = false;
    try {
      for (const account of syncableAccounts) {
        try {
          const result = await sync({
            data: {
              accountId: account.id,
              maxResults: LIVE_SYNC_MAX_RESULTS,
              incrementalOnly: true,
            },
          });
          const skipped =
            result &&
            typeof result === "object" &&
            "skipped" in result &&
            result.skipped === true;
          if (!skipped) {
            syncedAnyAccount = true;
          }
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
      releaseSyncLease();
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
  }, [accounts, acquireSyncLease, queryClient, releaseSyncLease, sync]);

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
