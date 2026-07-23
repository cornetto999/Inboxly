import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service - Inboxly" },
      {
        name: "description",
        content:
          "Inboxly terms covering account use, Gmail connection, acceptable use, and service limits.",
      },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-sm text-muted-foreground">
          Last updated June 13, 2026
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">
          Terms of Service
        </h1>
        <p className="mt-4 text-muted-foreground">
          These terms describe the rules for using Inboxly, an email CRM that
          connects to Gmail with your permission.
        </p>

        <Section title="Using Inboxly">
          <p>
            You may use Inboxly to connect your email account, view synced
            messages, manage leads and customers, create reminders, write notes,
            manage templates, and send replies. You are responsible for keeping
            your account secure and for all activity performed through your
            account.
          </p>
        </Section>

        <Section title="Gmail Connection">
          <p>
            Gmail access is optional and requires your Google consent. Inboxly
            only uses the Gmail permissions needed to sync inbox messages and
            send replies you initiate. You can disconnect Gmail from Settings at
            any time.
          </p>
        </Section>

        <Section title="Acceptable Use">
          <p>
            Do not use Inboxly to send spam, phishing, malware, abusive content,
            illegal content, or messages that violate Google, Supabase, Vercel,
            or email provider policies. Do not attempt to access another user's
            account or data.
          </p>
        </Section>

        <Section title="User Content">
          <p>
            You keep ownership of the emails, contacts, leads, notes, templates,
            and other content you add or sync into Inboxly. You grant Inboxly
            permission to process that content only as needed to provide and
            secure the service.
          </p>
        </Section>

        <Section title="Service Availability">
          <p>
            Inboxly depends on third-party services including Google, Supabase,
            and Vercel. The service may be unavailable or limited because of
            maintenance, provider outages, API limits, security issues, or
            changes to third-party policies.
          </p>
        </Section>

        <Section title="No Warranty">
          <p>
            Inboxly is provided as is and as available. To the fullest extent
            allowed by law, the project owner disclaims warranties of
            merchantability, fitness for a particular purpose, and
            non-infringement.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            These terms may be updated as the service changes. Continued use of
            Inboxly after changes are posted means you accept the updated terms.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            For questions about these terms, contact the project owner using the
            support email configured in the Google OAuth consent screen.
          </p>
        </Section>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8 space-y-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="space-y-3 text-sm leading-6 text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function PublicHeader() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Inbox className="h-4 w-4" />
          </div>
          Inboxly
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link
            to="/privacy"
            className="text-muted-foreground hover:text-foreground"
          >
            Privacy
          </Link>
          <Button size="sm" asChild>
            <Link to="/auth">Sign in</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
