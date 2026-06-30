-- Canonical Gmail label state for mailbox folders and realtime-safe counts.

ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS label_ids TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS has_replied BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS is_starred BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_sent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_spam BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_trashed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_attachments BOOLEAN NOT NULL DEFAULT false;

UPDATE public.emails
SET label_ids = labels
WHERE cardinality(label_ids) = 0
  AND cardinality(labels) > 0;

WITH duplicate_emails AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, gmail_message_id
      ORDER BY last_synced_at DESC NULLS LAST, received_at DESC NULLS LAST, created_at DESC, id DESC
    ) AS duplicate_rank
  FROM public.emails
)
DELETE FROM public.emails
WHERE id IN (
  SELECT id
  FROM duplicate_emails
  WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS emails_user_gmail_message_unique_idx
  ON public.emails(user_id, gmail_message_id);

CREATE INDEX IF NOT EXISTS emails_label_ids_gin_idx
  ON public.emails USING GIN (label_ids);

CREATE INDEX IF NOT EXISTS emails_user_last_synced_idx
  ON public.emails(user_id, last_synced_at DESC);

CREATE INDEX IF NOT EXISTS emails_replied_idx
  ON public.emails(user_id, has_replied, replied_at DESC)
  WHERE has_replied = true;

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
    AND NOT NEW.is_sent
    AND NOT NEW.is_draft
    AND NOT NEW.is_spam
    AND NOT NEW.is_trashed;
  NEW.last_synced_at := COALESCE(NEW.last_synced_at, now());

  IF NEW.has_replied = false THEN
    NEW.replied_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS emails_gmail_label_state_sync ON public.emails;
CREATE TRIGGER emails_gmail_label_state_sync
  BEFORE INSERT OR UPDATE OF label_ids, labels, has_replied, replied_at
  ON public.emails
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_email_gmail_label_state();

UPDATE public.emails
SET label_ids = COALESCE(NULLIF(label_ids, '{}'::TEXT[]), labels, '{}'::TEXT[]);

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
      COALESCE(emails.has_replied, false) AS has_replied
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
      'UNREAD' = ANY(labels) AS has_unread,
      'STARRED' = ANY(labels) AS has_starred,
      'INBOX' = ANY(labels) AS has_inbox,
      'SENT' = ANY(labels) AS has_sent,
      'DRAFT' = ANY(labels) AS has_draft,
      'SPAM' = ANY(labels) AS has_spam,
      'TRASH' = ANY(labels) AS has_trash
    FROM scoped_messages
  )
  SELECT
    COUNT(DISTINCT gmail_message_id) FILTER (
      WHERE NOT has_spam AND NOT has_trash
    ) AS all_mail,
    COUNT(DISTINCT gmail_message_id) FILTER (
      WHERE has_unread AND NOT has_sent AND NOT has_draft AND NOT has_spam AND NOT has_trash
    ) AS unread,
    COUNT(DISTINCT gmail_message_id) FILTER (
      WHERE NOT has_unread AND NOT has_sent AND NOT has_draft AND NOT has_spam AND NOT has_trash
    ) AS read,
    COUNT(DISTINCT gmail_message_id) FILTER (
      WHERE has_starred AND NOT has_spam AND NOT has_trash
    ) AS starred,
    COUNT(DISTINCT gmail_message_id) FILTER (
      WHERE has_replied AND NOT has_sent AND NOT has_draft AND NOT has_spam AND NOT has_trash
    ) AS replied,
    COUNT(DISTINCT gmail_message_id) FILTER (
      WHERE has_sent AND NOT has_trash
    ) AS sent,
    COUNT(DISTINCT gmail_message_id) FILTER (
      WHERE has_draft AND NOT has_trash
    ) AS drafts,
    COUNT(DISTINCT gmail_message_id) FILTER (
      WHERE NOT has_inbox AND NOT has_sent AND NOT has_draft AND NOT has_spam AND NOT has_trash
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

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    ALTER TABLE public.emails REPLICA IDENTITY FULL;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.emails;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END;
$$;
