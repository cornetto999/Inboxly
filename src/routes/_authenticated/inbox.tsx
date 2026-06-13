import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  listEmails, listEmailAccounts, syncGmail, createLead, createCustomerFromEmail, sendGmailReply, markEmailRead, listTemplates,
} from "@/lib/crm.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, Search, Mail, UserPlus, UserCheck, Send } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/inbox")({
  head: () => ({ meta: [{ title: "Inbox — Inboxly" }] }),
  component: InboxPage,
});

type Email = Awaited<ReturnType<typeof listEmails>>[number];

function InboxPage() {
  const qc = useQueryClient();
  const listEm = useServerFn(listEmails);
  const listAcc = useServerFn(listEmailAccounts);
  const sync = useServerFn(syncGmail);
  const mkLead = useServerFn(createLead);
  const mkCust = useServerFn(createCustomerFromEmail);
  const mkRead = useServerFn(markEmailRead);

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [selected, setSelected] = useState<Email | null>(null);

  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: () => listAcc() });
  const { data: emails = [], isLoading } = useQuery({
    queryKey: ["emails", search, from],
    queryFn: () => listEm({ data: { search, fromDate: from || undefined } }),
  });

  const syncMut = useMutation({
    mutationFn: (accountId: string) => sync({ data: { accountId, maxResults: 25 } }),
    onSuccess: (res) => {
      toast.success(`Imported ${res.imported} new email(s)`);
      qc.invalidateQueries({ queryKey: ["emails"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const convertLead = useMutation({
    mutationFn: (e: Email) => mkLead({ data: { email: e.from_email, name: e.from_name ?? undefined, from_email_id: e.id, source: "inbox" } }),
    onSuccess: () => { toast.success("Converted to lead"); qc.invalidateQueries({ queryKey: ["emails"] }); qc.invalidateQueries({ queryKey: ["leads"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const convertCust = useMutation({
    mutationFn: (e: Email) => mkCust({ data: { email: e.from_email, name: e.from_name ?? undefined, from_email_id: e.id } }),
    onSuccess: () => { toast.success("Converted to customer"); qc.invalidateQueries({ queryKey: ["emails"] }); qc.invalidateQueries({ queryKey: ["customers"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const openEmail = async (e: Email) => {
    setSelected(e);
    if (!e.is_read) {
      await mkRead({ data: { id: e.id, isRead: true } });
      qc.invalidateQueries({ queryKey: ["emails"] });
    }
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inbox</h1>
          <p className="text-sm text-muted-foreground">{emails.length} email(s)</p>
        </div>
        <div className="flex gap-2">
          {accounts.length === 0 ? (
            <Button variant="outline" asChild><a href="/settings">Connect Gmail</a></Button>
          ) : (
            <Button onClick={() => accounts[0] && syncMut.mutate(accounts[0].id)} disabled={syncMut.isPending}>
              {syncMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Sync now
            </Button>
          )}
        </div>
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search subject or sender" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Input type="date" className="w-44" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
      </Card>

      <Card>
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>
        ) : emails.length === 0 ? (
          <div className="p-12 text-center">
            <Mail className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="font-medium">No emails yet</p>
            <p className="text-sm text-muted-foreground">{accounts.length === 0 ? "Connect Gmail to sync your inbox." : "Click Sync now to import."}</p>
          </div>
        ) : (
          <div className="divide-y">
            {emails.map((e) => (
              <button
                key={e.id}
                onClick={() => openEmail(e)}
                className={`flex w-full items-center gap-3 p-4 text-left hover:bg-muted/50 ${!e.is_read ? "bg-muted/20" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`truncate text-sm ${!e.is_read ? "font-semibold" : ""}`}>{e.from_name || e.from_email}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{format(new Date(e.received_at), "MMM d")}</span>
                  </div>
                  <div className="truncate text-sm">{e.subject || "(no subject)"}</div>
                  <div className="truncate text-xs text-muted-foreground">{e.snippet}</div>
                </div>
                <div className="flex gap-1">
                  {e.lead_id && <Badge variant="secondary" className="text-xs">Lead</Badge>}
                  {e.customer_id && <Badge variant="default" className="text-xs">Customer</Badge>}
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="pr-6 text-left">{selected.subject || "(no subject)"}</SheetTitle>
                <div className="text-sm text-muted-foreground">
                  <div><strong>{selected.from_name || selected.from_email}</strong> &lt;{selected.from_email}&gt;</div>
                  <div>{format(new Date(selected.received_at), "PPp")}</div>
                </div>
              </SheetHeader>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => convertLead.mutate(selected)} disabled={!!selected.lead_id}>
                  <UserPlus className="mr-2 h-4 w-4" />Convert to Lead
                </Button>
                <Button size="sm" variant="outline" onClick={() => convertCust.mutate(selected)} disabled={!!selected.customer_id}>
                  <UserCheck className="mr-2 h-4 w-4" />Convert to Customer
                </Button>
              </div>
              <div
                className="prose prose-sm dark:prose-invert mt-6 max-w-none whitespace-pre-wrap rounded-md border border-border bg-card p-4"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(selected.body_html || selected.body_text || selected.snippet || "") }}
              />
              <ReplyBox email={selected} accountId={accounts[0]?.id} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function sanitizeHtml(html: string): string {
  // basic: strip scripts and on* attrs; full sanitization handled in client display only
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "");
}

function ReplyBox({ email, accountId }: { email: Email; accountId?: string }) {
  const send = useServerFn(sendGmailReply);
  const listTpl = useServerFn(listTemplates);
  const { data: templates = [] } = useQuery({ queryKey: ["templates"], queryFn: () => listTpl() });
  const [subject, setSubject] = useState(email.subject?.startsWith("Re:") ? email.subject : `Re: ${email.subject ?? ""}`);
  const [body, setBody] = useState("");
  const mut = useMutation({
    mutationFn: () => send({ data: {
      accountId: accountId!, to: email.from_email, subject, body,
      threadId: email.gmail_thread_id ?? undefined, inReplyToEmailId: email.id,
    } }),
    onSuccess: () => { toast.success("Reply sent"); setBody(""); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!accountId) return <p className="mt-6 text-sm text-muted-foreground">Connect Gmail in Settings to reply.</p>;

  return (
    <div className="mt-6 space-y-3 rounded-md border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">Reply</h3>
      {templates.length > 0 && (
        <Select onValueChange={(id) => {
          const t = templates.find((x) => x.id === id);
          if (t) { setSubject(t.subject); setBody(t.body); }
        }}>
          <SelectTrigger><SelectValue placeholder="Use template…" /></SelectTrigger>
          <SelectContent>{templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
        </Select>
      )}
      <div className="space-y-1"><Label>Subject</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
      <div className="space-y-1"><Label>Message</Label><Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} /></div>
      <Button onClick={() => mut.mutate()} disabled={mut.isPending || !body.trim()}>
        {mut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />} Send reply
      </Button>
    </div>
  );
}
