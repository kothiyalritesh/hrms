-- 20260911010000_otp_idempotency_and_security.sql
-- Hardening OTP challenge schema for idempotency, request deduplication, and secure rate limiting.

CREATE TABLE IF NOT EXISTS public.otp_login_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  request_id TEXT,
  otp_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  resend_count INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  requested_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add missing columns if table already existed from earlier schema
ALTER TABLE public.otp_login_challenges 
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS resend_count INTEGER NOT NULL DEFAULT 0;

-- Index for phone active challenge lookup
CREATE INDEX IF NOT EXISTS idx_otp_active_lookup 
  ON public.otp_login_challenges(phone, created_at DESC) 
  WHERE consumed_at IS NULL;

-- Index for client request_id idempotency checks
CREATE INDEX IF NOT EXISTS idx_otp_request_id 
  ON public.otp_login_challenges(request_id) 
  WHERE request_id IS NOT NULL;

-- Ensure RLS is active and table is strictly restricted to service_role (Edge Functions)
ALTER TABLE public.otp_login_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.otp_login_challenges FROM anon, authenticated;

