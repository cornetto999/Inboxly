import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { listEmailAccounts, saveEmailAccount, deleteEmailAccount, syncGmail } from "@/lib/crm.functions";
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
import { Mail, Trash2, Loader2, RefreshCw } from "lucide-react";
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
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: () => list() });
  const [connecting, setConnecting] = useState(false);

  const invalidateEmailData = () => {
    qc.invalidateQueries({ queryKey: ["accounts"] });
    qc.invalidateQueries({ queryKey: ["emails"] });
  };

  const showSyncResult = (result: { imported: number }) => {
    toast.success(
      result.imported > 0
        ? `Imported ${result.imported} email(s)`
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
    if (!session || !connectionToken) return false;

    const email = getGoogleSessionEmail(session);
    if (!email) throw new Error("Google account email was not returned.");

    const account = await save({ data: { email_address: email, connection_api_key: connectionToken } });
    clearPendingGmailConnectionToken();
    localStorage.removeItem(GMAIL_CONNECT_PENDING_KEY);
    toast.success("Gmail connected. Syncing inbox...");

    const result = await sync({ data: { accountId: account.id, maxResults: 25 } });
    showSyncResult(result);
    invalidateEmailData();
    return true;
  };

  const startGoogleGmailConsent = async () => {
    localStorage.setItem(GMAIL_CONNECT_PENDING_KEY, "1");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: GMAIL_OAUTH_SCOPES,
      },
    });
    if (error) throw toError(error, "Unable to start Google sign-in.");
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await startGoogleGmailConsent();
    } catch (e) {
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
        localStorage.removeItem(GMAIL_CONNECT_PENDING_KEY);
        toast.error(getErrorMessage(e, "Failed"));
      })
      .finally(() => {
        if (active) setConnecting(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const rm = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { toast.success("Disconnected"); qc.invalidateQueries({ queryKey: ["accounts"] }); },
  });

  const syncMut = useMutation({
    mutationFn: (id: string) => sync({ data: { accountId: id, maxResults: 25 } }),
    onSuccess: (result) => {
      showSyncResult(result);
      invalidateEmailData();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 lg:p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Connect your email accounts.</p>
      </div>

      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold flex items-center gap-2"><Mail className="h-4 w-4" /> Gmail</h2>
            <p className="text-sm text-muted-foreground">Sync your inbox using secure OAuth — no passwords stored.</p>
          </div>
          <Button onClick={handleConnect} disabled={connecting}>
            {connecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Connect Gmail
          </Button>
        </div>

        {accounts.length > 0 && (
          <div className="divide-y border-t pt-2">
            {accounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium">{a.email_address}</div>
                  <div className="text-xs text-muted-foreground">
                    {a.last_sync_at ? `Last sync ${format(new Date(a.last_sync_at), "PPp")}` : "Not synced yet"}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Sync now"
                    aria-label="Sync now"
                    onClick={() => syncMut.mutate(a.id)}
                    disabled={syncMut.isPending || connecting}
                  >
                    {syncMut.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => rm.mutate(a.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
