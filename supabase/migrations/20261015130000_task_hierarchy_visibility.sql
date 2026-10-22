-- =============================================================================
-- 20261015130000_task_hierarchy_visibility.sql
--
-- Tasks follow the reporting line.
--  * A task created by someone is visible to that person's direct reports
--    (E creates -> C, D see it; A creates -> E, B see it). The creator can
--    keep a task private (share_scope = 'PRIVATE').
--  * Whoever received a task can forward it to THEIR OWN direct reports
--    (E forwards -> C, D; B forwards -> F, G, H) or keep it at their level.
--    Nothing cascades automatically.
--  * Shared/forwarded people can read the task; changing it stays with the
--    assignee, the person who assigned it and admins (existing policies).
--  * Only tasks created after this migration are shared automatically;
--    existing tasks can be forwarded by their creator, assignee or audience.
--  * People are notified when a task is shared or forwarded to them.
-- Audience is a snapshot: a later change of manager does not move old tasks.
-- Idempotent. No existing rows are changed.
-- =============================================================================

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS share_scope text NOT NULL DEFAULT 'DIRECT_REPORTS';
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_share_scope_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_share_scope_check CHECK (share_scope IN ('DIRECT_REPORTS', 'PRIVATE'));
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id);

CREATE TABLE IF NOT EXISTS public.task_audience (
  task_id      uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  granted_via  text NOT NULL CHECK (granted_via IN ('CREATOR_DIRECT_REPORTS', 'FORWARDED')),
  forwarded_by uuid REFERENCES public.profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS task_audience_user ON public.task_audience (user_id, task_id);
ALTER TABLE public.task_audience ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_audience FROM anon, authenticated;
GRANT SELECT ON public.task_audience TO authenticated;
DROP POLICY IF EXISTS task_audience_select ON public.task_audience;
CREATE POLICY task_audience_select ON public.task_audience
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR forwarded_by = auth.uid() OR public.is_profile_admin());

-- Read access for the audience and the creator (in addition to the existing
-- assignee / assigned_by / manager / scoped policies). SECURITY DEFINER helper
-- so the policy does not recurse through task_audience's own RLS.
CREATE OR REPLACE FUNCTION public.hrms_task_visible_to_audience(p_task_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.task_audience a WHERE a.task_id = p_task_id AND a.user_id = auth.uid())
$$;
REVOKE ALL ON FUNCTION public.hrms_task_visible_to_audience(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrms_task_visible_to_audience(uuid) TO authenticated;

DROP POLICY IF EXISTS tasks_audience_select ON public.tasks;
CREATE POLICY tasks_audience_select ON public.tasks
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR public.hrms_task_visible_to_audience(id));

-- Creator is recorded on every new task.
CREATE OR REPLACE FUNCTION public.hrms_task_set_creator()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  NEW.created_by := coalesce(NEW.created_by, auth.uid(), NEW.assigned_by);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS hrms_task_set_creator_trg ON public.tasks;
CREATE TRIGGER hrms_task_set_creator_trg BEFORE INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.hrms_task_set_creator();

