import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";
import { consumeSupabaseUrlSession } from "@/lib/auth-url-session";
import { getErrorMessage, toError } from "@/lib/errors";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({
  error,
  reset,
}: {
  error: unknown;
  reset: () => void;
}) {
  const router = useRouter();
  const normalizedError = useMemo(() => toError(error), [error]);
  useEffect(() => {
    reportLovableError(normalizedError, {
      boundary: "tanstack_root_error_component",
    });
  }, [normalizedError]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {getErrorMessage(error)}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    head: () => ({
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "Inboxly — Email CRM" },
        {
          name: "description",
          content:
            "Turn your Gmail inbox into a working CRM with leads, customers, reminders, and templates.",
        },
        { property: "og:title", content: "Inboxly — Email CRM" },
        {
          property: "og:description",
          content: "Turn your Gmail inbox into a working CRM.",
        },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
      links: [{ rel: "stylesheet", href: appCss }],
    }),
    shellComponent: RootShell,
    component: RootComponent,
    notFoundComponent: NotFoundComponent,
    errorComponent: ErrorComponent,
  },
);

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (pathname === "/auth/callback") return;

    consumeSupabaseUrlSession()
      .then((didConsume) => {
        if (didConsume) {
          window.location.replace("/dashboard");
        }
      })
      .catch((error) => {
        reportLovableError(error, { boundary: "supabase_url_session" });
      });
  }, [pathname]);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (window.location.pathname === "/auth/callback") return;
      if (
        event !== "SIGNED_IN" &&
        event !== "SIGNED_OUT" &&
        event !== "USER_UPDATED"
      )
        return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  const shouldWaitForClientAuth = isClientAuthRoute(pathname);

  return (
    <QueryClientProvider client={queryClient}>
      {!shouldWaitForClientAuth || mounted ? <Outlet /> : null}
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}

function isClientAuthRoute(pathname: string) {
  return (
    pathname === "/auth" ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/campaigns") ||
    pathname.startsWith("/contacts") ||
    pathname.startsWith("/customers") ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/inbox") ||
    pathname.startsWith("/leads") ||
    pathname.startsWith("/reminders") ||
    pathname.startsWith("/reports") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/tasks") ||
    pathname.startsWith("/team") ||
    pathname.startsWith("/templates")
  );
}
