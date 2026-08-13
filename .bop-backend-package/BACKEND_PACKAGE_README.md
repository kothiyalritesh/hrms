# Backend release package

`bop-hrms-backend.zip` is the private deployment artifact. It contains:

- the complete repository migration history under `supabase/migrations`;
- all Supabase Edge Functions under `supabase/functions`;
- RLS/grant guardrails and protected RPC definitions;
- `supabase/security_audit.sql` for the post-deployment policy/grant review;
- the production release checklist.

The web release requires backend schema contract `20260730260000`. Deploy and
verify all migrations plus `biometric-manual-import`,
`biometric-attendance-sync`, `otp-auth`, `field-visit-evidence-upload`, and
`smartoffice-proxy` before publishing the matching frontend. The compatibility
gate verifies the required version endpoint of every runtime-critical function
and intentionally blocks a mismatched deployment.

The public web archive intentionally does not contain database or service-role
deployment material. A successful local migration dry-run is not production
approval: apply the backend archive to staging, test every role, then deploy it
to the linked production Supabase project using the release checklist.
