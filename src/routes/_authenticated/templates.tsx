import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  listTemplates,
  upsertTemplate,
  deleteTemplate,
} from "@/lib/crm.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  DataCard,
  EmptyState,
  FormPanel,
  MetricStrip,
  PageHeader,
  PageShell,
} from "@/components/crm-ui";
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
      qc.invalidateQueries({ queryKey: ["sidebar-counters"] });
    },
  });
  const rm = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      qc.invalidateQueries({ queryKey: ["sidebar-counters"] });
    },
  });

  return (
    <PageShell>
      <PageHeader
        title="Email templates"
        description="Reusable replies for common sales conversations."
      >
        <MetricStrip items={[{ label: "Saved templates", value: ts.length }]} />
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <FormPanel
          icon={Mail}
          title="New template"
          description="HTML is supported for rich replies."
        >
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
        </FormPanel>
        {ts.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No templates yet"
            description="Saved templates appear here."
            className="h-fit"
          />
        ) : (
          <DataCard className="h-fit">
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
          </DataCard>
        )}
      </div>
    </PageShell>
  );
}
