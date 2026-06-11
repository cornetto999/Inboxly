import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listCustomers } from "@/lib/crm.functions";
import { Card } from "@/components/ui/card";
import { UserCheck } from "lucide-react";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/customers/")({
  head: () => ({ meta: [{ title: "Customers — Inboxly" }] }),
  component: CustomersPage,
});

function CustomersPage() {
  const fn = useServerFn(listCustomers);
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: () => fn() });

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
        <p className="text-sm text-muted-foreground">{customers.length} total</p>
      </div>
      {customers.length === 0 ? (
        <Card className="p-12 text-center">
          <UserCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="font-medium">No customers yet</p>
          <p className="text-sm text-muted-foreground">Convert leads or emails into customers.</p>
        </Card>
      ) : (
        <Card>
          <div className="divide-y">
            {customers.map((c) => (
              <Link key={c.id} to="/customers/$id" params={{ id: c.id }} className="flex items-center gap-3 p-4 hover:bg-muted/50">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{c.name || c.email}</div>
                  <div className="text-sm text-muted-foreground truncate">{c.email}{c.company ? ` · ${c.company}` : ""}</div>
                </div>
                <div className="text-xs text-muted-foreground">{format(new Date(c.created_at), "MMM d, yyyy")}</div>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
