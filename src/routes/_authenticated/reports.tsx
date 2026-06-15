import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getReportsData } from "@/lib/crm.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartNoAxesCombined } from "lucide-react";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Reports - Inboxly" }] }),
  component: ReportsPage,
});

function ReportsPage() {
  const reportsFn = useServerFn(getReportsData);
  const { data } = useQuery({
    queryKey: ["reports"],
    queryFn: () => reportsFn(),
  });

  const totals = data?.totals ?? {
    emails: 0,
    unreadEmails: 0,
    leads: 0,
    customers: 0,
    reminders: 0,
    tasks: 0,
    campaigns: 0,
  };

  return (
    <div className="mx-auto max-w-7xl p-5 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Database-backed CRM performance snapshots.
        </p>
      </div>

      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Emails", totals.emails],
          ["Unread", totals.unreadEmails],
          ["Leads", totals.leads],
          ["Customers", totals.customers],
          ["Tasks", totals.tasks],
          ["Campaigns", totals.campaigns],
          ["Campaign sent", data?.campaignTotals.sent ?? 0],
          ["Campaign replies", data?.campaignTotals.replies ?? 0],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tabular-nums">{value}</div>
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
    </div>
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
