-- Keep read/unread counts aligned with the inbox folder rules.
-- Read/unread excludes Sent, Drafts, Spam, and Trash, and duplicate
-- synced rows are resolved to the most recently synced Gmail message state.

CREATE OR REPLACE FUNCTION public.get_gmail_folder_counts_v2(p_account_id UUID DEFAULT NULL)
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
    SELECT DISTINCT ON (COALESCE(emails.gmail_message_id, emails.id::TEXT))
      COALESCE(emails.gmail_message_id, emails.id::TEXT) AS message_key,
      ARRAY(
        SELECT UPPER(synced_label.label)
        FROM UNNEST(COALESCE(NULLIF(emails.label_ids, '{}'::TEXT[]), emails.labels, '{}'::TEXT[])) AS synced_label(label)
      ) AS labels,
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
      COALESCE(emails.gmail_message_id, emails.id::TEXT),
      emails.last_synced_at DESC NULLS LAST,
      emails.received_at DESC NULLS LAST,
      emails.created_at DESC
  ),
  states AS (
    SELECT
      message_key,
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
    COUNT(DISTINCT message_key) FILTER (
      WHERE NOT has_spam AND NOT has_trash
    ) AS all_mail,
    COUNT(DISTINCT message_key) FILTER (
      WHERE has_unread AND NOT has_sent AND NOT has_draft AND NOT has_spam AND NOT has_trash
    ) AS unread,
    COUNT(DISTINCT message_key) FILTER (
      WHERE NOT has_unread AND NOT has_sent AND NOT has_draft AND NOT has_spam AND NOT has_trash
    ) AS read,
    COUNT(DISTINCT message_key) FILTER (
      WHERE has_starred AND NOT has_spam AND NOT has_trash
    ) AS starred,
    COUNT(DISTINCT message_key) FILTER (
      WHERE has_replied AND NOT has_sent AND NOT has_draft AND NOT has_spam AND NOT has_trash
    ) AS replied,
    COUNT(DISTINCT message_key) FILTER (
      WHERE has_sent AND NOT has_trash
    ) AS sent,
    COUNT(DISTINCT message_key) FILTER (
      WHERE has_draft AND NOT has_trash
    ) AS drafts,
    COUNT(DISTINCT message_key) FILTER (
      WHERE has_archived
    ) AS archived,
    COUNT(DISTINCT message_key) FILTER (
      WHERE has_spam
    ) AS spam,
    COUNT(DISTINCT message_key) FILTER (
      WHERE has_trash
    ) AS trash
  FROM states;
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
  SELECT *
  FROM public.get_gmail_folder_counts_v2(p_account_id);
$$;

GRANT EXECUTE ON FUNCTION public.get_gmail_folder_counts(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_gmail_folder_counts_v2(UUID) TO authenticated;