-- Adds people to a task's audience and tells them. Returns how many were added.
CREATE OR REPLACE FUNCTION public.hrms_task_share(p_task_id uuid, p_users uuid[], p_via text, p_by uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_task  public.tasks%ROWTYPE;
  v_name  text;
  v_added uuid[];
BEGIN
  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR p_users IS NULL OR cardinality(p_users) = 0 THEN RETURN 0; END IF;
  WITH ins AS (
    INSERT INTO public.task_audience (task_id, user_id, granted_via, forwarded_by)
    SELECT p_task_id, u, p_via, CASE WHEN p_via = 'FORWARDED' THEN p_by END
    FROM unnest(p_users) u
    WHERE u IS NOT NULL AND u <> coalesce(v_task.assigned_to, '00000000-0000-0000-0000-000000000000'::uuid)
    ON CONFLICT (task_id, user_id) DO NOTHING
    RETURNING user_id
  )
  SELECT array_agg(user_id) INTO v_added FROM ins;
  IF v_added IS NULL THEN RETURN 0; END IF;

  SELECT name INTO v_name FROM public.profiles WHERE id = p_by;
  BEGIN
    PERFORM public.enqueue_hrms_notification(
      u,
      CASE WHEN p_via = 'FORWARDED' THEN 'Task forwarded to you' ELSE 'New team task' END,
      format('%s %s: %s', coalesce(v_name, 'Your manager'),
             CASE WHEN p_via = 'FORWARDED' THEN 'forwarded a task' ELSE 'shared a task' END,
             coalesce(v_task.title, 'Task')),
      CASE WHEN p_via = 'FORWARDED' THEN 'task_forwarded' ELSE 'task_shared' END,
      'task-shared:' || p_task_id || ':' || u,
      '/HRMS/tasks')
    FROM unnest(v_added) u;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'task share notification skipped: %', SQLERRM;
  END;
  RETURN cardinality(v_added);
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_task_share(uuid, uuid[], text, uuid) FROM public, anon, authenticated;

-- New task: visible to the creator's direct reports unless kept private.
CREATE OR REPLACE FUNCTION public.hrms_task_share_with_direct_reports()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.created_by IS NOT NULL AND NEW.share_scope = 'DIRECT_REPORTS' AND NEW.event_id IS NULL THEN
    PERFORM public.hrms_task_share(
      NEW.id,
      ARRAY(SELECT p.id FROM public.profiles p
            WHERE p.reports_to = NEW.created_by AND coalesce(p.is_active, true) AND p.id <> NEW.created_by),
      'CREATOR_DIRECT_REPORTS', NEW.created_by);
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN
  -- Never block task creation because of sharing.
  RAISE WARNING 'task sharing skipped: %', SQLERRM;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS hrms_task_share_trg ON public.tasks;
CREATE TRIGGER hrms_task_share_trg AFTER INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.hrms_task_share_with_direct_reports();

-- A team lead forwards a task they received to their own direct reports
-- (all of them, or the ones picked).
CREATE OR REPLACE FUNCTION public.rpc_task_forward(p_task_id uuid, p_user_ids uuid[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_task    public.tasks%ROWTYPE;
  v_reports uuid[];
  v_targets uuid[];
  v_added   integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED', 'message', 'Sign in again.');
  END IF;
  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND', 'message', 'Task not found.');
  END IF;
  IF NOT (v_task.created_by = v_uid OR v_task.assigned_to = v_uid OR v_task.assigned_by = v_uid
          OR EXISTS (SELECT 1 FROM public.task_audience a WHERE a.task_id = p_task_id AND a.user_id = v_uid)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'You can only forward tasks you received.');
  END IF;
  SELECT array_agg(p.id) INTO v_reports FROM public.profiles p
  WHERE p.reports_to = v_uid AND coalesce(p.is_active, true) AND p.id <> v_uid;
  IF v_reports IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NO_DIRECT_REPORTS', 'message', 'Nobody reports to you, so there is no team to forward to.');
  END IF;
  IF p_user_ids IS NULL OR cardinality(p_user_ids) = 0 THEN
    v_targets := v_reports;
  ELSE
    SELECT array_agg(u) INTO v_targets FROM unnest(p_user_ids) u WHERE u = ANY (v_reports);
    IF v_targets IS NULL OR cardinality(v_targets) <> cardinality(ARRAY(SELECT DISTINCT unnest(p_user_ids))) THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_YOUR_TEAM', 'message', 'You can forward only to people who report to you.');
    END IF;
  END IF;
  v_added := public.hrms_task_share(p_task_id, v_targets, 'FORWARDED', v_uid);
  RETURN jsonb_build_object('success', true, 'added', v_added,
    'message', CASE WHEN v_added = 0 THEN 'Your team can already see this task.'
                    ELSE format('Forwarded to %s team member%s.', v_added, CASE WHEN v_added = 1 THEN '' ELSE 's' END) END);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_task_forward(uuid, uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_task_forward(uuid, uuid[]) TO authenticated;

-- The signed-in user's task list: assigned to me, created/assigned by me, or
-- shared/forwarded to me. Not every task of every subordinate.
CREATE OR REPLACE FUNCTION public.rpc_my_tasks(p_statuses text[] DEFAULT NULL, p_limit integer DEFAULT 200, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_has_team boolean;
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  v_has_team := EXISTS (SELECT 1 FROM public.profiles p WHERE p.reports_to = v_uid AND coalesce(p.is_active, true) AND p.id <> v_uid);
  SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) INTO v_rows FROM (
    SELECT t.*,
           ap.name AS assigned_to_name, bp.name AS assigned_by_name, cp.name AS created_by_name,
           CASE WHEN t.assigned_to = v_uid THEN 'ASSIGNED'
                WHEN t.created_by = v_uid OR t.assigned_by = v_uid THEN 'CREATED'
                ELSE 'SHARED' END AS relation,
           aud.granted_via AS shared_via,
           fp.name AS shared_by_name,
           (t.assigned_to = v_uid OR t.assigned_by = v_uid OR public.is_profile_admin()) AS can_update,
           v_has_team AS can_forward,
           (SELECT count(*) FROM public.task_audience a2 WHERE a2.task_id = t.id AND a2.forwarded_by = v_uid) AS forwarded_count
    FROM public.tasks t
    LEFT JOIN public.task_audience aud ON aud.task_id = t.id AND aud.user_id = v_uid
    LEFT JOIN public.profiles ap ON ap.id = t.assigned_to
    LEFT JOIN public.profiles bp ON bp.id = t.assigned_by
    LEFT JOIN public.profiles cp ON cp.id = t.created_by
    LEFT JOIN public.profiles fp ON fp.id = coalesce(aud.forwarded_by, CASE WHEN aud.user_id IS NOT NULL THEN t.created_by END)
    WHERE (t.assigned_to = v_uid OR t.assigned_by = v_uid OR t.created_by = v_uid OR aud.user_id IS NOT NULL)
      AND (p_statuses IS NULL OR t.status = ANY (p_statuses))
    ORDER BY t.created_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 200), 500)) OFFSET greatest(0, coalesce(p_offset, 0))
  ) x;
  RETURN v_rows;
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_my_tasks(text[], integer, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_my_tasks(text[], integer, integer) TO authenticated;

-- Direct reports, for picking who to forward to.
CREATE OR REPLACE FUNCTION public.rpc_my_direct_reports()
RETURNS TABLE (id uuid, name text, employee_number text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.name::text, p.employee_number::text FROM public.profiles p
  WHERE p.reports_to = auth.uid() AND coalesce(p.is_active, true) AND p.id <> auth.uid()
  ORDER BY p.name
$$;
REVOKE ALL ON FUNCTION public.rpc_my_direct_reports() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_my_direct_reports() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ─── CHECK (read-only, run after) ────────────────────────────────────────────
-- SELECT count(*) FROM task_audience;                         -- 0 right after deploy
-- SELECT share_scope, count(*) FROM tasks GROUP BY 1;
