import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  listMyReminders,
  createReminder,
  completeReminder,
  deleteReminder,
} from "@/lib/crm.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { DueDatePicker } from "@/components/due-date-picker";
import { Bell, CalendarClock, Trash2 } from "lucide-react";
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
  const { data: rs = [] } = useQuery({
    queryKey: ["reminders"],
    queryFn: () => list(),
  });
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");

  const add = useMutation({
    mutationFn: () =>
      create({ data: { title, due_at: new Date(due).toISOString() } }),
    onSuccess: () => {
      setTitle("");
      setDue("");
      toast.success("Created");
      qc.invalidateQueries({ queryKey: ["reminders"] });
      qc.invalidateQueries({ queryKey: ["sidebar-counters"] });
    },
  });
  const compl = useMutation({
    mutationFn: (v: { id: string; completed: boolean }) =>
      complete({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reminders"] });
      qc.invalidateQueries({ queryKey: ["sidebar-counters"] });
    },
  });
  const rm = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reminders"] });
      qc.invalidateQueries({ queryKey: ["sidebar-counters"] });
    },
  });

  const openReminders = rs.filter((reminder) => !reminder.completed_at);
  const overdueCount = openReminders.filter((reminder) =>
    isPast(new Date(reminder.due_at)),
  ).length;

  return (
    <div className="mx-auto max-w-7xl p-3 sm:p-5 lg:p-8">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reminders</h1>
          <p className="text-sm text-muted-foreground">
            Stay on top of follow-ups.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 rounded-lg border bg-card p-2 text-sm shadow-sm">
          <div className="px-3 py-2">
            <div className="text-xs text-muted-foreground">Open</div>
            <div className="font-semibold tabular-nums">
              {openReminders.length}
            </div>
          </div>
          <div className="border-l px-3 py-2">
            <div className="text-xs text-muted-foreground">Overdue</div>
            <div className="font-semibold tabular-nums text-rose-600">
              {overdueCount}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Card className="h-fit border-border/80 p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
              <CalendarClock className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold">New reminder</h2>
              <p className="text-xs text-muted-foreground">
                Schedule the next follow-up.
              </p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Follow up with..."
              />
            </div>
            <div className="space-y-2">
              <Label>Due</Label>
              <DueDatePicker value={due} onChange={setDue} />
            </div>
            <Button
              className="w-full"
              onClick={() => add.mutate()}
              disabled={!title || !due}
            >
              Add reminder
            </Button>
          </div>
        </Card>

        <div>
          {rs.length === 0 ? (
            <Card className="border-dashed p-12 text-center shadow-sm">
              <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-lg bg-muted">
                <Bell className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="font-medium">No reminders</p>
              <p className="text-sm text-muted-foreground">
                Create your first follow-up to keep the pipeline warm.
              </p>
            </Card>
          ) : (
            <Card className="overflow-hidden border-border/80 shadow-sm">
              <div className="divide-y divide-border">
                {rs.map((r) => {
                  const overdue = !r.completed_at && isPast(new Date(r.due_at));
                  return (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 p-4 transition-colors hover:bg-accent/45"
                    >
                      <Checkbox
                        checked={!!r.completed_at}
                        onCheckedChange={(v) =>
                          compl.mutate({ id: r.id, completed: Boolean(v) })
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <div
                          className={`font-medium ${r.completed_at ? "text-muted-foreground line-through" : ""}`}
                        >
                          {r.title}
                        </div>
                        <div
                          className={`text-xs ${overdue ? "text-rose-600" : "text-muted-foreground"}`}
                        >
                          Due {format(new Date(r.due_at), "PPp")}
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          r.completed_at
                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700"
                            : overdue
                              ? "border-rose-500/20 bg-rose-500/10 text-rose-700"
                              : "border-amber-500/20 bg-amber-500/10 text-amber-700"
                        }
                      >
                        {r.completed_at
                          ? "Done"
                          : overdue
                            ? "Overdue"
                            : "Upcoming"}
                      </Badge>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${r.title}`}
                        onClick={() => rm.mutate(r.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
