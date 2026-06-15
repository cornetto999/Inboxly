-- Users created before the CRM schema was installed never fired handle_new_user().
-- Backfill their profiles and give users without a role the staff role.

INSERT INTO public.profiles (id, full_name, avatar_url, created_at, updated_at)
SELECT
  users.id,
  COALESCE(
    users.raw_user_meta_data->>'full_name',
    users.raw_user_meta_data->>'name'
  ),
  users.raw_user_meta_data->>'avatar_url',
  users.created_at,
  now()
FROM auth.users AS users
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  first_user_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE role = 'admin'
  ) THEN
    SELECT id
    INTO first_user_id
    FROM auth.users
    ORDER BY created_at
    LIMIT 1;

    IF first_user_id IS NOT NULL THEN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (first_user_id, 'admin')
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
  END IF;
END;
$$;

INSERT INTO public.user_roles (user_id, role)
SELECT users.id, 'staff'::public.app_role
FROM auth.users AS users
WHERE NOT EXISTS (
  SELECT 1
  FROM public.user_roles AS roles
  WHERE roles.user_id = users.id
)
ON CONFLICT (user_id, role) DO NOTHING;
