import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getDashboardStats } from "@/lib/crm.functions";
import { getErrorMessage, toError } from "@/lib/errors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowUpRight,
  Users,
  UserPlus,
  Bell,
  Trophy,
  XCircle,
  UserCheck,
  Inbox,
  Mail,
  Activity,
  Send,
  ListTodo,
  Megaphone,
  AlertTriangle,
  Percent,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Inboxly" }] }),
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ["dashboard"],
      queryFn: async () => {
        try {
          return await getDashboardStats();
        } catch (error) {
          throw toError(error, "Unable to load dashboard.");
        }
      },
    }),
  errorComponent: ({ error }) => (
    <div className="p-8 text-destructive">
      {getErrorMessage(error, "Unable to load dashboard.")}
    </div>
  ),
  component: Dashboard,
});

function Dashboard() {
  const fn = useServerFn(getDashboardStats);
  const { data } = useSuspenseQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      try {
        return await fn();
      } catch (error) {
        throw toError(error, "Unable to load dashboard.");
      }
    },
  });

  const cards = [
    {
      label: "Unread Emails",
      value: data.unreadEmails,
      Icon: Mail,
      color: "text-orange-600",
      tone: "bg-orange-500/10",
      to: "/inbox",
      status: "unread",
    },
    {
      label: "Received Today",
      value: data.emailsReceivedToday,
      Icon: Inbox,
      color: "text-indigo-600",
      tone: "bg-indigo-500/10",
      to: "/inbox",
      status: undefined,
    },
    {
      label: "Sent Today",
      value: data.emailsSentToday,
      Icon: Send,
      color: "text-cyan-600",
      tone: "bg-cyan-500/10",
      to: "/inbox",
      status: "sent",
    },
    {
      label: "New Leads",
      value: data.newLeads,
      Icon: UserPlus,
      color: "text-sky-600",
      tone: "bg-sky-500/10",
      to: "/leads",
      status: "new",
    },
    {
      label: "Active Leads",
      value: data.activeLeads,
      Icon: Users,
      color: "text-primary",
      tone: "bg-primary/10",
      to: "/leads",
      status: undefined,
    },
    {
      label: "Customers",
      value: data.activeCustomers,
      Icon: UserCheck,
      color: "text-teal-600",
      tone: "bg-teal-500/10",
      to: "/customers",
      status: undefined,
    },
    {
      label: "Due Today",
      value: data.followUpsDue,
      Icon: Bell,
      color: "text-amber-600",
      tone: "bg-amber-500/10",
      to: "/reminders",
      status: undefined,
    },
    {
      label: "Overdue",
      value: data.overdueReminders,
      Icon: AlertTriangle,
      color: "text-rose-600",
      tone: "bg-rose-500/10",
      to: "/reminders",
      status: undefined,
    },
    {
      label: "Pending Tasks",
      value: data.pendingTasks,
      Icon: ListTodo,
      color: "text-violet-600",
      tone: "bg-violet-500/10",
      to: "/tasks",
      status: undefined,
    },
    {
      label: "Campaigns",
      value: data.activeCampaigns,
      Icon: Megaphone,
      color: "text-fuchsia-600",
      tone: "bg-fuchsia-500/10",
      to: "/campaigns",
      status: undefined,
    },
    {
      label: "Response Rate",
      value: `${data.responseRate}%`,
      Icon: Percent,
      color: "text-emerald-600",
      tone: "bg-emerald-500/10",
      to: "/reports",
      status: undefined,
    },
    {
      label: "Conversion Rate",
      value: `${data.leadConversionRate}%`,
      Icon: Trophy,
      color: "text-lime-700",
      tone: "bg-lime-500/10",
      to: "/reports",
      status: undefined,
    },
    {
      label: "Lost Leads",
      value: data.lostCustomers,
      Icon: XCircle,
      color: "text-slate-600",
      tone: "bg-slate-500/10",
      to: "/leads",
      status: "lost",
    },
  ] as const;

  const renderCard = ({
    label,
    value,
    Icon,
    color,
    tone,
  }: (typeof cards)[number]) => (
    <Card className="h-full cursor-pointer border-border/80 transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md group-focus-visible:-translate-y-0.5 group-focus-visible:border-primary/35 group-focus-visible:shadow-md">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <div className="flex items-center gap-2">
          <span
            className={`grid h-9 w-9 place-items-center rounded-lg ${tone}`}
          >
            <Icon className={`h-4 w-4 ${color}`} />
          </span>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-3xl font-bold tabular-nums">{value}</div>
        <p className="text-xs text-muted-foreground">
          Open {label.toLowerCase()}
        </p>
      </CardContent>
    </Card>
  );

  return (
    <div className="mx-auto max-w-7xl p-5 lg:p-8">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <Badge variant="outline" className="mb-3 bg-card">
            <Activity className="mr-1 h-3 w-3 text-primary" />
            Live CRM overview
          </Badge>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Pipeline, inbox, and follow-up health at a glance.
          </p>
        </div>
        <div className="rounded-lg border bg-card px-4 py-3 text-sm shadow-sm">
          <span className="text-muted-foreground">Active customers</span>
          <span className="ml-3 font-semibold tabular-nums">
            {data.activeCustomers}
          </span>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => {
          const linkClassName =
            "group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

          if (card.to === "/leads") {
            return (
              <Link
                key={card.label}
                to="/leads"
                search={{ status: card.status }}
                aria-label={`Open ${card.label}`}
                className={linkClassName}
              >
                {renderCard(card)}
              </Link>
            );
          }

          if (card.to === "/inbox") {
            return (
              <Link
                key={card.label}
                to="/inbox"
                search={{
                  status: card.status === "unread" ? "unread" : "all",
                }}
                aria-label={`Open ${card.label}`}
                className={linkClassName}
              >
                {renderCard(card)}
              </Link>
            );
          }

          return (
            <Link
              key={card.label}
              to={card.to}
              aria-label={`Open ${card.label}`}
              className={linkClassName}
            >
              {renderCard(card)}
            </Link>
          );
        })}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <MiniChart
          title="Emails received and sent"
          values={data.chartData.emailsByDay}
        />
        <MiniChart
          title="Leads by status"
          values={data.chartData.leadsByStatus}
        />
        <MiniChart title="Lead sources" values={data.chartData.leadSources} />
        <MiniChart
          title="Customer growth"
          values={data.chartData.customerGrowth}
        />
      </div>
    </div>
  );
}

function MiniChart({
  title,
  values,
}: {
  title: string;
  values: Record<string, number | { received: number; sent: number }>;
}) {
  const entries = Object.entries(values);
  const max = Math.max(
    ...entries.map(([, value]) =>
      typeof value === "number" ? value : value.received + value.sent,
    ),
    1,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No records yet.</p>
        ) : (
          entries.slice(-8).map(([label, value]) => {
            const total =
              typeof value === "number" ? value : value.received + value.sent;
            return (
              <div key={label} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="capitalize">{label.replace(/_/g, " ")}</span>
                  <span className="font-medium tabular-nums">
                    {typeof value === "number"
                      ? value
                      : `${value.received}/${value.sent}`}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-primary"
                    style={{ width: `${Math.max((total / max) * 100, 4)}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
