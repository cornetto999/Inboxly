-- Keep Gmail folder counts fast and make older installs safe to upgrade.
-- This app stores Gmail account ownership in account_id and raw Gmail labels in labels.

ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS is_starred BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_sent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_spam BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_trashed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_attachments BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS emails_account_folder_counts_idx
  ON public.emails (
    account_id,
    is_read,
    is_starred,
    is_sent,
    is_draft,
    is_archived,
    is_spam,
    is_trashed
  );

CREATE INDEX IF NOT EXISTS emails_user_folder_counts_idx
  ON public.emails (
    user_id,
    is_read,
    is_starred,
    is_sent,
    is_draft,
    is_archived,
    is_spam,
    is_trashed
  );

CREATE INDEX IF NOT EXISTS emails_labels_gin_idx
  ON public.emails USING GIN (labels);
