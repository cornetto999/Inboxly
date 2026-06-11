import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminListUsers, adminListActivity, adminSetRole } from "@/lib/crm.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

  const { data: users = [], error: ue } = useQuery({ queryKey: ["admin-users"], queryFn: () => usersFn() });
  const { data: activity = [] } = useQuery({ queryKey: ["admin-activity"], queryFn: () => actFn() });

  const roleMut = useMutation({
    mutationFn: (v: { user_id: string; role: "admin" | "staff"; grant: boolean }) => setRole({ data: v }),
    onSuccess: () => { toast.success("Role updated"); qc.invalidateQueries({ queryKey: ["admin-users"] }); },
  });

  if (ue) return <div className="p-8 text-destructive">{(ue as Error).message}</div>;

  return (
    <div className="p-6 lg:p-8">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Admin Console</h1>
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Users ({users.length})</TabsTrigger>
          <TabsTrigger value="activity">Activity ({activity.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <Card>
            <div className="divide-y">
              {users.map((u) => {
                const isAdmin = u.roles.includes("admin");
                return (
                  <div key={u.id} className="flex items-center gap-3 p-4">
                    <div className="flex-1">
                      <div className="font-medium">{u.full_name || u.email}</div>
                      <div className="text-sm text-muted-foreground">{u.email}</div>
                    </div>
                    <div className="flex gap-1">{u.roles.map((r) => <Badge key={r} variant="secondary">{r}</Badge>)}</div>
                    <Button size="sm" variant="outline" onClick={() => roleMut.mutate({ user_id: u.id, role: "admin", grant: !isAdmin })}>
                      {isAdmin ? "Revoke admin" : "Make admin"}
                    </Button>
                  </div>
                );
              })}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <Card>
            <div className="divide-y">
              {activity.map((a) => (
                <div key={a.id} className="flex items-center justify-between p-3 text-sm">
                  <div>
                    <span className="font-medium">{a.action.replace(/_/g, " ")}</span>
                    <span className="ml-2 text-muted-foreground">{a.entity_type}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{format(new Date(a.created_at), "PPp")}</span>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
