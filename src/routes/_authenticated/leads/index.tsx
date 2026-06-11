import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { listLeads, updateLead, deleteLead } from "@/lib/crm.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

const STATUSES = ["new", "contacted", "follow_up", "won", "lost"] as const;
type LeadStatus = (typeof STATUSES)[number];

function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && STATUSES.includes(value as LeadStatus);
}

export const Route = createFileRoute("/_authenticated/leads/")({
  head: () => ({ meta: [{ title: "Leads — Inboxly" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    status: isLeadStatus(search.status) ? search.status : undefined,
  }),
  component: LeadsPage,
});

const STATUS_LABEL: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  follow_up: "Follow-up",
  won: "Won",
  lost: "Lost",
};
const STATUS_COLOR: Record<string, string> = {
  new: "bg-blue-500/10 text-blue-600",
  contacted: "bg-amber-500/10 text-amber-600",
  follow_up: "bg-purple-500/10 text-purple-600",
  won: "bg-emerald-500/10 text-emerald-600",
  lost: "bg-rose-500/10 text-rose-600",
};

function LeadsPage() {
  const qc = useQueryClient();
  const fn = useServerFn(listLeads);
  const upd = useServerFn(updateLead);
  const del = useServerFn(deleteLead);
  const { data: leads = [] } = useQuery({
    queryKey: ["leads"],
    queryFn: () => fn(),
  });
  const { status } = Route.useSearch();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(status ?? "all");

  useEffect(() => {
    setStatusFilter(status ?? "all");
  }, [status]);

  const filtered = leads.filter(
    (l) =>
      (statusFilter === "all" || l.status === statusFilter) &&
      (!search ||
        `${l.name ?? ""} ${l.email} ${l.company ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );

  const updMut = useMutation({
    mutationFn: (v: { id: string; status: (typeof STATUSES)[number] }) =>
      upd({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      toast.success("Lead deleted");
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Leads</h1>
        <p className="text-sm text-muted-foreground">{leads.length} total</p>
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search leads"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="font-medium">No leads</p>
          <p className="text-sm text-muted-foreground">
            Convert emails from your inbox to create leads.
          </p>
        </Card>
      ) : (
        <Card>
          <div className="divide-y">
            {filtered.map((l) => (
              <div key={l.id} className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <Link to="/leads/$id" params={{ id: l.id }} className="block">
                    <div className="font-medium hover:underline">
                      {l.name || l.email}
                    </div>
                    <div className="text-sm text-muted-foreground truncate">
                      {l.email}
                      {l.company ? ` · ${l.company}` : ""}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Created {format(new Date(l.created_at), "MMM d, yyyy")}
                    </div>
                  </Link>
                </div>
                <Select
                  value={l.status}
                  onValueChange={(v) =>
                    updMut.mutate({
                      id: l.id,
                      status: v as (typeof STATUSES)[number],
                    })
                  }
                >
                  <SelectTrigger className="w-36">
                    <Badge
                      className={STATUS_COLOR[l.status]}
                      variant="secondary"
                    >
                      {STATUS_LABEL[l.status]}
                    </Badge>
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => confirm("Delete lead?") && delMut.mutate(l.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
