import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errors";
import { savePendingGmailConnectionTokenFromUrl } from "@/lib/gmail-oauth";

export async function consumeSupabaseUrlSession() {
  if (typeof window === "undefined") return false;

  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!hash) return false;

  const params = new URLSearchParams(hash);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return false;

  savePendingGmailConnectionTokenFromUrl();

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) throw toError(error, "Unable to finish Google sign-in.");

  window.history.replaceState(
    null,
    document.title,
    `${window.location.pathname}${window.location.search}`,
  );

  return true;
}
