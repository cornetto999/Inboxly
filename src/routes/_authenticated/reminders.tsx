import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listMyReminders, createReminder, completeReminder, deleteReminder } from "@/lib/crm.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Bell, Trash2 } from "lucide-react";
import { format, isPast } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reminders")({
  head: () => ({ meta: [{ title: "Reminders — Inboxly" }] }),
  component: RemindersPage,
});

function RemindersPage() {
  const qc = useQueryClient();
  const list = useServerFn(listMyReminders);
  const create = useServerFn(createReminder);
  const complete = useServerFn(completeReminder);
  const del = useServerFn(deleteReminder);
  const { data: rs = [] } = useQuery({ queryKey: ["reminders"], queryFn: () => list() });
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");

  const add = useMutation({
    mutationFn: () => create({ data: { title, due_at: new Date(due).toISOString() } }),
    onSuccess: () => { setTitle(""); setDue(""); toast.success("Created"); qc.invalidateQueries({ queryKey: ["reminders"] }); },
  });
  const compl = useMutation({
    mutationFn: (v: { id: string; completed: boolean }) => complete({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reminders"] }),
  });
  const rm = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reminders"] }),
  });

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Reminders</h1>
        <p className="text-sm text-muted-foreground">Stay on top of follow-ups.</p>
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div><Label>Due</Label><Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></div>
          <Button onClick={() => add.mutate()} disabled={!title || !due}>Add</Button>
        </div>
      </Card>

      {rs.length === 0 ? (
        <Card className="p-12 text-center">
          <Bell className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="font-medium">No reminders</p>
        </Card>
      ) : (
        <Card>
          <div className="divide-y">
            {rs.map((r) => {
              const overdue = !r.completed_at && isPast(new Date(r.due_at));
              return (
                <div key={r.id} className="flex items-center gap-3 p-4">
                  <Checkbox checked={!!r.completed_at} onCheckedChange={(v) => compl.mutate({ id: r.id, completed: Boolean(v) })} />
                  <div className="flex-1">
                    <div className={`font-medium ${r.completed_at ? "line-through text-muted-foreground" : ""}`}>{r.title}</div>
                    <div className={`text-xs ${overdue ? "text-rose-600" : "text-muted-foreground"}`}>
                      Due {format(new Date(r.due_at), "PPp")}{overdue ? " (overdue)" : ""}
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => rm.mutate(r.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
