import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminSetRole, getMyRole, listTeamMembers } from "@/lib/crm.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  MetricStrip,
  PageHeader,
  PageShell,
} from "@/components/crm-ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ShieldCheck, UserCog } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/team")({
  head: () => ({ meta: [{ title: "Team - Inboxly" }] }),
  component: TeamPage,
});

const ROLES = ["admin", "manager", "agent", "staff"] as const;

function TeamPage() {
  const qc = useQueryClient();
  const teamFn = useServerFn(listTeamMembers);
  const roleFn = useServerFn(getMyRole);
  const setRoleFn = useServerFn(adminSetRole);
  const { data: role } = useQuery({
    queryKey: ["my-role"],
    queryFn: () => roleFn(),
  });
  const { data: team = [] } = useQuery({
    queryKey: ["team"],
    queryFn: () => teamFn(),
  });

  const updateRole = useMutation({
    mutationFn: (data: {
      user_id: string;
      role: (typeof ROLES)[number];
      grant: boolean;
    }) => setRoleFn({ data }),
    onSuccess: () => {
      toast.success("Role updated");
      qc.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const canManage = Boolean(role?.isAdmin);

  return (
    <PageShell>
      <PageHeader
        title="Team"
        description="Roles are enforced by Supabase Row Level Security policies."
      >
        <MetricStrip items={[{ label: "Members", value: team.length }]} />
      </PageHeader>

      {team.length === 0 ? (
        <EmptyState
          icon={UserCog}
          title="No team members visible"
          description="Admins can view all users. Staff can view their own profile."
        />
      ) : (
        <div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead className="text-right">Manage roles</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="flex min-w-[220px] items-center gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">
                        {(member.full_name || member.email || "U")
                          .slice(0, 1)
                          .toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {member.full_name || member.email || member.id}
                        </div>
                        <div className="truncate text-sm text-muted-foreground">
                          {member.email || "Email private"}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(member.roles ?? []).map((roleName) => (
                        <Badge key={roleName} variant="secondary">
                          <ShieldCheck className="mr-1 h-3 w-3" />
                          {roleName}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-1">
                      {ROLES.map((roleName) => {
                        const hasRole = (member.roles ?? []).includes(roleName);
                        return (
                          <Button
                            key={roleName}
                            size="sm"
                            variant={hasRole ? "default" : "outline"}
                            disabled={!canManage || updateRole.isPending}
                            onClick={() =>
                              updateRole.mutate({
                                user_id: member.id,
                                role: roleName,
                                grant: !hasRole,
                              })
                            }
                          >
                            {roleName}
                          </Button>
                        );
                      })}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </PageShell>
  );
}
