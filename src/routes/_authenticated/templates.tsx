import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listTemplates, upsertTemplate, deleteTemplate } from "@/lib/crm.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Trash2, FileText } from "lucide-react";
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
  const { data: ts = [] } = useQuery({ queryKey: ["templates"], queryFn: () => list() });
  const [name, setName] = useState(""); const [subject, setSubject] = useState(""); const [body, setBody] = useState("");

  const add = useMutation({
    mutationFn: () => up({ data: { name, subject, body } }),
    onSuccess: () => { setName(""); setSubject(""); setBody(""); toast.success("Saved"); qc.invalidateQueries({ queryKey: ["templates"] }); },
  });
  const rm = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }),
  });

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Email templates</h1>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6 space-y-3">
          <h2 className="font-semibold">New template</h2>
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Subject</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          <div><Label>Body (HTML allowed)</Label><Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} /></div>
          <Button onClick={() => add.mutate()} disabled={!name || !subject || !body}>Save</Button>
        </Card>
        <Card className="p-4">
          {ts.length === 0 ? (
            <div className="p-8 text-center"><FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">No templates yet</p></div>
          ) : (
            <div className="divide-y">
              {ts.map((t) => (
                <div key={t.id} className="flex items-start gap-3 p-3">
                  <div className="flex-1">
                    <div className="font-medium">{t.name}</div>
                    <div className="text-sm text-muted-foreground">{t.subject}</div>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => rm.mutate(t.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
