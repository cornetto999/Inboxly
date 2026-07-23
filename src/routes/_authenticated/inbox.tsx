import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  keepPreviousData,
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
  listEmailAttachments,
  getEmailThread,
} from "@/lib/crm.functions";
import type { EmailFolderCounts } from "@/lib/crm.functions";
import {
  EMAIL_FOLDER_COUNT_KEYS,
  getEmailFolderState,
  getEmailLabels,
} from "@/lib/email-folder-state";
import { useEmailFolderCounts } from "@/hooks/use-email-folder-counts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DataCard,
  PageHeader,
  PageShell,
  ToolbarCard,
} from "@/components/crm-ui";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
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
  Paperclip,
  Download,
  Eye,
  Printer,
  FileText,
  FolderOpen,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

const EMAIL_STATUSES = [
  "all",
  "unread",
  "read",
  "starred",
  "replied",
  "sent",
  "drafts",
  "archived",
  "spam",
  "trash",
] as const;
type EmailStatus = (typeof EMAIL_STATUSES)[number];

const EMAIL_STATUS_META: Record<
  EmailStatus,
  {
    label: string;
    countKey: keyof EmailFolderCounts;
    description: string;
  }
> = {
  all: {
    label: "All Mail",
    countKey: "all",
    description: "Synced Gmail messages excluding Spam and Trash.",
  },
  unread: {
    label: "Unread",
    countKey: "unread",
    description: "Inbox mail with the Gmail UNREAD label.",
  },
  read: {
    label: "Read",
    countKey: "read",
    description: "Read mail excluding Sent, Drafts, Spam, and Trash.",
  },
  starred: {
    label: "Starred",
    countKey: "starred",
    description:
      "Messages with the Gmail STARRED label outside Spam and Trash.",
  },
  replied: {
    label: "Replied",
    countKey: "replied",
    description: "Incoming Gmail conversations that received a later reply.",
  },
  sent: {
    label: "Sent",
    countKey: "sent",
    description: "Messages with the Gmail SENT label.",
  },
  drafts: {
    label: "Drafts",
    countKey: "drafts",
    description: "Messages with the Gmail DRAFT label.",
  },
  archived: {
    label: "Archived",
    countKey: "archived",
    description: "Received mail without Inbox, Sent, Draft, Spam, or Trash.",
  },
  spam: {
    label: "Spam",
    countKey: "spam",
    description: "Messages with the Gmail SPAM label.",
  },
  trash: {
    label: "Trash",
    countKey: "trash",
    description: "Messages with the Gmail TRASH label.",
  },
};

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
type EmailAttachment = Awaited<ReturnType<typeof listEmailAttachments>>[number];
type AttachmentAction = "view" | "download" | "print";
type BulkAction =
  | "mark_read"
  | "mark_unread"
  | "archive"
  | "trash"
  | "star"
  | "unstar";

const EMPTY_ATTACHMENTS: EmailAttachment[] = [];
const LIVE_INBOX_REFETCH_INTERVAL_MS = 15_000;

const EMAIL_COUNT_KEYS =
  EMAIL_FOLDER_COUNT_KEYS satisfies readonly (keyof EmailFolderCounts)[];

function updateEmailLabels(
  labels: unknown,
  addLabelIds: string[] = [],
  removeLabelIds: string[] = [],
) {
  const nextLabels = new Set(
    Array.isArray(labels)
      ? labels.filter((label): label is string => typeof label === "string")
      : [],
  );
  for (const label of removeLabelIds) nextLabels.delete(label);
  for (const label of addLabelIds) nextLabels.add(label);
  return Array.from(nextLabels);
}

function getEmailLabelPatch(
  email: Partial<Email>,
  addLabelIds: string[] = [],
  removeLabelIds: string[] = [],
): Partial<Email> {
  const labels = updateEmailLabels(
    getEmailLabels(email),
    addLabelIds,
    removeLabelIds,
  );
  const upperLabels = labels.map((label) => label.toUpperCase());
  const hasLabel = (label: string) => upperLabels.includes(label);
  const isSpam = hasLabel("SPAM");
  const isTrashed = hasLabel("TRASH");

  return {
    labels,
    label_ids: labels,
    is_read: !hasLabel("UNREAD"),
    is_starred: hasLabel("STARRED"),
    is_sent: hasLabel("SENT"),
    is_draft: hasLabel("DRAFT"),
    is_spam: isSpam,
    is_trashed: isTrashed,
    is_archived: !hasLabel("INBOX") && !isSpam && !isTrashed,
  };
}

function areStringRecordsEqual(
  left: Record<string, string>,
  right: Record<string, string>,
) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}

function isEmailUnread(email: Partial<Email>) {
  return getEmailFolderState(email).isUnread;
}

function isEmailRead(email: Partial<Email>) {
  return getEmailFolderState(email).isRead;
}

function getEmailContribution(email: Partial<Email>): EmailFolderCounts {
  const state = getEmailFolderState(email);

  return {
    all: state.isAllMail ? 1 : 0,
    unread: state.isUnread ? 1 : 0,
    read: state.isRead ? 1 : 0,
    starred: state.isStarred ? 1 : 0,
    replied: state.isReplied ? 1 : 0,
    sent: state.isSent ? 1 : 0,
    drafts: state.isDraft ? 1 : 0,
    archived: state.isArchived ? 1 : 0,
    spam: state.isSpam ? 1 : 0,
    trash: state.isTrashed ? 1 : 0,
  };
}

