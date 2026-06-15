import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deleteTask, listTasks, upsertTask } from "@/lib/crm.functions";
import { DueDatePicker } from "@/components/due-date-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle2, ListTodo, Trash2 } from "lucide-react";
import { format, isPast } from "date-fns";
import { toast } from "sonner";
import {
  CrmModuleLoading,
  CrmModuleUnavailable,
} from "@/components/crm-module-state";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({ meta: [{ title: "Tasks - Inboxly" }] }),
  component: TasksPage,
});

const TASK_STATUSES = [
  "todo",
  "in_progress",
  "waiting",
  "completed",
  "cancelled",
] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

type TaskForm = {
  id?: string;
  title: string;
  description: string;
  due_at: string;
  priority: (typeof PRIORITIES)[number];
  status: (typeof TASK_STATUSES)[number];
};

const emptyTask: TaskForm = {
  title: "",
  description: "",
  due_at: "",
  priority: "medium",
  status: "todo",
};

function TasksPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listTasks);
  const saveFn = useServerFn(upsertTask);
  const deleteFn = useServerFn(deleteTask);
  const [statusFilter, setStatusFilter] = useState("all");
  const [form, setForm] = useState<TaskForm>(emptyTask);

  const {
    data: tasks = [],
    isPending: tasksLoading,
    isError: tasksUnavailable,
  } = useQuery({
    queryKey: ["tasks", statusFilter],
    queryFn: () => listFn({ data: { status: statusFilter as "all" } }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["sidebar-counters"] });
  };

  const save = useMutation({
    mutationFn: () => saveFn({ data: form }),
    onSuccess: () => {
      setForm(emptyTask);
      toast.success("Task saved");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Task deleted");
      invalidate();
    },
  });

  const updateStatus = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: (typeof TASK_STATUSES)[number];
    }) =>
      saveFn({
        data: {
          id,
          title: tasks.find((task) => task.id === id)?.title ?? "Task",
          status,
        },
      }),
    onSuccess: invalidate,
  });

  const openTasks = tasks.filter(
    (task) => !["completed", "cancelled"].includes(task.status),
  );
  const overdue = openTasks.filter(
    (task) => task.due_at && isPast(new Date(task.due_at)),
  ).length;

  if (tasksLoading) {
    return <CrmModuleLoading name="tasks" />;
  }

  if (tasksUnavailable) {
    return <CrmModuleUnavailable name="Tasks" />;
  }

  return (
    <div className="mx-auto max-w-7xl p-3 sm:p-5 lg:p-8">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
          <p className="text-sm text-muted-foreground">
            Work items linked to emails, leads, and customers.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 rounded-lg border bg-card p-2 text-sm shadow-sm">
          <div className="px-3 py-2">
            <div className="text-xs text-muted-foreground">Open</div>
            <div className="font-semibold tabular-nums">{openTasks.length}</div>
          </div>
          <div className="border-l px-3 py-2">
            <div className="text-xs text-muted-foreground">Overdue</div>
            <div className="font-semibold tabular-nums text-rose-600">
              {overdue}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Card className="h-fit space-y-4 p-5">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
              <ListTodo className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold">
                {form.id ? "Edit task" : "New task"}
              </h2>
              <p className="text-xs text-muted-foreground">
                Assign work and track completion.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Title</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Due</Label>
            <DueDatePicker
              value={form.due_at}
              onChange={(due_at) => setForm({ ...form, due_at })}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={form.priority}
                onValueChange={(priority) =>
                  setForm({
                    ...form,
                    priority: priority as TaskForm["priority"],
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((priority) => (
                    <SelectItem key={priority} value={priority}>
                      {priority}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(status) =>
                  setForm({ ...form, status: status as TaskForm["status"] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={() => save.mutate()}
              disabled={!form.title || save.isPending}
            >
              Save
            </Button>
            {form.id && (
              <Button variant="outline" onClick={() => setForm(emptyTask)}>
                Cancel
              </Button>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tasks</SelectItem>
                {TASK_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Card>
          {tasks.length === 0 ? (
            <Card className="border-dashed p-12 text-center">
              <ListTodo className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <p className="font-medium">No tasks</p>
              <p className="text-sm text-muted-foreground">
                Create the next action for your CRM workflow.
              </p>
            </Card>
          ) : (
            <>
              <div className="hidden overflow-x-auto rounded-lg border md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Task</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tasks.map((task) => {
                      const isOverdue =
                        task.due_at &&
                        !["completed", "cancelled"].includes(task.status) &&
                        isPast(new Date(task.due_at));
                      return (
                        <TableRow key={task.id}>
                          <TableCell>
                            <button
                              className="text-left"
                              onClick={() =>
                                setForm({
                                  id: task.id,
                                  title: task.title,
                                  description: task.description ?? "",
                                  due_at: task.due_at
                                    ? task.due_at.slice(0, 16)
                                    : "",
                                  priority: task.priority,
                                  status: task.status,
                                })
                              }
                            >
                              <div className="font-medium">{task.title}</div>
                              <div className="line-clamp-1 text-sm text-muted-foreground">
                                {task.description}
                              </div>
                            </button>
                          </TableCell>
                          <TableCell
                            className={
                              isOverdue
                                ? "text-rose-600"
                                : "text-muted-foreground"
                            }
                          >
                            {task.due_at
                              ? format(new Date(task.due_at), "PPp")
                              : "No due date"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{task.priority}</Badge>
                          </TableCell>
                          <TableCell>
                            <Select
                              value={task.status}
                              onValueChange={(status) =>
                                updateStatus.mutate({
                                  id: task.id,
                                  status: status as TaskForm["status"],
                                })
                              }
                            >
                              <SelectTrigger className="w-40 border-transparent bg-transparent shadow-none">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TASK_STATUSES.map((status) => (
                                  <SelectItem key={status} value={status}>
                                    {status.replace(/_/g, " ")}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Complete"
                                onClick={() =>
                                  updateStatus.mutate({
                                    id: task.id,
                                    status: "completed",
                                  })
                                }
                              >
                                <CheckCircle2 className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Delete"
                                onClick={() => remove.mutate(task.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="space-y-3 md:hidden">
                {tasks.map((task) => {
                  const isOverdue =
                    task.due_at &&
                    !["completed", "cancelled"].includes(task.status) &&
                    isPast(new Date(task.due_at));
                  return (
                    <Card key={task.id} className="space-y-4 p-4">
                      <button
                        className="block w-full text-left"
                        onClick={() =>
                          setForm({
                            id: task.id,
                            title: task.title,
                            description: task.description ?? "",
                            due_at: task.due_at ? task.due_at.slice(0, 16) : "",
                            priority: task.priority,
                            status: task.status,
                          })
                        }
                      >
                        <p className="break-words font-medium">{task.title}</p>
                        <p className="mt-1 line-clamp-3 break-words text-sm text-muted-foreground">
                          {task.description || "No description"}
                        </p>
                      </button>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge variant="outline">{task.priority}</Badge>
                        <span
                          className={
                            isOverdue
                              ? "text-rose-600"
                              : "text-muted-foreground"
                          }
                        >
                          {task.due_at
                            ? format(new Date(task.due_at), "PPp")
                            : "No due date"}
                        </span>
                      </div>
                      <Select
                        value={task.status}
                        onValueChange={(status) =>
                          updateStatus.mutate({
                            id: task.id,
                            status: status as TaskForm["status"],
                          })
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TASK_STATUSES.map((taskStatus) => (
                            <SelectItem key={taskStatus} value={taskStatus}>
                              {taskStatus.replace(/_/g, " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          variant="outline"
                          onClick={() =>
                            updateStatus.mutate({
                              id: task.id,
                              status: "completed",
                            })
                          }
                        >
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                          Complete
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => remove.mutate(task.id)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
