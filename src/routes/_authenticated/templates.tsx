import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  listTemplates,
  upsertTemplate,
  deleteTemplate,
} from "@/lib/crm.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Mail, Save, Trash2, FileText } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/templates")({
  head: () => ({ meta: [{ title: "Templates — Inboxly" }] }),
  component: TemplatesPage,
});

function TemplatesPage() {
  const qc = useQueryClient();
  const list = useServerFn(listTemplates);
  const up = useServerFn(upsertTemplate);
  const del = useServerFn(deleteTemplate);
  const { data: ts = [] } = useQuery({
    queryKey: ["templates"],
    queryFn: () => list(),
  });
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const add = useMutation({
    mutationFn: () => up({ data: { name, subject, body } }),
    onSuccess: () => {
      setName("");
      setSubject("");
      setBody("");
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["templates"] });
    },
  });
  const rm = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }),
  });

  return (
    <div className="mx-auto max-w-7xl p-5 lg:p-8">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Email templates</h1>
          <p className="text-sm text-muted-foreground">
            Reusable replies for common sales conversations.
          </p>
        </div>
        <div className="rounded-lg border bg-card px-4 py-3 text-sm shadow-sm">
          <span className="text-muted-foreground">Saved templates</span>
          <span className="ml-3 font-semibold tabular-nums">{ts.length}</span>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Card className="space-y-4 border-border/80 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold">New template</h2>
              <p className="text-xs text-muted-foreground">
                HTML is supported for rich replies.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Intro follow-up"
            />
          </div>
          <div className="space-y-2">
            <Label>Subject</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Re: quick follow-up"
            />
          </div>
          <div className="space-y-2">
            <Label>Body</Label>
            <Textarea
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write the reusable message..."
            />
          </div>
          <Button
            onClick={() => add.mutate()}
            disabled={!name || !subject || !body}
          >
            <Save className="h-4 w-4" />
            Save template
          </Button>
        </Card>
        <Card className="h-fit overflow-hidden border-border/80 shadow-sm">
          {ts.length === 0 ? (
            <div className="p-10 text-center">
              <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-lg bg-muted">
                <FileText className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="font-medium">No templates yet</p>
              <p className="text-sm text-muted-foreground">
                Saved templates appear here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {ts.map((t) => (
                <div
                  key={t.id}
                  className="flex items-start gap-3 p-4 transition-colors hover:bg-accent/45"
                >
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{t.name}</div>
                    <div className="truncate text-sm text-muted-foreground">
                      {t.subject}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Delete ${t.name}`}
                    onClick={() => rm.mutate(t.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
