import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getReportDrilldown, getReportsData } from "@/lib/crm.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, PageShell } from "@/components/crm-ui";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowUpRight, ChartNoAxesCombined, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Reports - Inboxly" }] }),
  component: ReportsPage,
});

type ReportKind =
  | "emails"
  | "unreadEmails"
  | "leads"
  | "customers"
  | "reminders"
  | "tasks"
  | "campaigns"
  | "campaignSent"
  | "campaignReplies"
  | "contacts"
  | "templates";

function ReportsPage() {
  const reportsFn = useServerFn(getReportsData);
  const drilldownFn = useServerFn(getReportDrilldown);
  const [selectedKind, setSelectedKind] = useState<ReportKind | null>(null);
  const { data } = useQuery({
    queryKey: ["reports"],
    queryFn: () => reportsFn(),
  });
  const {
    data: drilldown,
    isFetching: drilldownLoading,
    error: drilldownError,
  } = useQuery({
    queryKey: ["report-drilldown", selectedKind],
    queryFn: () => drilldownFn({ data: { kind: selectedKind! } }),
    enabled: !!selectedKind,
  });

  const totals = data?.totals ?? {
    emails: 0,
    unreadEmails: 0,
    leads: 0,
    customers: 0,
    reminders: 0,
    tasks: 0,
    campaigns: 0,
    contacts: 0,
    templates: 0,
  };
  const reportCards: { label: string; value: number; kind: ReportKind }[] = [
    { label: "Emails", value: totals.emails, kind: "emails" },
    { label: "Unread", value: totals.unreadEmails, kind: "unreadEmails" },
    { label: "Leads", value: totals.leads, kind: "leads" },
    { label: "Customers", value: totals.customers, kind: "customers" },
    { label: "Reminders", value: totals.reminders, kind: "reminders" },
    { label: "Tasks", value: totals.tasks, kind: "tasks" },
    { label: "Campaigns", value: totals.campaigns, kind: "campaigns" },
    { label: "Contacts", value: totals.contacts, kind: "contacts" },
    { label: "Templates", value: totals.templates, kind: "templates" },
    {
      label: "Campaign sent",
      value: data?.campaignTotals.sent ?? 0,
      kind: "campaignSent",
    },
    {
      label: "Campaign replies",
      value: data?.campaignTotals.replies ?? 0,
      kind: "campaignReplies",
    },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Reports"
        description="Database-backed CRM performance snapshots."
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {reportCards.map(({ label, value, kind }) => (
          <Card
            key={kind}
            role="button"
            tabIndex={0}
            className="cursor-pointer outline-none transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setSelectedKind(kind)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setSelectedKind(kind);
              }
            }}
          >
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between gap-2 text-sm font-medium text-muted-foreground">
                {label}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tabular-nums">{value}</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Click to view table
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <BarChartCard
          title="Leads by status"
          values={data?.leadsByStatus ?? {}}
        />
        <BarChartCard
          title="Tasks by status"
          values={data?.tasksByStatus ?? {}}
        />
        <BarChartCard
          title="Tasks by priority"
          values={data?.tasksByPriority ?? {}}
        />
        <BarChartCard
          title="Contacts by source"
          values={data?.contactsBySource ?? {}}
        />
      </div>

      <Dialog
        open={!!selectedKind}
        onOpenChange={(open) => !open && setSelectedKind(null)}
      >
        <DialogContent className="flex h-[100dvh] w-full max-w-none flex-col overflow-hidden rounded-none p-0 sm:h-[88dvh] sm:w-[calc(100%-2rem)] sm:max-w-6xl sm:rounded-lg">
          <DialogHeader className="border-b px-4 py-4 pr-12 text-left sm:px-6 sm:py-5">
            <DialogTitle>{drilldown?.title ?? "Report details"}</DialogTitle>
            <DialogDescription>
              Latest matching records, updated automatically when CRM data
              changes.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="min-h-0 flex-1">
            <div className="p-3 sm:p-6">
              {drilldownLoading ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading table...
                </div>
              ) : drilldownError ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                  {drilldownError instanceof Error
                    ? drilldownError.message
                    : "Unable to load this report table."}
                </div>
              ) : !drilldown || drilldown.rows.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  No records found for this report.
                </div>
              ) : (
                <div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {drilldown.columns.map((column) => (
                          <TableHead key={column}>{column}</TableHead>
                        ))}
                        <TableHead className="w-24 text-right">Open</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {drilldown.rows.map((row) => (
                        <TableRow key={row.id}>
                          {row.values.map((value, index) => (
                            <TableCell
                              key={`${row.id}-${drilldown.columns[index]}`}
                              className={index === 0 ? "font-medium" : ""}
                            >
                              {value}
                            </TableCell>
                          ))}
                          <TableCell className="text-right">
                            {row.href ? (
                              <Button size="sm" variant="ghost" asChild>
                                <a href={row.href}>Open</a>
                              </Button>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function BarChartCard({
  title,
  values,
}: {
  title: string;
  values: Record<string, number>;
}) {
  const entries = Object.entries(values);
  const max = Math.max(...entries.map(([, value]) => value), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ChartNoAxesCombined className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No records yet.</p>
        ) : (
          entries.map(([label, value]) => (
            <div key={label} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="capitalize">{label.replace(/_/g, " ")}</span>
                <span className="font-medium tabular-nums">{value}</span>
              </div>
              <div className="h-2 rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-primary"
                  style={{ width: `${Math.max((value / max) * 100, 4)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
