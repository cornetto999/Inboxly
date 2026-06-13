import { createFileRoute, Link } from "@tanstack/react-router";
import { Mail, Users, Bell, FileText, Inbox, Sparkles, ShieldCheck, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Inboxly — Turn Gmail into a CRM" },
      { name: "description", content: "Connect Gmail, convert senders into leads, manage your pipeline with notes, reminders, and templates." },
      { property: "og:title", content: "Inboxly — Turn Gmail into a CRM" },
      { property: "og:description", content: "Connect Gmail, convert senders into leads, manage your pipeline." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Inbox className="h-4 w-4" />
            </div>
            Inboxly
          </Link>
          <Link
            to="/auth"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Sign in
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-24 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground">
          <Sparkles className="h-3 w-3" /> Built for sales teams that live in their inbox
        </div>
        <h1 className="mt-6 text-5xl font-bold tracking-tight md:text-6xl">
          Your Gmail, now a <span className="text-primary">working CRM</span>.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          Connect Gmail in one click. Turn senders into leads, track them through your pipeline,
          add notes & reminders, and reply — all from one clean workspace.
        </p>
        <div className="mt-10 flex items-center justify-center gap-3">
          <Link
            to="/auth"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Get started free <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { Icon: Mail, title: "Unified inbox", body: "Sync Gmail, view & filter every message in one place." },
            { Icon: Users, title: "Leads & customers", body: "Convert any sender into a lead. Move them through your pipeline." },
            { Icon: Bell, title: "Reminders", body: "Never drop a follow-up. Due dates on every contact." },
            { Icon: FileText, title: "Templates", body: "Reply 5× faster with reusable email templates." },
            { Icon: ShieldCheck, title: "Secure OAuth", body: "Google OAuth and Supabase Auth handle sign-in. We never see your password." },
            { Icon: Sparkles, title: "Activity timeline", body: "Every email, note & status change on each customer." },
          ].map(({ Icon, title, body }) => (
            <div key={title} className="rounded-xl border border-border bg-card p-6">
              <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>Inboxly uses Google OAuth only to power the CRM features users choose.</p>
          <div className="flex gap-4">
            <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link to="/terms" className="hover:text-foreground">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
