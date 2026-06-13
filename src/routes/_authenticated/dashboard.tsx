import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getDashboardStats } from "@/lib/crm.functions";
import { getErrorMessage, toError } from "@/lib/errors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowUpRight,
  Users,
  UserPlus,
  Bell,
  Trophy,
  XCircle,
  UserCheck,
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
      label: "Total Leads",
      value: data.totalLeads,
      Icon: Users,
      color: "text-blue-500",
      to: "/leads",
      status: undefined,
    },
    {
      label: "New Leads",
      value: data.newLeads,
      Icon: UserPlus,
      color: "text-cyan-500",
      to: "/leads",
      status: "new",
    },
    {
      label: "Follow-ups Due",
      value: data.followUpsDue,
      Icon: Bell,
      color: "text-amber-500",
      to: "/reminders",
      status: undefined,
    },
    {
      label: "Won",
      value: data.wonCustomers,
      Icon: Trophy,
      color: "text-emerald-500",
      to: "/leads",
      status: "won",
    },
    {
      label: "Lost",
      value: data.lostCustomers,
      Icon: XCircle,
      color: "text-rose-500",
      to: "/leads",
      status: "lost",
    },
    {
      label: "Active Customers",
      value: data.activeCustomers,
      Icon: UserCheck,
      color: "text-violet-500",
      to: "/customers",
      status: undefined,
    },
  ] as const;

  const renderCard = ({
    label,
    value,
    Icon,
    color,
  }: (typeof cards)[number]) => (
    <Card className="h-full cursor-pointer transition-colors transition-shadow hover:border-primary/40 hover:bg-muted/40 hover:shadow-md group-focus-visible:border-primary/40 group-focus-visible:bg-muted/40 group-focus-visible:shadow-md">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <div className="flex items-center gap-2">
          <Icon className={`h-5 w-5 ${color}`} />
          <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Your CRM at a glance.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => {
          const linkClassName =
            "group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

          if (card.to === "/leads") {
            return (
              <Link
                key={card.label}
                to="/leads"
                search={card.status ? { status: card.status } : undefined}
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
    </div>
  );
}
