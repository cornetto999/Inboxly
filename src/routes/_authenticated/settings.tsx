import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listEmailAccounts, saveEmailAccount, deleteEmailAccount, startGmailConnect } from "@/lib/crm.functions";
import { connectAppUser } from "@/integrations/lovable/appUserConnectorClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mail, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — Inboxly" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listEmailAccounts);
  const save = useServerFn(saveEmailAccount);
  const del = useServerFn(deleteEmailAccount);
  const startConnect = useServerFn(startGmailConnect);
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: () => list() });
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const result = await connectAppUser({
        connectorId: "google",
        gatewayBaseUrl: GATEWAY_BASE_URL,
        start: (targetOrigin) => startConnect({ data: { targetOrigin } }),
      });
      if (!result.success || !result.connectionAPIKey) {
        toast.error(result.error || "Connection failed");
        return;
      }
      // We don't know the email yet; ask user to provide or call Gmail profile endpoint client-side via server later.
      // For simplicity, ask the server to save with the user's auth email as the address placeholder.
      const email = prompt("Enter the Gmail address you just connected:");
      if (!email) return;
      await save({ data: { email_address: email, connection_api_key: result.connectionAPIKey } });
      toast.success("Gmail connected");
      qc.invalidateQueries({ queryKey: ["accounts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setConnecting(false);
    }
  };

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
