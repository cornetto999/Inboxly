export const EMAIL_FOLDER_COUNT_KEYS = [
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

export type EmailFolderCountKey = (typeof EMAIL_FOLDER_COUNT_KEYS)[number];
export type EmailFolderCounts = Record<EmailFolderCountKey, number>;

export const EMPTY_EMAIL_FOLDER_COUNTS: EmailFolderCounts =
  EMAIL_FOLDER_COUNT_KEYS.reduce(
    (counts, key) => ({ ...counts, [key]: 0 }),
    {} as EmailFolderCounts,
  );

export type EmailFolderStateRow = {
  id?: string | null;
  gmail_message_id?: string | null;
  label_ids?: unknown;
  labels?: unknown;
  has_replied?: boolean | null;
  replied_at?: string | null;
  is_read?: boolean | null;
  is_starred?: boolean | null;
  is_sent?: boolean | null;
  is_draft?: boolean | null;
  is_archived?: boolean | null;
  is_spam?: boolean | null;
  is_trashed?: boolean | null;
  last_synced_at?: string | null;
  received_at?: string | null;
  sent_at?: string | null;
  created_at?: string | null;
};

function getStringLabels(labels: unknown) {
  if (!Array.isArray(labels)) return [];
  return labels.filter((label): label is string => typeof label === "string");
}

export function getEmailLabels(
  row: Pick<EmailFolderStateRow, "label_ids" | "labels">,
) {
  const labelIds = getStringLabels(row.label_ids);
  if (labelIds.length > 0) return labelIds;

  return getStringLabels(row.labels);
}

export function getEmailFolderState(row: EmailFolderStateRow) {
  const labels = getEmailLabels(row).map((label) => label.toUpperCase());
  const hasSyncedLabels = labels.length > 0;
  const hasLabel = (label: string) => labels.includes(label);
  const hasUnread = hasSyncedLabels
    ? hasLabel("UNREAD")
    : row.is_read === false;
  const isSent = hasLabel("SENT") || (!hasSyncedLabels && Boolean(row.is_sent));
  const isDraft =
    hasLabel("DRAFT") || (!hasSyncedLabels && Boolean(row.is_draft));
  const isSpam = hasLabel("SPAM") || (!hasSyncedLabels && Boolean(row.is_spam));
  const isTrashed =
    hasLabel("TRASH") || (!hasSyncedLabels && Boolean(row.is_trashed));
  const isArchived = hasSyncedLabels
    ? !hasLabel("INBOX") && !isSpam && !isTrashed
    : Boolean(row.is_archived);
  const canBeReadOrUnread = !isSent && !isDraft && !isSpam && !isTrashed;

  return {
    isAllMail: !isSpam && !isTrashed,
    isUnread: hasUnread && canBeReadOrUnread,
    isRead: !hasUnread && canBeReadOrUnread,
    isStarred:
      (hasLabel("STARRED") || (!hasSyncedLabels && Boolean(row.is_starred))) &&
      !isSpam &&
      !isTrashed,
    isReplied: Boolean(row.has_replied) && canBeReadOrUnread,
    isSent: isSent && !isTrashed,
    isDraft: isDraft && !isTrashed,
    isArchived,
    isSpam,
    isTrashed,
  };
}

function getRowTimestamp(row: EmailFolderStateRow) {
  return Math.max(
    ...[row.last_synced_at, row.sent_at, row.received_at, row.created_at].map(
      (value) => {
        if (!value) return 0;
        const time = new Date(value).getTime();
        return Number.isNaN(time) ? 0 : time;
      },
    ),
  );
}

function getCanonicalEmailFolderRows(rows: EmailFolderStateRow[]) {
  const latestByMessageId = new Map<string, EmailFolderStateRow>();

  for (const row of rows) {
    const messageId = row.gmail_message_id ?? row.id;
    if (!messageId) continue;

    const current = latestByMessageId.get(messageId);
    if (!current || getRowTimestamp(row) >= getRowTimestamp(current)) {
      latestByMessageId.set(messageId, row);
    }
  }

  return Array.from(latestByMessageId.values());
}

export function countEmailFolderRows(rows: EmailFolderStateRow[]) {
  return getCanonicalEmailFolderRows(rows).reduce<EmailFolderCounts>(
    (counts, row) => {
      const state = getEmailFolderState(row);

      if (state.isAllMail) counts.all += 1;
      if (state.isUnread) counts.unread += 1;
      if (state.isRead) counts.read += 1;
      if (state.isStarred) counts.starred += 1;
      if (state.isReplied) counts.replied += 1;
      if (state.isSent) counts.sent += 1;
      if (state.isDraft) counts.drafts += 1;
      if (state.isArchived) counts.archived += 1;
      if (state.isSpam) counts.spam += 1;
      if (state.isTrashed) counts.trash += 1;

      return counts;
    },
    { ...EMPTY_EMAIL_FOLDER_COUNTS },
  );
}