function getEmailCountDelta(
  before: Partial<Email>,
  after: Partial<Email>,
): Partial<EmailFolderCounts> {
  const beforeCounts = getEmailContribution(before);
  const afterCounts = getEmailContribution(after);

  return EMAIL_COUNT_KEYS.reduce<Partial<EmailFolderCounts>>((delta, key) => {
    const change = afterCounts[key] - beforeCounts[key];
    if (change !== 0) delta[key] = change;
    return delta;
  }, {});
}

function applyEmailCountDelta(
  counts: EmailFolderCounts,
  delta: Partial<EmailFolderCounts>,
) {
  return EMAIL_COUNT_KEYS.reduce<EmailFolderCounts>(
    (next, key) => ({
      ...next,
      [key]: Math.max(0, next[key] + (delta[key] ?? 0)),
    }),
    { ...counts },
  );
}

function getBulkEmailPatch(email: Email, action: BulkAction): Partial<Email> {
  if (action === "mark_read") {
    return getEmailLabelPatch(email, [], ["UNREAD"]);
  }
  if (action === "mark_unread") {
    return getEmailLabelPatch(email, ["UNREAD"]);
  }
  if (action === "archive") {
    return getEmailLabelPatch(email, [], ["INBOX"]);
  }
  if (action === "trash") {
    return getEmailLabelPatch(email, ["TRASH"], ["INBOX"]);
  }
  if (action === "star") {
    return getEmailLabelPatch(email, ["STARRED"]);
  }
  return getEmailLabelPatch(email, [], ["STARRED"]);
}

function formatFolderCount(count: number) {
  return new Intl.NumberFormat().format(count);
}

function getValidDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatEmailTimestamp(
  value: string | null | undefined,
  pattern: string,
  fallback: string,
) {
  const date = getValidDate(value);
  return date ? format(date, pattern) : fallback;
}

function getDateTimeAttribute(
  value: string | null | undefined,
): string | undefined {
  return value && getValidDate(value) ? value : undefined;
}

function getSenderName(email: Partial<Email>) {
  return email.from_name || email.from_email || "Unknown sender";
}

function getSenderEmail(email: Partial<Email>) {
  return email.from_email || "Unknown email";
}

function getInitial(value: string) {
  return value.slice(0, 1).toUpperCase() || "?";
}

function getEmailAddresses(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (address): address is string =>
      typeof address === "string" && address.trim().length > 0,
  );
}

type EmailQuerySnapshot = [readonly unknown[], Email[] | undefined];

function emailMatchesStatus(email: Email, status: unknown) {
  const state = getEmailFolderState(email);
  if (status === "unread") return state.isUnread;
  if (status === "read") return state.isRead;
  if (status === "starred") return state.isStarred;
  if (status === "replied") return state.isReplied;
  if (status === "sent") return state.isSent;
  if (status === "drafts") return state.isDraft;
  if (status === "archived") return state.isArchived;
  if (status === "spam") return state.isSpam;
  if (status === "trash") return state.isTrashed;
  return state.isAllMail;
}

async function fetchAttachmentResponse(
  attachmentId: string,
  disposition: "inline" | "attachment" = "inline",
) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error("You must sign in again to load this attachment.");
  }
  const response = await fetch(
    `/api/gmail/attachments/${encodeURIComponent(
      attachmentId,
    )}?disposition=${disposition}`,
    {
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
      },
    },
  );
  if (response.ok) return response;

  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  if (response.status === 409) {
    throw new Error(
      "Your Gmail connection has expired. Reconnect your account in Settings.",
    );
  }
  if (response.status === 403) {
    throw new Error("You do not have access to this attachment.");
  }
  if (response.status === 404) {
    throw new Error(
      payload?.error ?? "This attachment is no longer available in Gmail.",
    );
  }
  throw new Error(
    payload?.error ?? "The attachment could not be loaded. Please try again.",
  );
}

