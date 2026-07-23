import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Inbox,
  Users,
  UserCheck,
  Bell,
  FileText,
  Megaphone,
  ContactRound,
  ListTodo,
  ChartNoAxesCombined,
  UserCog,
  Settings,
  Shield,
  LogOut,
  Sparkles,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { getSidebarCounters } from "@/lib/crm.functions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";

const nav = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Inbox", url: "/inbox", icon: Inbox, counter: "inbox" },
  { title: "Leads", url: "/leads", icon: Users, counter: "leads" },
  {
    title: "Customers",
    url: "/customers",
    icon: UserCheck,
    counter: "customers",
  },
  { title: "Reminders", url: "/reminders", icon: Bell, counter: "reminders" },
  {
    title: "Templates",
    url: "/templates",
    icon: FileText,
    counter: "templates",
  },
  {
    title: "Campaigns",
    url: "/campaigns",
    icon: Megaphone,
    counter: "campaigns",
  },
  {
    title: "Contacts",
    url: "/contacts",
    icon: ContactRound,
    counter: "contacts",
  },
  { title: "Tasks", url: "/tasks", icon: ListTodo, counter: "tasks" },
  { title: "Reports", url: "/reports", icon: ChartNoAxesCombined },
  { title: "Team", url: "/team", icon: UserCog },
  { title: "Settings", url: "/settings", icon: Settings },
];

type CounterKey =
  | "inbox"
  | "leads"
  | "customers"
  | "reminders"
  | "templates"
  | "contacts"
  | "tasks"
  | "campaigns";

const counterDescriptions: Record<CounterKey, string> = {
  inbox: "unread emails",
  leads: "leads",
  customers: "customers",
  reminders: "open reminders",
  templates: "templates",
  campaigns: "active campaigns",
  contacts: "contacts",
  tasks: "open tasks",
};

export function AppSidebar({ isAdmin }: { isAdmin: boolean }) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const countersFn = useServerFn(getSidebarCounters);
  const [email, setEmail] = useState<string>("");
  const {
    data: counters,
    isLoading: countersLoading,
    isError: countersError,
  } = useQuery({
    queryKey: ["sidebar-counters"],
    queryFn: () => countersFn(),
    refetchInterval: 30000,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    retry: false,
  });

  useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const isActive = (url: string) =>
    pathname === url || (url !== "/dashboard" && pathname.startsWith(url));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-3 border-b border-sidebar-border p-3">
        <Link
          to="/dashboard"
          className="flex h-11 items-center gap-2 rounded-lg px-2 font-semibold text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
            <Inbox className="h-4 w-4" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <span className="block leading-tight">Inboxly</span>
              <span className="flex items-center gap-1 text-xs font-normal text-sidebar-foreground/65">
                <Sparkles className="h-3 w-3" />
                Gmail CRM
              </span>
            </div>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-4 px-2 py-3">
        <SidebarGroup className="p-0">
          <SidebarGroupLabel className="px-3 text-[0.7rem] font-semibold uppercase text-sidebar-foreground/55">
            Workspace
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => {
                const counterKey = item.counter as CounterKey | undefined;
                const counterValue = counterKey
                  ? counters?.[counterKey]
                  : undefined;
                const counterText = countersLoading
                  ? "…"
                  : countersError
                    ? "!"
                    : counterValue === null
                      ? "—"
                      : (counterValue ?? "…");
                const counterDescription = counterKey
                  ? counterDescriptions[counterKey]
                  : "";

                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive(item.url)}
                      tooltip={item.title}
                      className="h-10 rounded-lg px-3 text-sidebar-foreground/82 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-primary data-[active=true]:font-semibold data-[active=true]:text-sidebar-primary-foreground data-[active=true]:shadow-sm"
                    >
                      {item.url === "/inbox" ? (
                        <Link to="/inbox" search={{ status: "all" }}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                          {!collapsed && counterKey && (
                            <Badge
                              variant="secondary"
                              className="ml-auto h-5 rounded-full bg-sidebar-accent px-2 text-sidebar-accent-foreground"
                              title={
                                counterValue === null
                                  ? `${item.title} is unavailable until the database migration is applied`
                                  : `${counterText} ${counterDescription}`
                              }
                              aria-label={`${counterText} ${counterDescription}`}
                            >
                              {counterText}
                            </Badge>
                          )}
                        </Link>
                      ) : (
                        <Link to={item.url}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                          {!collapsed && counterKey && (
                            <Badge
                              variant="secondary"
                              className="ml-auto h-5 rounded-full bg-sidebar-accent px-2 text-sidebar-accent-foreground"
                              title={
                                counterValue === null
                                  ? `${item.title} is unavailable until the database migration is applied`
                                  : `${counterText} ${counterDescription}`
                              }
                              aria-label={`${counterText} ${counterDescription}`}
                            >
                              {counterText}
                            </Badge>
                          )}
                        </Link>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup className="p-0">
            <SidebarGroupLabel className="px-3 text-[0.7rem] font-semibold uppercase text-sidebar-foreground/55">
              Admin
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive("/admin")}
                    tooltip="Admin Console"
                    className="h-10 rounded-lg px-3 text-sidebar-foreground/82 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-primary data-[active=true]:font-semibold data-[active=true]:text-sidebar-primary-foreground data-[active=true]:shadow-sm"
                  >
                    <Link to="/admin">
                      <Shield className="h-4 w-4" />
                      <span>Admin Console</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        {!collapsed && (
          <div className="rounded-lg bg-sidebar-accent/70 px-3 py-2">
            <div className="text-xs font-medium text-sidebar-foreground">
              Signed in
            </div>
            <div className="truncate text-xs text-sidebar-foreground/65">
              {email}
            </div>
          </div>
        )}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={signOut}
              tooltip="Sign out"
              className="h-10 rounded-lg px-3 text-sidebar-foreground/82 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
