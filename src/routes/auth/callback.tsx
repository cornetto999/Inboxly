import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { consumeSupabaseUrlSession } from "@/lib/auth-url-session";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({ meta: [{ title: "Signing in - Inboxly" }] }),
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("Finishing Google sign in...");

  useEffect(() => {
    let active = true;

    const finishSignIn = async () => {
      try {
        const url = new URL(window.location.href);
        const providerError =
          url.searchParams.get("error_description") ??
          url.searchParams.get("error");

        if (providerError) {
          throw new Error(providerError);
        }

        const didConsumeHashSession = await consumeSupabaseUrlSession();
        if (didConsumeHashSession) {
          if (!active) return;
          toast.success("Signed in with Google");
          navigate({ to: "/dashboard", replace: true });
          return;
        }

        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (!data.session)
            throw new Error("No sign-in session was returned.");
        }

        if (!active) return;
        toast.success("Signed in with Google");
        navigate({ to: "/dashboard", replace: true });
      } catch (error) {
        if (!active) return;
        const errorMessage =
          error instanceof Error ? error.message : "Google sign-in failed";
        setMessage(errorMessage);
        toast.error(errorMessage);
        navigate({ to: "/auth", replace: true });
      }
    };

    finishSignIn();

    return () => {
      active = false;
    };
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm text-card-foreground shadow">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span>{message}</span>
      </div>
    </div>
  );
}