function isPreviewableMimeType(mimeType: string) {
  return (
    mimeType === "application/pdf" ||
    mimeType.startsWith("image/") ||
    mimeType.startsWith("text/")
  );
}

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
  const listAttachments = useServerFn(listEmailAttachments);
  const listThread = useServerFn(getEmailThread);
  const { status } = Route.useSearch();
  const showingUnread = status === "unread";
  const {
    counts: folderCounts,
    isLoading: folderCountsLoading,
    error: folderCountsError,
    refreshCounts,
    updateCountOptimistically,
  } = useEmailFolderCounts();

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [selected, setSelected] = useState<Email | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [attachmentAction, setAttachmentAction] = useState<{
    id: string;
    action: AttachmentAction;
  } | null>(null);
  const [inlineAttachmentUrls, setInlineAttachmentUrls] = useState<
    Record<string, string>
  >({});
  const selectedEmailId = selected?.id;
  const readMutationLocks = useRef(new Set<string>());

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => listAcc(),
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  const { data: queriedEmails = [], isLoading } = useQuery({
    queryKey: ["emails", search, from, status],
    queryFn: () =>
      listEm({ data: { search, status, fromDate: from || undefined } }),
    placeholderData: keepPreviousData,
    staleTime: 5_000,
    gcTime: 10 * 60_000,
    refetchInterval: LIVE_INBOX_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  const {
    data: fetchedAttachments,
    isLoading: attachmentsLoading,
    error: attachmentsError,
  } = useQuery({
    queryKey: ["email-attachments", selectedEmailId],
    queryFn: () => listAttachments({ data: { emailId: selectedEmailId! } }),
    enabled: !!selectedEmailId,
    staleTime: 10 * 60 * 1000,
  });
  const attachments = fetchedAttachments ?? EMPTY_ATTACHMENTS;
  const { data: threadMessages = [] } = useQuery({
    queryKey: ["email-thread", selectedEmailId],
    queryFn: () => listThread({ data: { emailId: selectedEmailId! } }),
    enabled: !!selectedEmailId,
  });

  useEffect(() => {
    let active = true;
    const objectUrls: string[] = [];
    const inlineAttachments = attachments.filter(
      (attachment) => attachment.isInline && attachment.contentId,
    );
    if (!selectedEmailId || inlineAttachments.length === 0) {
      setInlineAttachmentUrls((current) =>
        Object.keys(current).length === 0 ? current : {},
      );
      return;
    }

    void Promise.all(
      inlineAttachments.map(async (attachment) => {
        const response = await fetchAttachmentResponse(attachment.id);
        const url = URL.createObjectURL(await response.blob());
        objectUrls.push(url);
        return [attachment.contentId!, url] as const;
      }),
    )
      .then((entries) => {
        if (active) {
          const nextUrls = Object.fromEntries(entries);
          setInlineAttachmentUrls((current) =>
            areStringRecordsEqual(current, nextUrls) ? current : nextUrls,
          );
        }
      })
      .catch((error) => {
        if (active) {
          console.warn("Inline Gmail attachment failed to load.", error);
          setInlineAttachmentUrls((current) =>
            Object.keys(current).length === 0 ? current : {},
          );
        }
      });

    return () => {
      active = false;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [attachments, selectedEmailId]);

  const emails = queriedEmails.filter((email) =>
    emailMatchesStatus(email, status),
  );
  const unreadEmails = emails.filter(isEmailUnread);
  const selectedIndex = selected
    ? unreadEmails.findIndex((email) => email.id === selected.id)
    : -1;
  const nextUnread =
    selectedIndex >= 0 ? unreadEmails[selectedIndex + 1] : unreadEmails[0];
  const previousUnread =
    selectedIndex > 0 ? unreadEmails[selectedIndex - 1] : undefined;

  const getVisibleEmail = (id: string) =>
    selected?.id === id ? selected : emails.find((email) => email.id === id);

  const restoreFolderCounts = (snapshot?: EmailFolderCounts) => {
    if (snapshot) updateCountOptimistically(() => snapshot);
  };

  const patchCachedEmail = (id: string, patch: Partial<Email>) => {
    const snapshots = qc.getQueriesData<Email[]>({ queryKey: ["emails"] });
    for (const [queryKey, rows] of snapshots) {
      if (!rows) continue;
      const queryStatus = queryKey[3];
      qc.setQueryData<Email[]>(
        queryKey,
        rows
          .map((row) => (row.id === id ? { ...row, ...patch } : row))
          .filter((row) => emailMatchesStatus(row, queryStatus)),
      );
    }
    return snapshots as EmailQuerySnapshot[];
  };

  const patchCachedEmails = (
    ids: string[],
    getPatch: (email: Email) => Partial<Email>,
  ) => {
    const snapshots = qc.getQueriesData<Email[]>({ queryKey: ["emails"] });
    const idsToPatch = new Set(ids);
    for (const [queryKey, rows] of snapshots) {
      if (!rows) continue;
      const queryStatus = queryKey[3];
      qc.setQueryData<Email[]>(
        queryKey,
        rows
          .map((row) =>
            idsToPatch.has(row.id) ? { ...row, ...getPatch(row) } : row,
          )
          .filter((row) => emailMatchesStatus(row, queryStatus)),
      );
    }
    return snapshots as EmailQuerySnapshot[];
  };

  const restoreEmailCaches = (snapshots?: EmailQuerySnapshot[]) => {
    snapshots?.forEach(([queryKey, rows]) => {
      qc.setQueryData(queryKey, rows);
    });
  };

  const applyOptimisticEmailPatch = (email: Email, patch: Partial<Email>) => {
    const after = { ...email, ...patch };
    const delta = getEmailCountDelta(email, after);
    return updateCountOptimistically((counts) =>
      applyEmailCountDelta(counts, delta),
    );
  };

  const applyOptimisticBulkAction = (action: BulkAction) => {
    const emailsToUpdate = emails.filter((email) =>
      selectedIds.includes(email.id),
    );
    if (emailsToUpdate.length === 0) return undefined;

    return updateCountOptimistically((counts) =>
      emailsToUpdate.reduce((nextCounts, email) => {
        const after = { ...email, ...getBulkEmailPatch(email, action) };
        return applyEmailCountDelta(
          nextCounts,
          getEmailCountDelta(email, after),
        );
      }, counts),
    );
  };

  const invalidateInbox = () => {
    qc.invalidateQueries({ queryKey: ["emails"] });
    qc.invalidateQueries({ queryKey: ["email-folder-counts"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["sidebar-counters"] });
  };

  const syncMut = useMutation({
    mutationFn: (accountId: string) =>
      sync({ data: { accountId, maxResults: 100 } }),
    onSuccess: (res) => {
      toast.success(
        `Synced ${res.scanned} email(s): ${res.imported} new, ${res.updated ?? 0} refreshed`,
      );
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
    const readPatch = getEmailLabelPatch(e, [], ["UNREAD"]);
    const wasUnread = isEmailUnread(e);
    setSelected(wasUnread ? { ...e, ...readPatch } : e);
    if (wasUnread) {
      const readKey = e.gmail_message_id ?? e.id;
      if (readMutationLocks.current.has(readKey)) return;
      readMutationLocks.current.add(readKey);
      const previousCounts = applyOptimisticEmailPatch(e, readPatch);
      const previousEmailCaches = patchCachedEmail(e.id, readPatch);
      try {
        await mkRead({ data: { id: e.id, isRead: true } });
        invalidateInbox();
      } catch (error) {
        restoreFolderCounts(previousCounts);
        restoreEmailCaches(previousEmailCaches);
        setSelected(e);
        toast.error(
          error instanceof Error ? error.message : "Could not mark email read.",
        );
      } finally {
        readMutationLocks.current.delete(readKey);
      }
    }
  };

  const markRead = useMutation({
    mutationFn: ({ id, isRead }: { id: string; isRead: boolean }) =>
      mkRead({ data: { id, isRead } }),
    onMutate: (variables) => {
      const email = getVisibleEmail(variables.id);
      if (!email) return {};
      const readKey = email.gmail_message_id ?? email.id;
      if (variables.isRead && readMutationLocks.current.has(readKey)) {
        return { skipped: true };
      }
      if (variables.isRead) readMutationLocks.current.add(readKey);
      const previousCounts = applyOptimisticEmailPatch(email, {
        ...getEmailLabelPatch(
          email,
          variables.isRead ? [] : ["UNREAD"],
          variables.isRead ? ["UNREAD"] : [],
        ),
      });
      const patch = {
        ...getEmailLabelPatch(
          email,
          variables.isRead ? [] : ["UNREAD"],
          variables.isRead ? ["UNREAD"] : [],
        ),
      };
      const previousEmailCaches = patchCachedEmail(email.id, patch);
      const previousSelected = selected;
      setSelected((email) =>
        email?.id === variables.id ? { ...email, ...patch } : email,
      );
      return {
        previousCounts,
        previousSelected,
        previousEmailCaches,
        readKey: variables.isRead ? readKey : undefined,
      };
    },
    onError: (error: Error, _variables, context) => {
      if (context && "skipped" in context) return;
      restoreFolderCounts(context?.previousCounts);
      restoreEmailCaches(context?.previousEmailCaches);
      if (context && "previousSelected" in context) {
        setSelected(context.previousSelected ?? null);
      }
      toast.error(error.message);
    },
    onSettled: (_data, _error, _variables, context) => {
      if (context && "readKey" in context && context.readKey) {
        readMutationLocks.current.delete(context.readKey);
      }
      if (!(context && "skipped" in context)) invalidateInbox();
    },
  });

  const star = useMutation({
    mutationFn: ({ id, isStarred }: { id: string; isStarred: boolean }) =>
      mkStar({ data: { id, isStarred } }),
    onMutate: (variables) => {
      const email = getVisibleEmail(variables.id);
      if (!email) return {};
      const patch = getEmailLabelPatch(
        email,
        variables.isStarred ? ["STARRED"] : [],
        variables.isStarred ? [] : ["STARRED"],
      );
      const previousCounts = applyOptimisticEmailPatch(email, patch);
      const previousSelected = selected;
      setSelected((email) =>
        email?.id === variables.id ? { ...email, ...patch } : email,
      );
      return { previousCounts, previousSelected };
    },
    onError: (error: Error, _variables, context) => {
      restoreFolderCounts(context?.previousCounts);
      if (context && "previousSelected" in context) {
        setSelected(context.previousSelected ?? null);
      }
      toast.error(error.message);
    },
    onSettled: () => invalidateInbox(),
  });

  const archive = useMutation({
    mutationFn: (id: string) => mkArchive({ data: { id } }),
    onMutate: (id) => {
      const email = getVisibleEmail(id);
      if (!email) return {};
      const previousCounts = applyOptimisticEmailPatch(
        email,
        getEmailLabelPatch(email, [], ["INBOX"]),
      );
      const previousSelected = selected;
      setSelected((email) => (email?.id === id ? null : email));
      return { previousCounts, previousSelected };
    },
    onError: (error: Error, _id, context) => {
      restoreFolderCounts(context?.previousCounts);
      if (context && "previousSelected" in context) {
        setSelected(context.previousSelected ?? null);
      }
      toast.error(error.message);
    },
    onSettled: () => invalidateInbox(),
  });

  const trash = useMutation({
    mutationFn: (id: string) => mkTrash({ data: { id } }),
    onMutate: (id) => {
      const email = getVisibleEmail(id);
      if (!email) return {};
      const previousCounts = applyOptimisticEmailPatch(
        email,
        getEmailLabelPatch(email, ["TRASH"], ["INBOX"]),
      );
      const previousSelected = selected;
      setSelected((email) => (email?.id === id ? null : email));
      return { previousCounts, previousSelected };
    },
    onError: (error: Error, _id, context) => {
      restoreFolderCounts(context?.previousCounts);
      if (context && "previousSelected" in context) {
        setSelected(context.previousSelected ?? null);
      }
      toast.error(error.message);
    },
    onSettled: () => invalidateInbox(),
  });

  const bulk = useMutation({
    mutationFn: (action: BulkAction) =>
      mkBulk({ data: { ids: selectedIds, action } }),
    onMutate: (action) => {
      const previousCounts = applyOptimisticBulkAction(action);
      const previousEmailCaches = patchCachedEmails(selectedIds, (email) =>
        getBulkEmailPatch(email, action),
      );
      const previousSelected = selected;
      const selectedIdSet = new Set(selectedIds);
      setSelected((email) => {
        if (!email || !selectedIdSet.has(email.id)) return email;
        if (action === "archive" || action === "trash") return null;
        return { ...email, ...getBulkEmailPatch(email, action) };
      });
      return { previousCounts, previousEmailCaches, previousSelected };
    },
    onSuccess: () => {
      setSelectedIds([]);
    },
    onError: (error: Error, _action, context) => {
      restoreFolderCounts(context?.previousCounts);
      restoreEmailCaches(context?.previousEmailCaches);
      if (context && "previousSelected" in context) {
        setSelected(context.previousSelected ?? null);
      }
      toast.error(error.message);
    },
    onSettled: () => invalidateInbox(),
  });

  const handleAttachmentAction = async (
    attachment: EmailAttachment,
    action: AttachmentAction,
  ) => {
    if (!selected) return;

    let previewWindow: Window | null = null;
    if (action === "view" || action === "print") {
      previewWindow = window.open("", "_blank");
      if (!previewWindow) {
        toast.error("Allow pop-ups to view or print attachments.");
        return;
      }
      previewWindow.document.write(
        "<!doctype html><title>Loading attachment...</title><p>Loading attachment...</p>",
      );
    }

    setAttachmentAction({ id: attachment.id, action });
    try {
      if (action === "download")
        toast.loading("Downloading attachment...", {
          id: `attachment-${attachment.id}`,
        });
      const response = await fetchAttachmentResponse(
        attachment.id,
        action === "download" ? "attachment" : "inline",
      );
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const filename = attachment.filename;

      if (action === "download") {
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
        toast.success("Attachment downloaded successfully.", {
          id: `attachment-${attachment.id}`,
        });
        return;
      }

      if (!isPreviewableMimeType(attachment.mimeType)) {
        previewWindow?.close();
        if (action === "print") {
          const link = document.createElement("a");
          link.href = url;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          link.remove();
          toast.info(
            "This file must be opened in a compatible application before printing.",
          );
        } else {
          toast.info(
            "This file cannot be previewed. You can download it instead.",
          );
        }
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
        return;
      }

      if (action === "view") {
        if (attachment.mimeType.startsWith("text/")) {
          const text = await blob.text();
          previewWindow!.document.open();
          previewWindow!.document.write(
            createTextDocument(
              attachment.mimeType === "text/html"
                ? sanitizeHtml(text, {})
                : escapeHtml(text),
              filename,
              attachment.mimeType === "text/html",
              false,
            ),
          );
          previewWindow!.document.close();
        } else {
          previewWindow!.location.href = url;
        }
        window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
        return;
      }

      previewWindow!.document.open();
      if (attachment.mimeType.startsWith("image/")) {
        previewWindow!.document.write(createImagePrintDocument(url, filename));
      } else if (attachment.mimeType.startsWith("text/")) {
        const text = await blob.text();
        previewWindow!.document.write(
          createTextDocument(
            attachment.mimeType === "text/html"
              ? sanitizeHtml(text, {})
              : escapeHtml(text),
            filename,
            attachment.mimeType === "text/html",
            true,
          ),
        );
      } else {
        previewWindow!.document.write(createPrintDocument(url, filename));
      }
      previewWindow!.document.close();
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch (error) {
      previewWindow?.close();
      toast.error(
        error instanceof Error ? error.message : "Attachment action failed.",
        { id: `attachment-${attachment.id}` },
      );
    } finally {
      setAttachmentAction(null);
    }
  };

  return (
    <PageShell
      width={selected ? "wide" : "default"}
      className={selected ? "lg:pr-[60vw]" : undefined}
    >
      <PageHeader
        title="Inbox"
        description={
          showingUnread
            ? `Unread processed: ${Math.max(0, emails.length - unreadEmails.length)} of ${emails.length}. Remaining unread: ${unreadEmails.length}`
            : `${emails.length} email(s)`
        }
      >
        <div className="flex w-full gap-2 sm:w-auto">
          {accounts.length === 0 ? (
            <Button className="w-full sm:w-auto" variant="outline" asChild>
              <a href="/settings">Connect Gmail</a>
            </Button>
          ) : (
            <Button
              className="w-full sm:w-auto"
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
      </PageHeader>

      <ToolbarCard>
        <div className="mb-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between sm:hidden"
                >
                  <span className="flex items-center gap-2">
                    <FolderOpen className="h-4 w-4" />
                    {EMAIL_STATUS_META[status].label}
                  </span>
                  <Badge variant="secondary">
                    {formatFolderCount(
                      folderCounts[EMAIL_STATUS_META[status].countKey],
                    )}
                  </Badge>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[min(88vw,340px)]">
                <SheetHeader className="text-left">
                  <SheetTitle>Inbox folders</SheetTitle>
                  <SheetDescription>
                    Choose which Gmail messages to display.
                  </SheetDescription>
                </SheetHeader>
                <nav className="mt-6 space-y-1">
                  {EMAIL_STATUSES.map((folder) => {
                    const meta = EMAIL_STATUS_META[folder];
                    return (
                      <SheetClose key={folder} asChild>
                        <Link
                          to="/inbox"
                          search={{ status: folder }}
                          className={`flex h-10 w-full items-center justify-between rounded-md px-3 text-sm font-medium transition-colors hover:bg-accent ${
                            status === folder ? "bg-secondary" : ""
                          }`}
                        >
                          <span>{meta.label}</span>
                          <span className="text-xs">
                            {formatFolderCount(folderCounts[meta.countKey])}
                          </span>
                        </Link>
                      </SheetClose>
                    );
                  })}
                </nav>
              </SheetContent>
            </Sheet>
            <div className="-mx-1 hidden w-full overflow-x-auto pb-1 sm:mx-0 sm:block sm:overflow-visible sm:pb-0">
              <div className="flex min-w-max gap-2 px-1 sm:min-w-0 sm:flex-wrap sm:px-0">
                {EMAIL_STATUSES.map((filter) => {
                  const meta = EMAIL_STATUS_META[filter];
                  const count = folderCounts[meta.countKey];
                  const isActive = status === filter;

                  return (
                    <Button
                      key={filter}
                      variant={isActive ? "default" : "outline"}
                      size="sm"
                      asChild
                    >
                      <Link
                        to="/inbox"
                        search={{ status: filter }}
                        title={`${meta.description} Current count: ${count}.`}
                      >
                        <span>{meta.label}</span>
                        {folderCountsLoading ? (
                          <span
                            className={`ml-2 h-4 w-7 animate-pulse rounded-full ${
                              isActive ? "bg-primary-foreground/30" : "bg-muted"
                            }`}
                          />
                        ) : (
                          <span
                            className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                              isActive
                                ? "bg-primary-foreground/20 text-primary-foreground"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {formatFolderCount(count)}
                          </span>
                        )}
                      </Link>
                    </Button>
                  );
                })}
              </div>
            </div>
            {folderCountsError && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => refreshCounts()}
              >
                Retry counts
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Counts come from synced Gmail labels in Supabase. All Mail excludes
            Spam and Trash.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <div className="relative min-w-0 flex-1">
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
            className="w-full sm:w-44"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          {selectedIds.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
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
      </ToolbarCard>

      <DataCard>
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
                      className={
                        isEmailUnread(email) ? "bg-primary/[0.045]" : ""
                      }
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
                          aria-label={`Select ${email.subject || getSenderName(email)}`}
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
                                isEmailUnread(email)
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {getInitial(getSenderName(email))}
                            </AvatarFallback>
                          </Avatar>
                          <span className="min-w-0">
                            <span
                              className={`block max-w-40 truncate ${
                                isEmailUnread(email)
                                  ? "font-semibold"
                                  : "font-medium"
                              }`}
                            >
                              {getSenderName(email)}
                            </span>
                            <span className="block max-w-40 truncate text-xs text-muted-foreground">
                              {getSenderEmail(email)}
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
                              isEmailUnread(email)
                                ? "font-semibold"
                                : "font-medium"
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
                        <time
                          dateTime={getDateTimeAttribute(email.received_at)}
                        >
                          {formatEmailTimestamp(
                            email.received_at,
                            "MMM d, yyyy",
                            "Unknown date",
                          )}
                        </time>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        <time
                          dateTime={getDateTimeAttribute(email.received_at)}
                        >
                          {formatEmailTimestamp(
                            email.received_at,
                            "h:mm a",
                            "Unknown time",
                          )}
                        </time>
                      </TableCell>
                      <TableCell>
                        {isEmailUnread(email) ? (
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
                            title={
                              isEmailRead(email) ? "Mark unread" : "Mark read"
                            }
                            aria-label={
                              isEmailRead(email) ? "Mark unread" : "Mark read"
                            }
                            onClick={() =>
                              markRead.mutate({
                                id: email.id,
                                isRead: !isEmailRead(email),
                              })
                            }
                          >
                            {isEmailRead(email) ? (
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
                  className={`p-4 ${isEmailUnread(email) ? "bg-primary/[0.045]" : ""}`}
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
                      aria-label={`Select ${email.subject || getSenderName(email)}`}
                    />
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => openEmail(email)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span
                          className={`truncate text-sm ${
                            isEmailUnread(email)
                              ? "font-semibold"
                              : "font-medium"
                          }`}
                        >
                          {getSenderName(email)}
                        </span>
                        {isEmailUnread(email) && (
                          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                        )}
                      </div>
                      <p
                        className={`mt-1 truncate text-sm ${
                          isEmailUnread(email) ? "font-semibold" : ""
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
                          {formatEmailTimestamp(
                            email.received_at,
                            "MMM d, yyyy",
                            "Unknown date",
                          )}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Clock3 className="h-3.5 w-3.5" />
                          {formatEmailTimestamp(
                            email.received_at,
                            "h:mm a",
                            "Unknown time",
                          )}
                        </span>
                      </div>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </DataCard>

      <Dialog
        modal={false}
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent
          hideOverlay
          className="flex h-[100dvh] w-full max-w-none flex-col gap-0 overflow-hidden rounded-none border-border/70 bg-background p-0 shadow-2xl sm:h-[min(90dvh,860px)] sm:w-[calc(100%-2rem)] sm:max-w-4xl sm:rounded-2xl lg:left-auto lg:right-4 lg:top-[4.5rem] lg:h-[calc(100dvh-5.5rem)] lg:w-[58vw] lg:max-w-none lg:translate-x-0 lg:translate-y-0"
        >
          {selected && (
            <>
              <DialogHeader className="border-b bg-card px-4 py-4 pr-12 text-left sm:px-7 sm:py-5 sm:pr-14">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="mb-1 w-fit lg:hidden"
                  onClick={() => setSelected(null)}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Back to Inbox
                </Button>
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
                <DialogTitle className="break-words pt-2 text-lg leading-snug sm:text-2xl">
                  {selected.subject || "(no subject)"}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Email from {getSenderName(selected)}, received{" "}
                  {formatEmailTimestamp(
                    selected.received_at,
                    "PPpp",
                    "unknown date",
                  )}
                  .
                </DialogDescription>
                <div className="flex flex-col gap-4 pt-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="h-11 w-11">
                      <AvatarFallback className="bg-primary/10 font-semibold text-primary">
                        {getInitial(getSenderName(selected))}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {getSenderName(selected)}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {getSenderEmail(selected)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground sm:shrink-0">
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5" />
                      {formatEmailTimestamp(
                        selected.received_at,
                        "MMM d, yyyy",
                        "Unknown date",
                      )}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Clock3 className="h-3.5 w-3.5" />
                      {formatEmailTimestamp(
                        selected.received_at,
                        "h:mm a",
                        "Unknown time",
                      )}
                    </span>
                  </div>
                </div>
              </DialogHeader>

              <div className="flex shrink-0 flex-col gap-3 overflow-x-auto border-b bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-7">
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

                <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:overflow-visible sm:pb-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() =>
                      markRead.mutate({
                        id: selected.id,
                        isRead: !isEmailRead(selected),
                      })
                    }
                    title={isEmailRead(selected) ? "Mark unread" : "Mark read"}
                    aria-label={
                      isEmailRead(selected) ? "Mark unread" : "Mark read"
                    }
                  >
                    {isEmailRead(selected) ? (
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

              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-5 p-4 sm:space-y-6 sm:p-7">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">To:</span>
                    <span className="break-all">
                      {getEmailAddresses(selected.to_emails).join(", ") || "Me"}
                    </span>
                    {getEmailAddresses(selected.cc_emails).length > 0 && (
                      <>
                        <span className="mx-1 text-border">|</span>
                        <span className="font-medium text-foreground">Cc:</span>
                        <span className="break-all">
                          {getEmailAddresses(selected.cc_emails).join(", ")}
                        </span>
                      </>
                    )}
                  </div>
                  <EmailAttachments
                    attachments={attachments}
                    error={attachmentsError}
                    isLoading={attachmentsLoading}
                    pendingAction={attachmentAction}
                    onAction={handleAttachmentAction}
                  />
                  <div className="space-y-4">
                    {(threadMessages.length > 0
                      ? threadMessages
                      : [selected]
                    ).map((message) => (
                      <section
                        key={message.id}
                        className="min-w-0 rounded-xl border border-border/80 bg-card shadow-sm"
                      >
                        {threadMessages.length > 1 && (
                          <div className="flex flex-col gap-1 border-b px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-6">
                            <strong className="min-w-0 truncate">
                              {getSenderName(message)}
                            </strong>
                            <time
                              className="text-muted-foreground"
                              dateTime={getDateTimeAttribute(
                                message.sent_at ?? message.received_at,
                              )}
                            >
                              {formatEmailTimestamp(
                                message.sent_at ?? message.received_at,
                                "PPp",
                                "Unknown date",
                              )}
                            </time>
                          </div>
                        )}
                        <article
                          className={`prose prose-sm dark:prose-invert max-w-none overflow-x-hidden break-words p-4 leading-relaxed sm:p-7 [&_a]:break-all [&_img]:h-auto [&_img]:max-w-full [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto ${
                            message.body_html ? "" : "whitespace-pre-wrap"
                          }`}
                          dangerouslySetInnerHTML={{
                            __html: sanitizeHtml(
                              message.body_html ||
                                message.body_text ||
                                message.snippet ||
                                "",
                              inlineAttachmentUrls,
                            ),
                          }}
                        />
                      </section>
                    ))}
                  </div>
                </div>
                <ReplyBox
                  key={selected.id}
                  email={selected}
                  accountId={accounts[0]?.id}
                />
              </ScrollArea>
            </>
          )}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function sanitizeHtml(
  html: string,
  inlineAttachmentUrls: Record<string, string>,
): string {
  if (typeof DOMParser === "undefined") {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/\son\w+="[^"]*"/gi, "")
      .replace(/\son\w+='[^']*'/gi, "");
  }

  const document = new DOMParser().parseFromString(html, "text/html");
  document
    .querySelectorAll(
      "script, iframe, object, embed, form, input, button, base, meta, link",
    )
    .forEach((element) => element.remove());
  document.querySelectorAll("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on") || name === "srcdoc") {
        element.removeAttribute(attribute.name);
      }
      if (
        (name === "href" || name === "src" || name === "xlink:href") &&
        /^(javascript|vbscript|data:text\/html)/i.test(value)
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  document.querySelectorAll("img").forEach((image) => {
    const src = image.getAttribute("src") ?? "";
    if (src.toLowerCase().startsWith("cid:")) {
      const contentId = src.slice(4).replace(/^<|>$/g, "");
      const secureUrl = inlineAttachmentUrls[contentId];
      if (secureUrl) image.setAttribute("src", secureUrl);
      else image.removeAttribute("src");
    }
    image.removeAttribute("srcset");
    image.style.maxWidth = "100%";
    image.style.height = "auto";
  });
  document.querySelectorAll("a").forEach((anchor) => {
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  });
  return document.body.innerHTML;
}

function EmailAttachments({
  attachments,
  error,
  isLoading,
  pendingAction,
  onAction,
}: {
  attachments: EmailAttachment[];
  error: unknown;
  isLoading: boolean;
  pendingAction: { id: string; action: AttachmentAction } | null;
  onAction: (attachment: EmailAttachment, action: AttachmentAction) => void;
}) {
  if (isLoading) {
    return (
      <section className="rounded-xl border border-border/80 bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading attachments...
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {error instanceof Error
          ? error.message
          : "Could not load email attachments."}
      </section>
    );
  }

  if (attachments.length === 0) return null;

  return (
    <section className="rounded-xl border border-border/80 bg-card p-3 shadow-sm sm:p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Paperclip className="h-4 w-4 text-primary" />
        Attachments ({attachments.length})
      </div>
      <div className="space-y-2">
        {attachments.map((attachment) => {
          const isBusy = pendingAction?.id === attachment.id;
          return (
            <div
              key={attachment.id}
              className="flex flex-col gap-3 rounded-lg border border-border/70 bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="break-all text-sm font-medium sm:truncate">
                    {attachment.filename}
                  </p>
                  <p className="break-all text-xs text-muted-foreground sm:truncate">
                    {attachment.mimeType} /{" "}
                    {formatAttachmentSize(attachment.size)}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full sm:w-auto"
                  disabled={!!pendingAction}
                  onClick={() => onAction(attachment, "view")}
                >
                  {isBusy && pendingAction?.action === "view" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Eye className="mr-2 h-4 w-4" />
                  )}
                  View
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full sm:w-auto"
                  disabled={!!pendingAction}
                  onClick={() => onAction(attachment, "download")}
                >
                  {isBusy && pendingAction?.action === "download" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Download
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full sm:w-auto"
                  disabled={!!pendingAction}
                  onClick={() => onAction(attachment, "print")}
                >
                  {isBusy && pendingAction?.action === "print" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Printer className="mr-2 h-4 w-4" />
                  )}
                  Print
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function formatAttachmentSize(size: number) {
  if (!size) return "Unknown size";
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function createPrintDocument(url: string, filename: string) {
  const safeUrl = escapeHtml(url);
  const safeFilename = escapeHtml(filename);
  return `<!doctype html>
<html>
  <head>
    <title>${safeFilename}</title>
    <style>
      html, body, iframe { height: 100%; margin: 0; width: 100%; }
      iframe { border: 0; }
    </style>
  </head>
  <body>
    <iframe title="${safeFilename}" src="${safeUrl}"></iframe>
    <script>
      const frame = document.querySelector("iframe");
      frame.addEventListener("load", () => {
        setTimeout(() => {
          try {
            frame.contentWindow.focus();
            frame.contentWindow.print();
          } catch {
            window.print();
          }
        }, 250);
      });
    </script>
  </body>
</html>`;
}

function createImagePrintDocument(url: string, filename: string) {
  const safeUrl = escapeHtml(url);
  const safeFilename = escapeHtml(filename);
  return `<!doctype html>
<html>
  <head>
    <title>${safeFilename}</title>
    <style>
      body { margin: 0; padding: 24px; text-align: center; }
      img { height: auto; max-width: 100%; }
    </style>
  </head>
  <body>
    <img alt="${safeFilename}" src="${safeUrl}" />
    <script>
      const image = document.querySelector("img");
      image.addEventListener("load", () => {
        window.focus();
        window.print();
      });
    </script>
  </body>
</html>`;
}

function createTextDocument(
  content: string,
  filename: string,
  isHtml: boolean,
  printAfterLoad: boolean,
) {
  const safeFilename = escapeHtml(filename);
  return `<!doctype html>
<html>
  <head>
    <title>${safeFilename}</title>
    <style>
      body { color: #111827; font: 14px/1.6 system-ui, sans-serif; margin: 0 auto; max-width: 900px; padding: 32px; }
      pre { overflow-wrap: anywhere; white-space: pre-wrap; }
      img { height: auto; max-width: 100%; }
      table { display: block; max-width: 100%; overflow-x: auto; }
    </style>
  </head>
  <body>${isHtml ? content : `<pre>${content}</pre>`}</body>
  ${
    printAfterLoad
      ? "<script>window.addEventListener('load', () => { window.focus(); window.print(); });</script>"
      : ""
  }
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ReplyBox({ email, accountId }: { email: Email; accountId?: string }) {
  const qc = useQueryClient();
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
      qc.invalidateQueries({ queryKey: ["emails"] });
      qc.invalidateQueries({ queryKey: ["email-thread"] });
      qc.invalidateQueries({ queryKey: ["email-folder-counts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["sidebar-counters"] });
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
              Reply to {getSenderName(email)}
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
