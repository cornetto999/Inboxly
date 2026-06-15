-- Add durable Gmail attachment metadata, replied-thread state, account
-- connection health, and personal organizations without removing legacy data.

CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_members TO authenticated;
GRANT ALL ON public.organizations, public.organization_members TO service_role;

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_organization_member(_organization_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE organization_id = _organization_id
      AND user_id = _user_id
  )
$$;

REVOKE EXECUTE ON FUNCTION public.is_organization_member(UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_organization_member(UUID, UUID)
  TO authenticated, service_role;

DROP POLICY IF EXISTS "organization members view organizations" ON public.organizations;
CREATE POLICY "organization members view organizations"
  ON public.organizations FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR public.is_organization_member(id, auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "organization owners manage organizations" ON public.organizations;
CREATE POLICY "organization owners manage organizations"
  ON public.organizations FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "organization members view memberships" ON public.organization_members;
CREATE POLICY "organization members view memberships"
  ON public.organization_members FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_organization_member(organization_id, auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "organization owners manage memberships" ON public.organization_members;
CREATE POLICY "organization owners manage memberships"
  ON public.organization_members FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organizations
      WHERE organizations.id = organization_id
        AND organizations.owner_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organizations
      WHERE organizations.id = organization_id
        AND organizations.owner_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'admin')
  );

DROP TRIGGER IF EXISTS organizations_updated_at ON public.organizations;
CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.organizations (owner_id, name)
SELECT
  users.id,
  COALESCE(
    NULLIF(users.raw_user_meta_data->>'full_name', ''),
    NULLIF(users.raw_user_meta_data->>'name', ''),
    NULLIF(users.email, ''),
    'My organization'
  )
FROM auth.users AS users
ON CONFLICT (owner_id) DO NOTHING;

INSERT INTO public.organization_members (organization_id, user_id, role)
SELECT organizations.id, organizations.owner_id, 'owner'
FROM public.organizations
ON CONFLICT (organization_id, user_id) DO NOTHING;

ALTER TABLE public.email_accounts
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS access_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS refresh_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS connection_status TEXT NOT NULL DEFAULT 'connected',
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;

UPDATE public.email_accounts AS accounts
SET
  organization_id = organizations.id,
  last_synced_at = COALESCE(accounts.last_synced_at, accounts.last_sync_at),
  connected_at = COALESCE(accounts.connected_at, accounts.created_at),
  connection_status = CASE
    WHEN accounts.connection_status IS NULL OR accounts.connection_status = ''
      THEN 'connected'
    ELSE accounts.connection_status
  END
FROM public.organizations
WHERE organizations.owner_id = accounts.user_id
  AND accounts.organization_id IS NULL;

ALTER TABLE public.email_accounts
  DROP CONSTRAINT IF EXISTS email_accounts_connection_status_check;
ALTER TABLE public.email_accounts
  ADD CONSTRAINT email_accounts_connection_status_check
  CHECK (
    connection_status IN (
      'disconnected',
      'connecting',
      'connected',
      'syncing',
      'reauthentication_required',
      'sync_failed'
    )
  );

CREATE INDEX IF NOT EXISTS email_accounts_organization_idx
  ON public.email_accounts(organization_id, connection_status);

ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

UPDATE public.emails AS emails
SET organization_id = accounts.organization_id
FROM public.email_accounts AS accounts
WHERE accounts.id = emails.account_id
  AND emails.organization_id IS NULL;

CREATE INDEX IF NOT EXISTS emails_organization_thread_idx
  ON public.emails(organization_id, account_id, gmail_thread_id, received_at);

CREATE OR REPLACE FUNCTION public.set_email_organization()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT organization_id
    INTO NEW.organization_id
    FROM public.email_accounts
    WHERE id = NEW.account_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS emails_set_organization ON public.emails;
CREATE TRIGGER emails_set_organization
  BEFORE INSERT OR UPDATE OF account_id, organization_id ON public.emails
  FOR EACH ROW EXECUTE FUNCTION public.set_email_organization();

CREATE TABLE IF NOT EXISTS public.email_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  email_account_id UUID NOT NULL REFERENCES public.email_accounts(id) ON DELETE CASCADE,
  gmail_thread_id TEXT NOT NULL,
  representative_email_id UUID REFERENCES public.emails(id) ON DELETE SET NULL,
  has_reply BOOLEAN NOT NULL DEFAULT false,
  last_replied_at TIMESTAMPTZ,
  last_reply_message_id TEXT,
  replied_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  original_sender_email TEXT,
  original_sender_name TEXT,
  latest_subject TEXT,
  original_preview TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  latest_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email_account_id, gmail_thread_id)
);

