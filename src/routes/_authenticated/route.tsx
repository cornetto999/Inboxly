import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getMyRole } from "@/lib/crm.functions";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AutoGmailSync } from "@/components/auto-gmail-sync";
import { RealtimeQuerySync } from "@/components/realtime-query-sync";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { user } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const getRole = useServerFn(getMyRole);
  const { data: isAdmin = false } = useQuery({
    queryKey: ["role", user.id, "admin"],
    queryFn: async () => {
      try {
        const role = await getRole();
        return role.isAdmin;
      } catch (error) {
        console.warn(
          "Unable to load admin role; defaulting to staff navigation.",
          error,
        );
        return false;
      }
    },
    retry: false,
  });

  const pageTitle = getPageTitle(pathname);

  return (
    <SidebarProvider>
      <AutoGmailSync />
      <RealtimeQuerySync />
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar isAdmin={isAdmin} />
        <div className="flex flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-3 border-b border-border/80 bg-background/85 px-4 backdrop-blur-xl lg:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <SidebarTrigger className="h-9 w-9 rounded-lg border border-border bg-card shadow-sm" />
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold text-foreground sm:text-base">
                  {pageTitle}
                </h1>
                <p className="hidden text-xs text-muted-foreground sm:block">
                  Inboxly workspace
                </p>
              </div>
            </div>
            <Badge
              variant="outline"
              className="hidden border-primary/20 bg-primary/10 text-primary sm:inline-flex"
            >
              {isAdmin ? "Admin" : "Staff"}
            </Badge>
          </header>
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function getPageTitle(pathname: string) {
  if (pathname.startsWith("/inbox")) return "Inbox";
  if (pathname.startsWith("/leads/")) return "Lead detail";
  if (pathname.startsWith("/leads")) return "Leads";
  if (pathname.startsWith("/customers/")) return "Customer detail";
  if (pathname.startsWith("/customers")) return "Customers";
  if (pathname.startsWith("/reminders")) return "Reminders";
  if (pathname.startsWith("/templates")) return "Templates";
  if (pathname.startsWith("/campaigns")) return "Campaigns";
  if (pathname.startsWith("/contacts")) return "Contacts";
  if (pathname.startsWith("/tasks")) return "Tasks";
  if (pathname.startsWith("/reports")) return "Reports";
  if (pathname.startsWith("/team")) return "Team";
  if (pathname.startsWith("/settings")) return "Settings";
  if (pathname.startsWith("/admin")) return "Admin Console";
  return "Dashboard";
}
