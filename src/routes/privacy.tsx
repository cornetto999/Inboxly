import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy - Inboxly" },
      {
        name: "description",
        content:
          "Inboxly privacy policy covering Google OAuth, Gmail data use, storage, sharing, and deletion.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-sm text-muted-foreground">Last updated June 13, 2026</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="mt-4 text-muted-foreground">
          Inboxly is an email CRM that helps users connect Gmail, sync selected inbox
          messages, convert senders into leads or customers, manage reminders, and send
          replies.
        </p>

        <Section title="Information We Collect">
          <p>
            When you sign in or connect Gmail, Inboxly may collect your name, email
            address, Google profile details, OAuth tokens, Gmail message identifiers,
            sender and recipient addresses, subjects, snippets, message body content,
            labels, dates, replies you send, leads, customers, notes, reminders, and
            activity history created inside the app.
          </p>
        </Section>

        <Section title="How We Use Information">
          <p>
            We use this information only to provide Inboxly features: authenticate your
            account, sync Gmail messages into your private workspace, display and search
            emails, create leads and customers, show activity timelines, schedule
            reminders, manage templates, and send replies that you initiate.
          </p>
        </Section>

        <Section title="Google User Data">
          <p>
            Inboxly requests Google access only when you choose to connect Gmail. The app
            currently requests Gmail read access to import inbox messages and Gmail send
            access to send replies you create in Inboxly.
          </p>
          <p>
            Inboxly does not sell Google user data, use Google user data for advertising,
            transfer Google user data to data brokers, or use Google Workspace API data to
            train generalized AI or machine learning models.
          </p>
          <p>
            Inboxly's use and transfer of information received from Google APIs adheres to
            the{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              className="font-medium text-primary underline underline-offset-4"
              rel="noreferrer"
              target="_blank"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
        </Section>

        <Section title="Storage And Sharing">
          <p>
            Inboxly stores application data in Supabase and runs the web app on Vercel.
            We share data with service providers only as needed to host, secure, and
            operate the app. We may disclose information if required by law or to protect
            the service, users, or the public.
          </p>
        </Section>

        <Section title="Your Choices And Deletion">
          <p>
            You can disconnect Gmail in Settings. Disconnecting removes the connected
            account token and synced email records tied to that mailbox. Leads, customers,
            notes, reminders, templates, and activity that you created may remain until
            you delete them or request deletion.
          </p>
        </Section>

        <Section title="Security">
          <p>
            We use OAuth instead of passwords for Gmail access and protect data in transit
            with HTTPS. No internet service can guarantee perfect security, but we take
            reasonable steps to protect user data from unauthorized access.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            For privacy questions or deletion requests, contact the project owner using
            the support email configured in the Google OAuth consent screen.
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
      <div className="space-y-3 text-sm leading-6 text-muted-foreground">{children}</div>
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
          <Link to="/terms" className="text-muted-foreground hover:text-foreground">Terms</Link>
          <Link
            to="/auth"
            className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90"
          >
            Sign in
          </Link>
        </div>
      </div>
    </header>
  );
}
