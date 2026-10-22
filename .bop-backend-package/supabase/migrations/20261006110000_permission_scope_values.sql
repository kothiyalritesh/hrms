-- =============================================================================
-- 20261006110000_permission_scope_values.sql
--
-- Adds every scope value used by the Permission Manager to the permission_scope
-- enum (if the enum exists) and adds teams.parent_id for TEAM_TREE scopes.
--
-- Kept separate from 20261006120000 on purpose: Postgres does not allow a new
-- enum value to be USED in the same transaction that adds it. In the SQL editor,
-- run this file on its own first, then run 20261006120000.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE n.nspname = 'public' AND t.typname = 'permission_scope') THEN
    ALTER TYPE public.permission_scope ADD VALUE IF NOT EXISTS 'GLOBAL';
    ALTER TYPE public.permission_scope ADD VALUE IF NOT EXISTS 'OFFICE';
    ALTER TYPE public.permission_scope ADD VALUE IF NOT EXISTS 'OFFICE_TREE';
    ALTER TYPE public.permission_scope ADD VALUE IF NOT EXISTS 'TEAM';
    ALTER TYPE public.permission_scope ADD VALUE IF NOT EXISTS 'TEAM_TREE';
    ALTER TYPE public.permission_scope ADD VALUE IF NOT EXISTS 'REPORTS_TO';
    ALTER TYPE public.permission_scope ADD VALUE IF NOT EXISTS 'DEPARTMENT';
    ALTER TYPE public.permission_scope ADD VALUE IF NOT EXISTS 'ASSIGNED';
    ALTER TYPE public.permission_scope ADD VALUE IF NOT EXISTS 'SELF';
  END IF;
END $$;

-- Team hierarchy for TEAM_TREE scope (nullable: existing teams are roots).
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.teams(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.teams'::regclass AND conname = 'teams_parent_not_self') THEN
    ALTER TABLE public.teams
      ADD CONSTRAINT teams_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS teams_parent_id_idx ON public.teams(parent_id);
CREATE INDEX IF NOT EXISTS teams_office_id_idx ON public.teams(office_id);
CREATE INDEX IF NOT EXISTS profiles_team_id_idx ON public.profiles(team_id);
CREATE INDEX IF NOT EXISTS profiles_office_id_idx ON public.profiles(office_id);
CREATE INDEX IF NOT EXISTS profiles_reports_to_idx ON public.profiles(reports_to);
