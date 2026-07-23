import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  adminListUsers,
  adminListActivity,
  adminSetRole,
} from "@/lib/crm.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataCard, PageHeader, PageShell } from "@/components/crm-ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin — Inboxly" }] }),
  component: AdminPage,
});

function AdminPage() {
  const qc = useQueryClient();
  const usersFn = useServerFn(adminListUsers);
  const actFn = useServerFn(adminListActivity);
  const setRole = useServerFn(adminSetRole);

  const { data: users = [], error: ue } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => usersFn(),
  });
  const { data: activity = [] } = useQuery({
    queryKey: ["admin-activity"],
    queryFn: () => actFn(),
  });

  const roleMut = useMutation({
    mutationFn: (v: {
      user_id: string;
      role: "admin" | "staff";
      grant: boolean;
    }) => setRole({ data: v }),
    onSuccess: () => {
      toast.success("Role updated");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });

  if (ue)
    return (
      <PageShell>
        <div className="text-destructive">{(ue as Error).message}</div>
      </PageShell>
    );

  return (
    <PageShell>
      <PageHeader
        title="Admin Console"
        description="Manage user access and audit recent CRM activity."
      />
      <Tabs defaultValue="users" className="space-y-4">
        <TabsList className="h-10 bg-card shadow-sm">
          <TabsTrigger value="users">Users ({users.length})</TabsTrigger>
          <TabsTrigger value="activity">
            Activity ({activity.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead className="text-right">Access</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => {
                const isAdmin = u.roles.includes("admin");
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="flex min-w-[220px] items-center gap-3">
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">
                          {(u.full_name || u.email).slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {u.full_name || u.email}
                          </div>
                          <div className="truncate text-sm text-muted-foreground">
                            {u.email}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {u.roles.map((r) => (
                          <Badge key={r} variant="secondary">
                            {r}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant={isAdmin ? "outline" : "default"}
                        onClick={() =>
                          roleMut.mutate({
                            user_id: u.id,
                            role: "admin",
                            grant: !isAdmin,
                          })
                        }
                      >
                        {isAdmin ? "Revoke admin" : "Make admin"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="activity">
          <DataCard>
            <div className="divide-y divide-border">
              {activity.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-4 p-4 text-sm"
                >
                  <div>
                    <div className="font-medium capitalize">
                      {a.action.replace(/_/g, " ")}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {a.entity_type}
                    </div>
                  </div>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {format(new Date(a.created_at), "PPp")}
                  </span>
                </div>
              ))}
            </div>
          </DataCard>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
