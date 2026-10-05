# Backend release package

The versioned `bop-hrms-backend-20260812-sales-manager.zip` archive is the
private deployment and recovery artifact. It contains:

- the complete repository migration history under `supabase/migrations`;
- all Supabase Edge Functions under `supabase/functions`;
- RLS/grant guardrails and protected RPC definitions;
- `supabase/security_audit.sql` for the post-deployment policy/grant review;
- the production release checklist.

This package contains the complete migration history through
`20260812000000_sales_manager_position.sql`. That migration creates the Sales
Manager role and adds a deferred database constraint that permits only Sales
Executive, Telecaller/Teli Caller, and Agent roles as direct reports. It was
applied successfully to linked Supabase project `jidbrwpzfpbursihtvpg` on
12 August 2026; a subsequent linked dry run reported that the remote database
was up to date.

The runtime compatibility contract remains `20260810000000`, because the Sales
Manager change does not alter any Edge Function interface. Deploy and verify all
nine directories under `supabase/functions` before publishing a complete new
environment. No Edge Function redeployment is required when applying only the
Sales Manager migration to an otherwise current environment.

The public web archive intentionally does not contain database or service-role
deployment material. For another environment, apply the archive to staging,
test every role, and then deploy it using the production release checklist.
