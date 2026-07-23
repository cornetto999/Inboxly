import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Mail,
  Users,
  Bell,
  FileText,
  Inbox,
  Sparkles,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Inboxly — Turn Gmail into a CRM" },
      {
        name: "description",
        content:
          "Connect Gmail, convert senders into leads, manage your pipeline with notes, reminders, and templates.",
      },
      { property: "og:title", content: "Inboxly — Turn Gmail into a CRM" },
      {
        property: "og:description",
        content:
          "Connect Gmail, convert senders into leads, manage your pipeline.",
      },
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
          <Button size="sm" asChild>
            <Link to="/auth">Sign in</Link>
          </Button>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-24 text-center">
        <Badge variant="secondary" className="gap-2 rounded-full">
          <Sparkles className="h-3 w-3" />
          Built for sales teams that live in their inbox
        </Badge>
        <h1 className="mt-6 text-5xl font-bold tracking-tight md:text-6xl">
          Your Gmail, now a <span className="text-primary">working CRM</span>.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          Connect Gmail in one click. Turn senders into leads, track them
          through your pipeline, add notes & reminders, and reply — all from one
          clean workspace.
        </p>
        <div className="mt-10 flex items-center justify-center gap-3">
          <Button size="lg" asChild>
            <Link to="/auth">
              Get started free <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            {
              Icon: Mail,
              title: "Unified inbox",
              body: "Sync Gmail, view & filter every message in one place.",
            },
            {
              Icon: Users,
              title: "Leads & customers",
              body: "Convert any sender into a lead. Move them through your pipeline.",
            },
            {
              Icon: Bell,
              title: "Reminders",
              body: "Never drop a follow-up. Due dates on every contact.",
            },
            {
              Icon: FileText,
              title: "Templates",
              body: "Reply 5× faster with reusable email templates.",
            },
            {
              Icon: ShieldCheck,
              title: "Secure OAuth",
              body: "Google OAuth and Supabase Auth handle sign-in. We never see your password.",
            },
            {
              Icon: Sparkles,
              title: "Activity timeline",
              body: "Every email, note & status change on each customer.",
            },
          ].map(({ Icon, title, body }) => (
            <Card key={title}>
              <CardHeader className="pb-3">
                <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">{title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            Inboxly uses Google OAuth only to power the CRM features users
            choose.
          </p>
          <div className="flex gap-4">
            <Link to="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-foreground">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