CREATE INDEX IF NOT EXISTS email_threads_replied_idx
  ON public.email_threads(email_account_id, has_reply, last_replied_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_threads TO authenticated;
GRANT ALL ON public.email_threads TO service_role;
ALTER TABLE public.email_threads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email thread account access" ON public.email_threads;
CREATE POLICY "email thread account access"
  ON public.email_threads FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.email_accounts
      WHERE email_accounts.id = email_account_id
        AND (
          email_accounts.user_id = auth.uid()
          OR public.is_organization_member(email_accounts.organization_id, auth.uid())
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.email_accounts
      WHERE email_accounts.id = email_account_id
        AND (
          email_accounts.user_id = auth.uid()
          OR public.is_organization_member(email_accounts.organization_id, auth.uid())
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  );

DROP TRIGGER IF EXISTS email_threads_updated_at ON public.email_threads;
CREATE TRIGGER email_threads_updated_at
  BEFORE UPDATE ON public.email_threads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.email_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  email_account_id UUID NOT NULL REFERENCES public.email_accounts(id) ON DELETE CASCADE,
  email_id UUID NOT NULL REFERENCES public.emails(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  gmail_attachment_id TEXT,
  gmail_part_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  content_id TEXT,
  is_inline BOOLEAN NOT NULL DEFAULT false,
  storage_path TEXT,
  body_data TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email_id, gmail_part_id, filename)
);

CREATE INDEX IF NOT EXISTS email_attachments_email_idx
  ON public.email_attachments(email_id, created_at);
CREATE INDEX IF NOT EXISTS email_attachments_content_id_idx
  ON public.email_attachments(email_id, content_id)
  WHERE content_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_attachments TO authenticated;
GRANT ALL ON public.email_attachments TO service_role;
ALTER TABLE public.email_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email attachment account access" ON public.email_attachments;
CREATE POLICY "email attachment account access"
  ON public.email_attachments FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.email_accounts
      WHERE email_accounts.id = email_account_id
        AND (
          email_accounts.user_id = auth.uid()
          OR public.is_organization_member(email_accounts.organization_id, auth.uid())
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.email_accounts
      WHERE email_accounts.id = email_account_id
        AND (
          email_accounts.user_id = auth.uid()
          OR public.is_organization_member(email_accounts.organization_id, auth.uid())
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  );

DROP TRIGGER IF EXISTS email_attachments_updated_at ON public.email_attachments;
CREATE TRIGGER email_attachments_updated_at
  BEFORE UPDATE ON public.email_attachments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Create a personal organization for future users as part of the existing
-- profile/role trigger. Existing role behavior is preserved.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_organization_id UUID;
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'staff')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  INSERT INTO public.organizations (owner_id, name)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
      NULLIF(NEW.raw_user_meta_data->>'name', ''),
      NULLIF(NEW.email, ''),
      'My organization'
    )
  )
  ON CONFLICT (owner_id) DO UPDATE SET owner_id = EXCLUDED.owner_id
  RETURNING id INTO new_organization_id;

  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (new_organization_id, NEW.id, 'owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name TEXT;
  realtime_tables TEXT[] := ARRAY[
    'email_attachments',
    'email_threads',
    'organization_members',
    'organizations'
  ];
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    FOREACH table_name IN ARRAY realtime_tables LOOP
      BEGIN
        EXECUTE format(
          'ALTER TABLE public.%I REPLICA IDENTITY FULL',
          table_name
        );
        EXECUTE format(
          'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
          table_name
        );
      EXCEPTION
        WHEN duplicate_object THEN NULL;
        WHEN undefined_table THEN NULL;
      END;
    END LOOP;
  END IF;
END;
$$;
