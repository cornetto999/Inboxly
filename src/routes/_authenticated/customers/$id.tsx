import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  getCustomer,
  updateCustomer,
  createNote,
  createReminder,
} from "@/lib/crm.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DueDatePicker } from "@/components/due-date-picker";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/customers/$id")({
  head: () => ({ meta: [{ title: "Customer — Inboxly" }] }),
  component: CustomerDetail,
});

function CustomerDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const get = useServerFn(getCustomer);
  const upd = useServerFn(updateCustomer);
  const note = useServerFn(createNote);
  const rem = useServerFn(createReminder);

  const { data, isLoading } = useQuery({
    queryKey: ["customer", id],
    queryFn: () => get({ data: { id } }),
  });
  const [noteBody, setNoteBody] = useState("");
  const [remTitle, setRemTitle] = useState("");
  const [remDue, setRemDue] = useState("");

  const updMut = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      upd({ data: { id, ...patch } }),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["customer", id] });
    },
  });
  const noteMut = useMutation({
    mutationFn: () => note({ data: { body: noteBody, customer_id: id } }),
    onSuccess: () => {
      setNoteBody("");
      qc.invalidateQueries({ queryKey: ["customer", id] });
    },
  });
  const remMut = useMutation({
    mutationFn: () =>
      rem({
        data: {
          title: remTitle,
          due_at: new Date(remDue).toISOString(),
          customer_id: id,
        },
      }),
    onSuccess: () => {
      setRemTitle("");
      setRemDue("");
      qc.invalidateQueries({ queryKey: ["customer", id] });
    },
  });

  if (isLoading || !data?.customer)
    return (
      <div className="p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  const { customer, notes, reminders, emails, activity } = data;

  return (
    <div className="mx-auto max-w-7xl p-5 lg:p-8">
      <Link
        to="/customers"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to customers
      </Link>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="space-y-4 border-border/80 p-5 shadow-sm lg:col-span-2">
          <div>
            <h1 className="text-2xl font-bold">
              {customer.name || customer.email}
            </h1>
            <p className="text-sm text-muted-foreground">{customer.email}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Name</Label>
              <Input
                defaultValue={customer.name ?? ""}
                onBlur={(e) => updMut.mutate({ name: e.target.value })}
              />
            </div>
            <div>
              <Label>Company</Label>
              <Input
                defaultValue={customer.company ?? ""}
                onBlur={(e) => updMut.mutate({ company: e.target.value })}
              />
            </div>
            <div>
              <Label>Phone</Label>
              <Input
                defaultValue={customer.phone ?? ""}
                onBlur={(e) => updMut.mutate({ phone: e.target.value })}
              />
            </div>
            <div>
              <Label>Status</Label>
              <Select
                value={customer.status}
                onValueChange={(v) => updMut.mutate({ status: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="lost">Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Address</Label>
              <Textarea
                defaultValue={customer.address ?? ""}
                onBlur={(e) => updMut.mutate({ address: e.target.value })}
              />
            </div>
          </div>
        </Card>

        <Card className="space-y-3 border-border/80 p-5 shadow-sm">
          <h2 className="font-semibold">Add note</h2>
          <Textarea
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
          />
          <Button
            onClick={() => noteMut.mutate()}
            disabled={!noteBody.trim()}
            size="sm"
          >
            Save
          </Button>
          <h2 className="font-semibold pt-3">Reminder</h2>
          <Input
            value={remTitle}
            onChange={(e) => setRemTitle(e.target.value)}
            placeholder="Title"
          />
          <DueDatePicker value={remDue} onChange={setRemDue} />
          <Button
            onClick={() => remMut.mutate()}
            disabled={!remTitle || !remDue}
            size="sm"
          >
            Create
          </Button>
        </Card>

        <Card className="border-border/80 p-5 shadow-sm lg:col-span-2">
          <h2 className="mb-3 font-semibold">Email history</h2>
          <div className="space-y-2">
            {emails.map((e) => (
              <div key={e.id} className="rounded border border-border p-3">
                <div className="flex justify-between text-sm">
                  <strong>{e.subject || "(no subject)"}</strong>
                  <span className="text-muted-foreground">
                    {format(new Date(e.received_at), "MMM d")}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {e.snippet}
                </div>
              </div>
            ))}
            {emails.length === 0 && (
              <p className="text-sm text-muted-foreground">No emails linked.</p>
            )}
          </div>
        </Card>

        <Card className="border-border/80 p-5 shadow-sm">
          <h2 className="mb-3 font-semibold">Notes</h2>
          {notes.map((n) => (
            <div
              key={n.id}
              className="mb-2 rounded border border-border p-3 text-sm"
            >
              <div className="whitespace-pre-wrap">{n.body}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {format(new Date(n.created_at), "PPp")}
              </div>
            </div>
          ))}
          {notes.length === 0 && (
            <p className="text-sm text-muted-foreground">No notes.</p>
          )}
          <h2 className="mb-3 mt-4 font-semibold">Reminders</h2>
          {reminders.map((r) => (
            <div
              key={r.id}
              className="mb-2 rounded border border-border p-3 text-sm"
            >
              <div className="font-medium">{r.title}</div>
              <div className="text-xs text-muted-foreground">
                {format(new Date(r.due_at), "PPp")}
              </div>
            </div>
          ))}
          {reminders.length === 0 && (
            <p className="text-sm text-muted-foreground">None.</p>
          )}
        </Card>

        <Card className="border-border/80 p-5 shadow-sm lg:col-span-3">
          <h2 className="mb-3 font-semibold">Activity</h2>
          {activity.map((a) => (
            <div
              key={a.id}
              className="flex justify-between border-l-2 border-primary pl-3 text-sm py-1"
            >
              <span>{a.action.replace(/_/g, " ")}</span>
              <span className="text-muted-foreground">
                {format(new Date(a.created_at), "PPp")}
              </span>
            </div>
          ))}
          {activity.length === 0 && (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
