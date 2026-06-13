import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { listEmailAccounts, saveEmailAccount, deleteEmailAccount } from "@/lib/crm.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  createGmailConnectionToken,
  getGoogleSessionEmail,
  GMAIL_CONNECT_PENDING_KEY,
  GMAIL_OAUTH_SCOPES,
} from "@/lib/gmail-oauth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mail, Trash2, Loader2 } from "lucide-react";
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
  const del = useServerFn(deleteEmailAccount);
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: () => list() });
  const [connecting, setConnecting] = useState(false);

  const saveCurrentGoogleSession = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;

    const session = data.session;
    const connectionToken = session ? createGmailConnectionToken(session) : null;
    if (!session || !connectionToken) return false;

    const email = getGoogleSessionEmail(session);
    if (!email) throw new Error("Google account email was not returned.");

    await save({ data: { email_address: email, connection_api_key: connectionToken } });
    toast.success("Gmail connected");
    qc.invalidateQueries({ queryKey: ["accounts"] });
    return true;
  };

  const startGoogleGmailConsent = async () => {
    localStorage.setItem(GMAIL_CONNECT_PENDING_KEY, "1");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: GMAIL_OAUTH_SCOPES,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });
    if (error) throw error;
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const saved = await saveCurrentGoogleSession();
      if (!saved) await startGoogleGmailConsent();
    } catch (e) {
      localStorage.removeItem(GMAIL_CONNECT_PENDING_KEY);
      toast.error(e instanceof Error ? e.message : "Failed");
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
        toast.error(e instanceof Error ? e.message : "Failed");
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
                <Button size="icon" variant="ghost" onClick={() => rm.mutate(a.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
