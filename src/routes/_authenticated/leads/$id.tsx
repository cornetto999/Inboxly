import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getLead, updateLead, createNote, createReminder, convertLeadToCustomer } from "@/lib/crm.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/leads/$id")({
  head: () => ({ meta: [{ title: "Lead — Inboxly" }] }),
  component: LeadDetail,
});

const STATUSES = ["new", "contacted", "follow_up", "won", "lost"] as const;

function LeadDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const get = useServerFn(getLead);
  const upd = useServerFn(updateLead);
  const note = useServerFn(createNote);
  const rem = useServerFn(createReminder);
  const conv = useServerFn(convertLeadToCustomer);

  const { data, isLoading } = useQuery({ queryKey: ["lead", id], queryFn: () => get({ data: { id } }) });
  const [noteBody, setNoteBody] = useState("");
  const [remTitle, setRemTitle] = useState("");
  const [remDue, setRemDue] = useState("");

  const updMut = useMutation({
    mutationFn: (patch: Record<string, unknown>) => upd({ data: { id, ...patch } }),
    onSuccess: () => { toast.success("Updated"); qc.invalidateQueries({ queryKey: ["lead", id] }); qc.invalidateQueries({ queryKey: ["leads"] }); },
  });
  const noteMut = useMutation({
    mutationFn: () => note({ data: { body: noteBody, lead_id: id } }),
    onSuccess: () => { setNoteBody(""); qc.invalidateQueries({ queryKey: ["lead", id] }); },
  });
  const remMut = useMutation({
    mutationFn: () => rem({ data: { title: remTitle, due_at: new Date(remDue).toISOString(), lead_id: id } }),
    onSuccess: () => { setRemTitle(""); setRemDue(""); toast.success("Reminder created"); qc.invalidateQueries({ queryKey: ["lead", id] }); },
  });
  const convMut = useMutation({
    mutationFn: () => conv({ data: { leadId: id } }),
    onSuccess: () => { toast.success("Converted to customer"); qc.invalidateQueries({ queryKey: ["lead", id] }); },
  });

  if (isLoading || !data?.lead) return <div className="p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  const { lead, notes, reminders, emails, activity } = data;

  return (
    <div className="p-6 lg:p-8">
      <Link to="/leads" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to leads
      </Link>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold">{lead.name || lead.email}</h1>
              <p className="text-sm text-muted-foreground">{lead.email}</p>
            </div>
            <Button onClick={() => convMut.mutate()}>Convert to Customer</Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Name</Label><Input defaultValue={lead.name ?? ""} onBlur={(e) => updMut.mutate({ name: e.target.value })} /></div>
            <div><Label>Company</Label><Input defaultValue={lead.company ?? ""} onBlur={(e) => updMut.mutate({ company: e.target.value })} /></div>
            <div><Label>Phone</Label><Input defaultValue={lead.phone ?? ""} onBlur={(e) => updMut.mutate({ phone: e.target.value })} /></div>
            <div>
              <Label>Status</Label>
              <Select value={lead.status} onValueChange={(v) => updMut.mutate({ status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        </Card>

        <Card className="p-6 space-y-3">
          <h2 className="font-semibold">Add note</h2>
          <Textarea value={noteBody} onChange={(e) => setNoteBody(e.target.value)} placeholder="Internal note…" />
          <Button onClick={() => noteMut.mutate()} disabled={!noteBody.trim()} size="sm">Save note</Button>

          <h2 className="font-semibold pt-3">Add reminder</h2>
          <Input value={remTitle} onChange={(e) => setRemTitle(e.target.value)} placeholder="Title" />
          <Input type="datetime-local" value={remDue} onChange={(e) => setRemDue(e.target.value)} />
          <Button onClick={() => remMut.mutate()} disabled={!remTitle || !remDue} size="sm">Create reminder</Button>
        </Card>

        <Card className="p-6 lg:col-span-2">
          <h2 className="mb-3 font-semibold">Email history ({emails.length})</h2>
          <div className="space-y-2">
            {emails.map((e) => (
              <div key={e.id} className="rounded border border-border p-3">
                <div className="flex justify-between text-sm"><strong>{e.subject || "(no subject)"}</strong><span className="text-muted-foreground">{format(new Date(e.received_at), "MMM d")}</span></div>
                <div className="text-xs text-muted-foreground truncate">{e.snippet}</div>
              </div>
            ))}
            {emails.length === 0 && <p className="text-sm text-muted-foreground">No emails linked.</p>}
          </div>
        </Card>

        <Card className="p-6 space-y-3">
          <h2 className="font-semibold">Notes ({notes.length})</h2>
          {notes.map((n) => (
            <div key={n.id} className="rounded border border-border p-3 text-sm">
              <div className="whitespace-pre-wrap">{n.body}</div>
              <div className="mt-1 text-xs text-muted-foreground">{format(new Date(n.created_at), "PPp")}</div>
            </div>
          ))}
          {notes.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}

          <h2 className="font-semibold pt-3">Reminders ({reminders.length})</h2>
          {reminders.map((r) => (
            <div key={r.id} className="rounded border border-border p-3 text-sm">
              <div className="font-medium">{r.title}</div>
              <div className="text-xs text-muted-foreground">Due {format(new Date(r.due_at), "PPp")}</div>
              {r.completed_at && <Badge variant="secondary" className="mt-1">Done</Badge>}
            </div>
          ))}
          {reminders.length === 0 && <p className="text-sm text-muted-foreground">No reminders.</p>}
        </Card>

        <Card className="p-6 lg:col-span-3">
          <h2 className="mb-3 font-semibold">Activity timeline</h2>
          <div className="space-y-2">
            {activity.map((a) => (
              <div key={a.id} className="flex justify-between text-sm border-l-2 border-primary pl-3">
                <span>{a.action.replace(/_/g, " ")}</span>
                <span className="text-muted-foreground">{format(new Date(a.created_at), "PPp")}</span>
              </div>
            ))}
            {activity.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
