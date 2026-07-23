import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listCustomers } from "@/lib/crm.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { ArrowUpRight, Building2, Mail, Search, UserCheck } from "lucide-react";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/customers/")({
  head: () => ({ meta: [{ title: "Customers — Inboxly" }] }),
  component: CustomersPage,
});

function CustomersPage() {
  const fn = useServerFn(listCustomers);
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => fn(),
  });
  const [search, setSearch] = useState("");
  const filtered = customers.filter((customer) =>
    `${customer.name ?? ""} ${customer.email} ${customer.company ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  return (
    <PageShell>
      <PageHeader
        title="Customers"
        description={`${filtered.length} shown from ${customers.length} total`}
      >
        <MetricStrip
          items={[{ label: "Active accounts", value: customers.length }]}
        />
      </PageHeader>

      <ToolbarCard>
        <div className="relative max-w-xl">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search customers"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </ToolbarCard>

      {filtered.length === 0 ? (
        <EmptyState
          icon={UserCheck}
          title="No customers yet"
          description="Convert leads or emails into customers."
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link
                        to="/customers/$id"
                        params={{ id: c.id }}
                        className="group flex min-w-[220px] items-center gap-3"
                      >
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">
                          {(c.name || c.email).slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1 font-medium group-hover:text-primary">
                            <span className="truncate">
                              {c.name || c.email}
                            </span>
                            <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                          </div>
                          <div className="flex items-center gap-1 truncate text-sm text-muted-foreground">
                            <Mail className="h-3.5 w-3.5" />
                            <span className="truncate">{c.email}</span>
                          </div>
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <div className="flex min-w-[140px] items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        <span className="truncate">
                          {c.company || "Unassigned"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="border-emerald-500/20 bg-emerald-500/10 text-emerald-700"
                      >
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {format(new Date(c.created_at), "MMM d, yyyy")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-3 md:hidden">
            {filtered.map((customer) => (
              <Card key={customer.id} className="p-4">
                <Link
                  to="/customers/$id"
                  params={{ id: customer.id }}
                  className="flex min-w-0 items-center gap-3"
                >
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">
                    {(customer.name || customer.email)
                      .slice(0, 1)
                      .toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {customer.name || customer.email}
                    </p>
                    <p className="break-all text-sm text-muted-foreground">
                      {customer.email}
                    </p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0" />
                </Link>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                    <Building2 className="h-4 w-4 shrink-0" />
                    <span className="break-words">
                      {customer.company || "Unassigned"}
                    </span>
                  </span>
                  <Badge
                    variant="outline"
                    className="border-emerald-500/20 bg-emerald-500/10 text-emerald-700"
                  >
                    {customer.status}
                  </Badge>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Created {format(new Date(customer.created_at), "MMM d, yyyy")}
                </p>
              </Card>
            ))}
          </div>
        </>
      )}
    </PageShell>
  );
}
