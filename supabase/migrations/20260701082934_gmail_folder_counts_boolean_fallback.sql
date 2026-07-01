-- Keep Gmail folder counts label-first, but fall back to boolean folder flags
-- for legacy or partially synced rows where label_ids/labels are empty.

ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS gmail_history_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS emails_account_gmail_message_unique_idx
  ON public.emails(account_id, gmail_message_id);

CREATE INDEX IF NOT EXISTS emails_gmail_history_id_idx
  ON public.emails(account_id, gmail_history_id)
  WHERE gmail_history_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_email_gmail_label_state()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_labels TEXT[];
BEGIN
  next_labels := COALESCE(NEW.label_ids, NEW.labels, '{}');

  IF cardinality(next_labels) = 0 AND cardinality(COALESCE(NEW.labels, '{}')) > 0 THEN
    next_labels := NEW.labels;
  END IF;

  NEW.label_ids := COALESCE(next_labels, '{}');
  NEW.labels := NEW.label_ids;
  NEW.is_read := NOT ('UNREAD' = ANY(NEW.label_ids));
  NEW.is_starred := 'STARRED' = ANY(NEW.label_ids);
  NEW.is_sent := 'SENT' = ANY(NEW.label_ids);
  NEW.is_draft := 'DRAFT' = ANY(NEW.label_ids);
  NEW.is_spam := 'SPAM' = ANY(NEW.label_ids);
  NEW.is_trashed := 'TRASH' = ANY(NEW.label_ids);
  NEW.is_archived :=
    NOT ('INBOX' = ANY(NEW.label_ids))
    AND NOT NEW.is_spam
    AND NOT NEW.is_trashed;
  NEW.last_synced_at := COALESCE(NEW.last_synced_at, now());

  IF NEW.has_replied = false THEN
    NEW.replied_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_gmail_folder_counts(p_account_id UUID DEFAULT NULL)
RETURNS TABLE (
  all_mail BIGINT,
  unread BIGINT,
  read BIGINT,
  starred BIGINT,
  replied BIGINT,
  sent BIGINT,
  drafts BIGINT,
  archived BIGINT,
  spam BIGINT,
  trash BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH scoped_messages AS (
    SELECT DISTINCT ON (emails.gmail_message_id)
      emails.gmail_message_id,
      COALESCE(NULLIF(emails.label_ids, '{}'::TEXT[]), emails.labels, '{}'::TEXT[]) AS labels,
      COALESCE(emails.has_replied, false) AS has_replied,
      COALESCE(emails.is_read, true) AS is_read,
      COALESCE(emails.is_starred, false) AS is_starred,
      COALESCE(emails.is_sent, false) AS is_sent,
      COALESCE(emails.is_draft, false) AS is_draft,
      COALESCE(emails.is_archived, false) AS is_archived,
      COALESCE(emails.is_spam, false) AS is_spam,
      COALESCE(emails.is_trashed, false) AS is_trashed
    FROM public.emails
    WHERE emails.user_id = auth.uid()
      AND (p_account_id IS NULL OR emails.account_id = p_account_id)
    ORDER BY
      emails.gmail_message_id,
      emails.last_synced_at DESC NULLS LAST,
      emails.received_at DESC NULLS LAST,
      emails.created_at DESC
  ),
  states AS (
    SELECT
      gmail_message_id,
      has_replied,
      CASE
        WHEN cardinality(labels) > 0 THEN 'UNREAD' = ANY(labels)
        ELSE NOT is_read
      END AS has_unread,
      CASE
        WHEN cardinality(labels) > 0 THEN 'STARRED' = ANY(labels)
        ELSE is_starred
      END AS has_starred,
      CASE
        WHEN cardinality(labels) > 0 THEN 'SENT' = ANY(labels)
        ELSE is_sent
      END AS has_sent,
      CASE
        WHEN cardinality(labels) > 0 THEN 'DRAFT' = ANY(labels)
        ELSE is_draft
      END AS has_draft,
      CASE
        WHEN cardinality(labels) > 0 THEN 'SPAM' = ANY(labels)
        ELSE is_spam
      END AS has_spam,
      CASE
        WHEN cardinality(labels) > 0 THEN 'TRASH' = ANY(labels)
        ELSE is_trashed
      END AS has_trash,
      CASE
        WHEN cardinality(labels) > 0 THEN
          NOT ('INBOX' = ANY(labels))
          AND NOT ('SPAM' = ANY(labels))
          AND NOT ('TRASH' = ANY(labels))
        ELSE is_archived
      END AS has_archived
    FROM scoped_messages
  )
  SELECT
    COUNT(DISTINCT gmail_message_id) FILTER (
      WHERE NOT has_spam AND NOT has_trash
    ) AS all_mail,
    COUNT(DISTINCT gmail_message_id) FILTER (
      WHERE has_unread
    ) AS unread,
    COUNT(DISTINCT gmail_message_id) FILTER (
      WHERE NOT has_unread
    ) AS read,
    COUNT(DISTINCT gmail_message_id) FILTER (
      WHERE has_starred
    ) AS starred,
    COUNT(DISTINCT gmail_message_id) FILTER (
      WHERE has_replied
    ) AS replied,
    COUNT(DISTINCT gmail_message_id) FILTER (
      WHERE has_sent
    ) AS sent,
    COUNT(DISTINCT gmail_message_id) FILTER (
      WHERE has_draft
    ) AS drafts,
    COUNT(DISTINCT gmail_message_id) FILTER (
      WHERE has_archived
    ) AS archived,
    COUNT(DISTINCT gmail_message_id) FILTER (
      WHERE has_spam
    ) AS spam,
    COUNT(DISTINCT gmail_message_id) FILTER (
      WHERE has_trash
    ) AS trash
  FROM states;
$$;

GRANT EXECUTE ON FUNCTION public.get_gmail_folder_counts(UUID) TO authenticated;
