CREATE TABLE public.anonymous_feedback (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  message text not null,
  created_at timestamptz not null default now(),
  org_id text
);

CREATE TABLE public.feedback_audit (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid references public.anonymous_feedback(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  inserted_at timestamptz not null default now()
);

-- RLS for anonymous_feedback
ALTER TABLE public.anonymous_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert anonymous feedback" ON public.anonymous_feedback
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "HR and Admins can view anonymous feedback" ON public.anonymous_feedback
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRBP', 'DIRECTOR'))
  );

-- RLS for feedback_audit
ALTER TABLE public.feedback_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Only system admin can view audit" ON public.feedback_audit
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'SYSTEM_ADMIN')
  );
-- Insert is done by trigger, no policy needed for insert

-- Trigger to populate audit
CREATE OR REPLACE FUNCTION public.trg_audit_anonymous_feedback()
RETURNS TRIGGER SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.feedback_audit (feedback_id, user_id)
  VALUES (NEW.id, auth.uid());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_anonymous_feedback_trg
AFTER INSERT ON public.anonymous_feedback
FOR EACH ROW EXECUTE FUNCTION public.trg_audit_anonymous_feedback();

-- Notify real-time
ALTER PUBLICATION supabase_realtime ADD TABLE public.anonymous_feedback;
