import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  listEmailAccounts,
  saveEmailAccount,
  deleteEmailAccount,
  syncGmail,
} from "@/lib/crm.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  clearPendingGmailConnectionToken,
  createGmailConnectionToken,
  getPendingGmailConnectionToken,
  getGoogleSessionEmail,
  GMAIL_CONNECT_PENDING_KEY,
  GMAIL_OAUTH_SCOPES,
} from "@/lib/gmail-oauth";
import { getErrorMessage, toError } from "@/lib/errors";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader, PageShell } from "@/components/crm-ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CheckCircle2,
  Info,
  Loader2,
  Mail,
  MoreHorizontal,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — Inboxly" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listEmailAccounts);
  const save = useServerFn(saveEmailAccount);
  const sync = useServerFn(syncGmail);
  const del = useServerFn(deleteEmailAccount);
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => list(),
  });
  const [connecting, setConnecting] = useState(false);
  const [disconnectAccountId, setDisconnectAccountId] = useState<string | null>(
    null,
  );
  const primaryAccount = accounts[0];
  const connectionStatus = connecting
    ? "connecting"
    : (primaryAccount?.connection_status ?? "disconnected");
  const reconnectRequired = connectionStatus === "reauthentication_required";
  const connected = connectionStatus === "connected";
  const syncing = connectionStatus === "syncing";
  const canStartConnection = !connected && !syncing && !connecting;

  const invalidateEmailData = () => {
    qc.invalidateQueries({ queryKey: ["accounts"] });
    qc.invalidateQueries({ queryKey: ["emails"] });
    qc.invalidateQueries({ queryKey: ["email-folder-counts"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["sidebar-counters"] });
  };

  const showSyncResult = (result: { imported: number; updated?: number }) => {
    const refreshed = result.updated ?? 0;
    toast.success(
      result.imported > 0 || refreshed > 0
        ? `Gmail synced: ${result.imported} new, ${refreshed} refreshed.`
        : "Gmail synced. No new emails found.",
    );
  };

  const saveCurrentGoogleSession = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw toError(error, "Unable to read Google session.");

    const session = data.session;
    const connectionToken =
      getPendingGmailConnectionToken() ??
      (session ? createGmailConnectionToken(session) : null);
    if (!session) return false;
    if (!connectionToken) {
      throw new Error(
        "Google did not return Gmail authorization tokens. Reconnect Gmail again and approve all requested permissions.",
      );
    }

    const email = getGoogleSessionEmail(session);
    if (!email) throw new Error("Google account email was not returned.");

    const account = await save({
      data: { email_address: email, connection_api_key: connectionToken },
    });

    const result = await sync({
      data: {
        accountId: account.id,
        maxResults: 100,
        forceTokenRefresh: true,
      },
    });
    clearPendingGmailConnectionToken();
    localStorage.removeItem(GMAIL_CONNECT_PENDING_KEY);
    toast.success(
      "Gmail reconnected successfully. Email synchronization has started.",
    );
    showSyncResult(result);
    invalidateEmailData();
    return true;
  };

  const startGoogleGmailConsent = async () => {
    clearPendingGmailConnectionToken();
    localStorage.setItem(GMAIL_CONNECT_PENDING_KEY, "1");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: GMAIL_OAUTH_SCOPES,
        queryParams: {
          access_type: "offline",
          prompt: "consent select_account",
          include_granted_scopes: "true",
        },
      },
    });
    if (error) throw toError(error, "Unable to start Google sign-in.");
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await startGoogleGmailConsent();
    } catch (e) {
      clearPendingGmailConnectionToken();
      localStorage.removeItem(GMAIL_CONNECT_PENDING_KEY);
      toast.error(getErrorMessage(e, "Failed"));
      setConnecting(false);
    }
  };

  useEffect(() => {
    if (localStorage.getItem(GMAIL_CONNECT_PENDING_KEY) !== "1") return;

    let active = true;
    setConnecting(true);
    saveCurrentGoogleSession()
      .then((saved) => {
        if (!active) return;
        if (saved) localStorage.removeItem(GMAIL_CONNECT_PENDING_KEY);
      })
      .catch((e) => {
        if (!active) return;
        clearPendingGmailConnectionToken();
        localStorage.removeItem(GMAIL_CONNECT_PENDING_KEY);
        toast.error(getErrorMessage(e, "Failed"));
      })
      .finally(() => {
        if (active) setConnecting(false);
      });

    return () => {
      active = false;
    };
    // This runs once after the OAuth callback restores the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rm = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      toast.success("Disconnected");
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });

  const syncMut = useMutation({
    mutationFn: (id: string) =>
      sync({ data: { accountId: id, maxResults: 100 } }),
    onSuccess: (result) => {
      showSyncResult(result);
      invalidateEmailData();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <PageShell width="narrow">
      <PageHeader title="Settings" description="Connect your email accounts." />

      <Card className="space-y-5 border-border/80 p-4 shadow-sm sm:p-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-lg bg-primary/10 text-primary">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">Gmail</h2>
                <Badge
                  variant="outline"
                  className="border-primary/20 bg-primary/10 text-primary"
                >
                  <ShieldCheck className="mr-1 h-3 w-3" />
                  OAuth
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Syncs automatically while Inboxly is open. No passwords are
                stored.
              </p>
            </div>
          </div>
          <Button
            onClick={canStartConnection ? handleConnect : undefined}
            disabled={!canStartConnection}
            aria-disabled={!canStartConnection}
            className={
              connected
                ? "cursor-not-allowed hover:bg-primary hover:text-primary-foreground"
                : ""
            }
          >
            {(connecting || syncing) && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {connected && <CheckCircle2 className="mr-2 h-4 w-4" />}
            {connecting
              ? "Connecting..."
              : syncing
                ? "Syncing..."
                : connected
                  ? "Connected"
                  : reconnectRequired || connectionStatus === "sync_failed"
                    ? "Reconnect Gmail"
                    : "Connect Gmail"}
          </Button>
        </div>

        {accounts.length > 0 && (
          <div className="divide-y divide-border overflow-hidden rounded-lg border bg-background">
            {accounts.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-4 p-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="break-all font-medium">
                      {a.email_address}
                    </div>
                    <Badge
                      variant={
                        a.connection_status === "reauthentication_required"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {a.connection_status === "reauthentication_required"
                        ? "Reconnect required"
                        : a.connection_status === "syncing"
                          ? "Syncing"
                          : a.connection_status === "sync_failed"
                            ? "Sync failed"
                            : "Connected"}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {(a.last_synced_at ?? a.last_sync_at)
                      ? `Last synced ${format(
                          new Date(a.last_synced_at ?? a.last_sync_at!),
                          "PPp",
                        )}`
                      : "Not synced yet"}
                  </div>
                  {a.last_sync_error && (
                    <p className="mt-1 line-clamp-2 text-xs text-destructive">
                      {a.last_sync_error}
                    </p>
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Manage ${a.email_address}`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => syncMut.mutate(a.id)}
                      disabled={
                        syncMut.isPending ||
                        connecting ||
                        a.connection_status === "reauthentication_required"
                      }
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      {a.connection_status === "sync_failed"
                        ? "Retry sync"
                        : "Sync now"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleConnect}>
                      <Mail className="mr-2 h-4 w-4" />
                      Reconnect account
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        toast.info(
                          `Connected as ${a.email_address}. Status: ${a.connection_status}.`,
                        )
                      }
                    >
                      <Info className="mr-2 h-4 w-4" />
                      View account details
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setDisconnectAccountId(a.id)}
                    >
                      <Unplug className="mr-2 h-4 w-4" />
                      Disconnect Gmail
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </Card>

      <AlertDialog
        open={Boolean(disconnectAccountId)}
        onOpenChange={(open) => !open && setDisconnectAccountId(null)}
      >
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Gmail?</AlertDialogTitle>
            <AlertDialogDescription>
              New emails will stop syncing, but existing CRM data will remain.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (disconnectAccountId) rm.mutate(disconnectAccountId);
                setDisconnectAccountId(null);
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
