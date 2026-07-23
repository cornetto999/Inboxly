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
  EmptyState,
  MetricStrip,
  PageHeader,
  PageShell,
  ToolbarCard,
} from "@/components/crm-ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowUpRight,
  Building2,
  Mail,
  Search,
  Trash2,
  Users,
} from "lucide-react";
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
  new: "border-sky-500/20 bg-sky-500/10 text-sky-700",
  contacted: "border-amber-500/20 bg-amber-500/10 text-amber-700",
  follow_up: "border-indigo-500/20 bg-indigo-500/10 text-indigo-700",
  won: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700",
  lost: "border-rose-500/20 bg-rose-500/10 text-rose-700",
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
      qc.invalidateQueries({ queryKey: ["sidebar-counters"] });
    },
  });

  return (
    <PageShell>
      <PageHeader
        title="Leads"
        description={`${filtered.length} shown from ${leads.length} total`}
      >
        <MetricStrip
          items={[
            {
              label: "Won",
              value: leads.filter((lead) => lead.status === "won").length,
            },
            {
              label: "Follow-up",
              value: leads.filter((lead) => lead.status === "follow_up").length,
            },
          ]}
        />
      </PageHeader>

      <ToolbarCard>
        <div className="flex flex-wrap items-center gap-3">
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
      </ToolbarCard>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No leads"
          description="Convert emails from your inbox to create leads."
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-16 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <Link
                        to="/leads/$id"
                        params={{ id: l.id }}
                        className="group flex min-w-[220px] items-center gap-3"
                      >
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">
                          {(l.name || l.email).slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1 font-medium group-hover:text-primary">
                            <span className="truncate">
                              {l.name || l.email}
                            </span>
                            <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                          </div>
                          <div className="flex items-center gap-1 truncate text-sm text-muted-foreground">
                            <Mail className="h-3.5 w-3.5" />
                            <span className="truncate">{l.email}</span>
                          </div>
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <div className="flex min-w-[140px] items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        <span className="truncate">
                          {l.company || "Unassigned"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {format(new Date(l.created_at), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={l.status}
                        onValueChange={(v) =>
                          updMut.mutate({
                            id: l.id,
                            status: v as (typeof STATUSES)[number],
                          })
                        }
                      >
                        <SelectTrigger className="w-40 border-transparent bg-transparent shadow-none hover:bg-muted">
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
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${l.name || l.email}`}
                        onClick={() =>
                          confirm("Delete lead?") && delMut.mutate(l.id)
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-3 md:hidden">
            {filtered.map((lead) => (
              <Card key={lead.id} className="space-y-4 p-4">
                <Link
                  to="/leads/$id"
                  params={{ id: lead.id }}
                  className="flex min-w-0 items-center gap-3"
                >
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">
                    {(lead.name || lead.email).slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {lead.name || lead.email}
                    </p>
                    <p className="break-all text-sm text-muted-foreground">
                      {lead.email}
                    </p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0" />
                </Link>
                <div className="grid gap-2 text-sm">
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-4 w-4 shrink-0" />
                    <span className="break-words">
                      {lead.company || "Unassigned"}
                    </span>
                  </p>
                  <p className="text-muted-foreground">
                    Created {format(new Date(lead.created_at), "MMM d, yyyy")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={lead.status}
                    onValueChange={(value) =>
                      updMut.mutate({
                        id: lead.id,
                        status: value as LeadStatus,
                      })
                    }
                  >
                    <SelectTrigger className="min-w-0 flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((leadStatus) => (
                        <SelectItem key={leadStatus} value={leadStatus}>
                          {STATUS_LABEL[leadStatus]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label={`Delete ${lead.name || lead.email}`}
                    onClick={() =>
                      confirm("Delete lead?") && delMut.mutate(lead.id)
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </PageShell>
  );
}
