import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { consumeSupabaseUrlSession } from "@/lib/auth-url-session";
import {
  GMAIL_CONNECT_PENDING_KEY,
  savePendingGmailConnectionTokenFromSession,
} from "@/lib/gmail-oauth";
import { getErrorMessage, toError } from "@/lib/errors";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({ meta: [{ title: "Signing in - Inboxly" }] }),
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
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
          window.location.replace(
            localStorage.getItem(GMAIL_CONNECT_PENDING_KEY) === "1"
              ? "/settings"
              : "/dashboard",
          );
          return;
        }

        const code = url.searchParams.get("code");
        if (code) {
          const { data, error } =
            await supabase.auth.exchangeCodeForSession(code);
          if (error) throw toError(error, "Google sign-in failed.");
          savePendingGmailConnectionTokenFromSession(data.session);
        } else {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw toError(error, "Google sign-in failed.");
          if (!data.session)
            throw new Error("No sign-in session was returned.");
          savePendingGmailConnectionTokenFromSession(data.session);
        }

        if (!active) return;
        toast.success("Signed in with Google");
        window.location.replace(
          localStorage.getItem(GMAIL_CONNECT_PENDING_KEY) === "1"
            ? "/settings"
            : "/dashboard",
        );
      } catch (error) {
        if (!active) return;
        const errorMessage = getErrorMessage(error, "Google sign-in failed");
        setMessage(errorMessage);
        toast.error(errorMessage);
        window.location.replace("/auth");
      }
    };

    finishSignIn();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm text-card-foreground shadow">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span>{message}</span>
      </div>
    </div>
  );
}
