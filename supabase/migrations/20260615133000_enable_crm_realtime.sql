-- Enable Supabase Realtime change events for CRM tables used by the UI.
-- The app only uses these events to refetch authorized data through RLS-safe APIs.

DO $$
DECLARE
  table_name TEXT;
  realtime_tables TEXT[] := ARRAY[
    'activity_logs',
    'campaign_recipients',
    'campaigns',
    'contacts',
    'customers',
    'email_accounts',
    'email_templates',
    'emails',
    'leads',
    'notes',
    'profiles',
    'reminders',
    'tasks',
    'user_roles'
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
