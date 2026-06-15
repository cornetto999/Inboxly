import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  listEmails,
  listEmailAccounts,
  syncGmail,
  createLead,
  createCustomerFromEmail,
  sendGmailReply,
  markEmailRead,
  listTemplates,
  starEmail,
  archiveEmail,
  trashEmail,
  bulkUpdateEmails,
} from "@/lib/crm.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  RefreshCw,
  Search,
  Mail,
  UserPlus,
  UserCheck,
  Send,
  Archive,
  Trash2,
  Star,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Clock3,
  MailOpen,
  Reply,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

const EMAIL_STATUSES = [
  "all",
  "unread",
  "read",
  "starred",
  "sent",
  "drafts",
  "archived",
  "spam",
  "trash",
] as const;
type EmailStatus = (typeof EMAIL_STATUSES)[number];

function isEmailStatus(value: unknown): value is EmailStatus {
  return (
    typeof value === "string" && EMAIL_STATUSES.includes(value as EmailStatus)
  );
}

export const Route = createFileRoute("/_authenticated/inbox")({
  head: () => ({ meta: [{ title: "Inbox — Inboxly" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    status: isEmailStatus(search.status) ? search.status : "all",
  }),
  component: InboxPage,
});

type Email = Awaited<ReturnType<typeof listEmails>>[number];

function InboxPage() {
  const qc = useQueryClient();
  const listEm = useServerFn(listEmails);
  const listAcc = useServerFn(listEmailAccounts);
  const sync = useServerFn(syncGmail);
  const mkLead = useServerFn(createLead);
  const mkCust = useServerFn(createCustomerFromEmail);
  const mkRead = useServerFn(markEmailRead);
  const mkStar = useServerFn(starEmail);
  const mkArchive = useServerFn(archiveEmail);
  const mkTrash = useServerFn(trashEmail);
  const mkBulk = useServerFn(bulkUpdateEmails);
  const { status } = Route.useSearch();
  const showingUnread = status === "unread";

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [selected, setSelected] = useState<Email | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => listAcc(),
  });
  const { data: emails = [], isLoading } = useQuery({
    queryKey: ["emails", search, from, status],
    queryFn: () =>
      listEm({ data: { search, status, fromDate: from || undefined } }),
  });

  const unreadEmails = emails.filter((email) => !email.is_read);
  const selectedIndex = selected
    ? unreadEmails.findIndex((email) => email.id === selected.id)
    : -1;
  const nextUnread =
    selectedIndex >= 0 ? unreadEmails[selectedIndex + 1] : unreadEmails[0];
  const previousUnread =
    selectedIndex > 0 ? unreadEmails[selectedIndex - 1] : undefined;

  const invalidateInbox = () => {
    qc.invalidateQueries({ queryKey: ["emails"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["sidebar-counters"] });
  };

  const syncMut = useMutation({
    mutationFn: (accountId: string) =>
      sync({ data: { accountId, maxResults: 25 } }),
    onSuccess: (res) => {
      toast.success(`Imported ${res.imported} new email(s)`);
      invalidateInbox();
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const convertLead = useMutation({
    mutationFn: (e: Email) =>
      mkLead({
        data: {
          email: e.from_email,
          name: e.from_name ?? undefined,
          from_email_id: e.id,
          source: "inbox",
        },
      }),
    onSuccess: () => {
      toast.success("Converted to lead");
      invalidateInbox();
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const convertCust = useMutation({
    mutationFn: (e: Email) =>
      mkCust({
        data: {
          email: e.from_email,
          name: e.from_name ?? undefined,
          from_email_id: e.id,
        },
      }),
    onSuccess: () => {
      toast.success("Converted to customer");
      invalidateInbox();
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openEmail = async (e: Email) => {
    setSelected(e.is_read ? e : { ...e, is_read: true });
    if (!e.is_read) {
      await mkRead({ data: { id: e.id, isRead: true } });
      invalidateInbox();
    }
  };

  const markRead = useMutation({
    mutationFn: ({ id, isRead }: { id: string; isRead: boolean }) =>
      mkRead({ data: { id, isRead } }),
    onSuccess: (_, variables) => {
      setSelected((email) =>
        email?.id === variables.id
          ? { ...email, is_read: variables.isRead }
          : email,
      );
      invalidateInbox();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const star = useMutation({
    mutationFn: ({ id, isStarred }: { id: string; isStarred: boolean }) =>
      mkStar({ data: { id, isStarred } }),
    onSuccess: (_, variables) => {
      setSelected((email) =>
        email?.id === variables.id
          ? { ...email, is_starred: variables.isStarred }
          : email,
      );
      invalidateInbox();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const archive = useMutation({
    mutationFn: (id: string) => mkArchive({ data: { id } }),
    onSuccess: (_, id) => {
      setSelected((email) => (email?.id === id ? null : email));
      invalidateInbox();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const trash = useMutation({
    mutationFn: (id: string) => mkTrash({ data: { id } }),
    onSuccess: (_, id) => {
      setSelected((email) => (email?.id === id ? null : email));
      invalidateInbox();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const bulk = useMutation({
    mutationFn: (
      action:
        | "mark_read"
        | "mark_unread"
        | "archive"
        | "trash"
        | "star"
        | "unstar",
    ) => mkBulk({ data: { ids: selectedIds, action } }),
    onSuccess: () => {
      setSelectedIds([]);
      invalidateInbox();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="mx-auto max-w-7xl p-5 lg:p-8">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inbox</h1>
          <p className="text-sm text-muted-foreground">
            {showingUnread
              ? `Unread processed: ${Math.max(0, emails.length - unreadEmails.length)} of ${emails.length}. Remaining unread: ${unreadEmails.length}`
              : `${emails.length} email(s)`}
          </p>
        </div>
        <div className="flex gap-2">
          {accounts.length === 0 ? (
            <Button variant="outline" asChild>
              <a href="/settings">Connect Gmail</a>
            </Button>
          ) : (
            <Button
              onClick={() => accounts[0] && syncMut.mutate(accounts[0].id)}
              disabled={syncMut.isPending}
            >
              {syncMut.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Sync now
            </Button>
          )}
        </div>
      </div>

      <Card className="mb-4 border-border/80 p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap gap-2">
          {EMAIL_STATUSES.map((filter) => (
            <Button
              key={filter}
              variant={status === filter ? "default" : "outline"}
              size="sm"
              asChild
            >
              <Link to="/inbox" search={{ status: filter }}>
                {filter === "all"
                  ? "All"
                  : filter[0].toUpperCase() + filter.slice(1)}
              </Link>
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search subject or sender"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Input
            type="date"
            className="w-44"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          {selectedIds.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => bulk.mutate("mark_read")}
              >
                Mark read
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => bulk.mutate("mark_unread")}
              >
                Mark unread
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => bulk.mutate("archive")}
              >
                Archive
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => bulk.mutate("trash")}
              >
                Delete
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => bulk.mutate("star")}
              >
                Star
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden border-border/80 shadow-sm">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground">
            <Loader2 className="mx-auto h-6 w-6 animate-spin" />
          </div>
        ) : emails.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-lg bg-muted">
              <Mail className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="font-medium">
              {showingUnread
                ? "You're all caught up. There are no unread emails."
                : "No emails yet"}
            </p>
            <p className="text-sm text-muted-foreground">
              {showingUnread
                ? "All caught up."
                : accounts.length === 0
                  ? "Connect Gmail to sync your inbox."
                  : "Click Sync now to import."}
            </p>
          </div>
        ) : (
          <div>
            <div className="hidden md:block [&>div]:rounded-none [&>div]:border-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-12">
                      <Checkbox
                        checked={
                          emails.every((email) =>
                            selectedIds.includes(email.id),
                          )
                            ? true
                            : emails.some((email) =>
                                  selectedIds.includes(email.id),
                                )
                              ? "indeterminate"
                              : false
                        }
                        onCheckedChange={(checked) =>
                          setSelectedIds((ids) =>
                            checked
                              ? Array.from(
                                  new Set([
                                    ...ids,
                                    ...emails.map((email) => email.id),
                                  ]),
                                )
                              : ids.filter(
                                  (id) =>
                                    !emails.some((email) => email.id === id),
                                ),
                          )
                        }
                        aria-label="Select all visible emails"
                      />
                    </TableHead>
                    <TableHead className="min-w-52">Sender</TableHead>
                    <TableHead className="min-w-72">Email</TableHead>
                    <TableHead className="w-32">Date</TableHead>
                    <TableHead className="w-28">Time</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                    <TableHead className="w-44 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {emails.map((email) => (
                    <TableRow
                      key={email.id}
                      className={!email.is_read ? "bg-primary/[0.045]" : ""}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.includes(email.id)}
                          onCheckedChange={(checked) =>
                            setSelectedIds((ids) =>
                              checked
                                ? [...ids, email.id]
                                : ids.filter((id) => id !== email.id),
                            )
                          }
                          aria-label={`Select ${email.subject || email.from_email}`}
                        />
                      </TableCell>
                      <TableCell>
                        <button
                          className="flex min-w-0 items-center gap-3 text-left"
                          onClick={() => openEmail(email)}
                        >
                          <Avatar className="h-9 w-9 rounded-lg">
                            <AvatarFallback
                              className={`rounded-lg text-xs font-semibold ${
                                !email.is_read
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {(email.from_name || email.from_email)
                                .slice(0, 1)
                                .toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="min-w-0">
                            <span
                              className={`block max-w-40 truncate ${
                                !email.is_read ? "font-semibold" : "font-medium"
                              }`}
                            >
                              {email.from_name || email.from_email}
                            </span>
                            <span className="block max-w-40 truncate text-xs text-muted-foreground">
                              {email.from_email}
                            </span>
                          </span>
                        </button>
                      </TableCell>
                      <TableCell>
                        <button
                          className="block w-full min-w-0 text-left"
                          onClick={() => openEmail(email)}
                        >
                          <span
                            className={`block max-w-md truncate ${
                              !email.is_read ? "font-semibold" : "font-medium"
                            }`}
                          >
                            {email.subject || "(no subject)"}
                          </span>
                          <span className="block max-w-md truncate text-xs text-muted-foreground">
                            {email.snippet || "No preview available"}
                          </span>
                        </button>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        <time dateTime={email.received_at}>
                          {format(new Date(email.received_at), "MMM d, yyyy")}
                        </time>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        <time dateTime={email.received_at}>
                          {format(new Date(email.received_at), "h:mm a")}
                        </time>
                      </TableCell>
                      <TableCell>
                        {!email.is_read ? (
                          <Badge
                            className="border-primary/20 bg-primary/10 text-primary"
                            variant="outline"
                          >
                            Unread
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Read</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            title={
                              email.is_starred ? "Remove star" : "Add star"
                            }
                            aria-label={
                              email.is_starred ? "Remove star" : "Add star"
                            }
                            onClick={() =>
                              star.mutate({
                                id: email.id,
                                isStarred: !email.is_starred,
                              })
                            }
                          >
                            <Star
                              className={`h-4 w-4 ${
                                email.is_starred
                                  ? "fill-amber-400 text-amber-500"
                                  : ""
                              }`}
                            />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title={email.is_read ? "Mark unread" : "Mark read"}
                            aria-label={
                              email.is_read ? "Mark unread" : "Mark read"
                            }
                            onClick={() =>
                              markRead.mutate({
                                id: email.id,
                                isRead: !email.is_read,
                              })
                            }
                          >
                            {email.is_read ? (
                              <Mail className="h-4 w-4" />
                            ) : (
                              <MailOpen className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Archive"
                            aria-label="Archive email"
                            onClick={() => archive.mutate(email.id)}
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Delete"
                            aria-label="Delete email"
                            onClick={() => trash.mutate(email.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="divide-y divide-border md:hidden">
              {emails.map((email) => (
                <div
                  key={email.id}
                  className={`p-4 ${!email.is_read ? "bg-primary/[0.045]" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      className="mt-1"
                      checked={selectedIds.includes(email.id)}
                      onCheckedChange={(checked) =>
                        setSelectedIds((ids) =>
                          checked
                            ? [...ids, email.id]
                            : ids.filter((id) => id !== email.id),
                        )
                      }
                      aria-label={`Select ${email.subject || email.from_email}`}
                    />
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => openEmail(email)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span
                          className={`truncate text-sm ${
                            !email.is_read ? "font-semibold" : "font-medium"
                          }`}
                        >
                          {email.from_name || email.from_email}
                        </span>
                        {!email.is_read && (
                          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                        )}
                      </div>
                      <p
                        className={`mt-1 truncate text-sm ${
                          !email.is_read ? "font-semibold" : ""
                        }`}
                      >
                        {email.subject || "(no subject)"}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {email.snippet || "No preview available"}
                      </p>
                      <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <CalendarDays className="h-3.5 w-3.5" />
                          {format(new Date(email.received_at), "MMM d, yyyy")}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Clock3 className="h-3.5 w-3.5" />
                          {format(new Date(email.received_at), "h:mm a")}
                        </span>
                      </div>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Dialog
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent className="flex h-[min(90vh,860px)] w-[calc(100%-1.5rem)] max-w-4xl flex-col gap-0 overflow-hidden border-border/70 bg-background p-0 shadow-2xl sm:rounded-2xl">
          {selected && (
            <>
              <DialogHeader className="border-b bg-card px-5 py-5 pr-14 text-left sm:px-7">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className="border-primary/20 bg-primary/10 text-primary"
                  >
                    Email details
                  </Badge>
                  {selected.is_starred && (
                    <Badge
                      variant="outline"
                      className="border-amber-300/70 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300"
                    >
                      <Star className="mr-1 h-3 w-3 fill-current" />
                      Starred
                    </Badge>
                  )}
                  {selected.lead_id && <Badge variant="secondary">Lead</Badge>}
                  {selected.customer_id && (
                    <Badge variant="secondary">Customer</Badge>
                  )}
                </div>
                <DialogTitle className="pt-2 text-xl leading-snug sm:text-2xl">
                  {selected.subject || "(no subject)"}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Email from {selected.from_name || selected.from_email},
                  received {format(new Date(selected.received_at), "PPpp")}.
                </DialogDescription>
                <div className="flex flex-col gap-4 pt-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="h-11 w-11">
                      <AvatarFallback className="bg-primary/10 font-semibold text-primary">
                        {(selected.from_name || selected.from_email)
                          .slice(0, 1)
                          .toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {selected.from_name || selected.from_email}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {selected.from_email}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5" />
                      {format(new Date(selected.received_at), "MMM d, yyyy")}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Clock3 className="h-3.5 w-3.5" />
                      {format(new Date(selected.received_at), "h:mm a")}
                    </span>
                  </div>
                </div>
              </DialogHeader>

              <div className="flex shrink-0 items-center justify-between gap-3 overflow-x-auto border-b bg-muted/30 px-4 py-3 sm:px-7">
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={!previousUnread}
                    onClick={() => previousUnread && openEmail(previousUnread)}
                    title="Previous unread email"
                    aria-label="Previous unread email"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={!nextUnread}
                    onClick={() => nextUnread && openEmail(nextUnread)}
                    title="Next unread email"
                    aria-label="Next unread email"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">
                    Unread navigation
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() =>
                      markRead.mutate({
                        id: selected.id,
                        isRead: !selected.is_read,
                      })
                    }
                    title={selected.is_read ? "Mark unread" : "Mark read"}
                    aria-label={selected.is_read ? "Mark unread" : "Mark read"}
                  >
                    {selected.is_read ? (
                      <Mail className="h-4 w-4" />
                    ) : (
                      <MailOpen className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() =>
                      star.mutate({
                        id: selected.id,
                        isStarred: !selected.is_starred,
                      })
                    }
                    title={selected.is_starred ? "Remove star" : "Add star"}
                    aria-label={
                      selected.is_starred ? "Remove star" : "Add star"
                    }
                  >
                    <Star
                      className={`h-4 w-4 ${
                        selected.is_starred
                          ? "fill-amber-400 text-amber-500"
                          : ""
                      }`}
                    />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => archive.mutate(selected.id)}
                    title="Archive email"
                    aria-label="Archive email"
                  >
                    <Archive className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => trash.mutate(selected.id)}
                    title="Delete email"
                    aria-label="Delete email"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <div className="mx-2 h-5 w-px bg-border" />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => convertLead.mutate(selected)}
                    disabled={!!selected.lead_id}
                  >
                    <UserPlus className="mr-2 h-4 w-4" />
                    <span className="hidden sm:inline">Convert to lead</span>
                    <span className="sm:hidden">Lead</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => convertCust.mutate(selected)}
                    disabled={!!selected.customer_id}
                  >
                    <UserCheck className="mr-2 h-4 w-4" />
                    <span className="hidden sm:inline">
                      Convert to customer
                    </span>
                    <span className="sm:hidden">Customer</span>
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="space-y-6 p-5 sm:p-7">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">To:</span>
                    <span>{selected.to_emails.join(", ") || "Me"}</span>
                    {selected.cc_emails.length > 0 && (
                      <>
                        <span className="mx-1 text-border">|</span>
                        <span className="font-medium text-foreground">Cc:</span>
                        <span>{selected.cc_emails.join(", ")}</span>
                      </>
                    )}
                  </div>
                  <article
                    className={`prose prose-sm dark:prose-invert max-w-none overflow-hidden rounded-xl border border-border/80 bg-card p-5 leading-relaxed shadow-sm sm:p-7 ${
                      selected.body_html ? "" : "whitespace-pre-wrap"
                    }`}
                    dangerouslySetInnerHTML={{
                      __html: sanitizeHtml(
                        selected.body_html ||
                          selected.body_text ||
                          selected.snippet ||
                          "",
                      ),
                    }}
                  />
                </div>
                <ReplyBox
                  key={selected.id}
                  email={selected}
                  accountId={accounts[0]?.id}
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function sanitizeHtml(html: string): string {
  // basic: strip scripts and on* attrs; full sanitization handled in client display only
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "");
}

function ReplyBox({ email, accountId }: { email: Email; accountId?: string }) {
  const send = useServerFn(sendGmailReply);
  const listTpl = useServerFn(listTemplates);
  const { data: templates = [] } = useQuery({
    queryKey: ["templates"],
    queryFn: () => listTpl(),
  });
  const [subject, setSubject] = useState(
    email.subject?.startsWith("Re:")
      ? email.subject
      : `Re: ${email.subject ?? ""}`,
  );
  const [body, setBody] = useState("");
  const mut = useMutation({
    mutationFn: () =>
      send({
        data: {
          accountId: accountId!,
          to: email.from_email,
          subject,
          body,
          threadId: email.gmail_thread_id ?? undefined,
          inReplyToEmailId: email.id,
        },
      }),
    onSuccess: () => {
      toast.success("Reply sent");
      setBody("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!accountId)
    return (
      <div className="border-t bg-muted/20 p-5 text-sm text-muted-foreground sm:p-7">
        Connect Gmail in Settings to reply.
      </div>
    );

  return (
    <div className="border-t bg-muted/20 p-5 sm:p-7">
      <div className="rounded-xl border border-border/80 bg-card p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Reply className="h-4 w-4 text-primary" />
              Reply to {email.from_name || email.from_email}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Send a Gmail reply from this workspace.
            </p>
          </div>
          {templates.length > 0 && (
            <Select
              onValueChange={(id) => {
                const template = templates.find((item) => item.id === id);
                if (template) {
                  setSubject(template.subject);
                  setBody(template.body);
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Use template..." />
              </SelectTrigger>
              <SelectContent>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Subject</Label>
            <Input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Message</Label>
            <Textarea
              rows={5}
              placeholder="Write your reply..."
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => mut.mutate()}
              disabled={mut.isPending || !body.trim()}
            >
              {mut.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Send reply
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
