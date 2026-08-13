# HRMS Backend Setup

This application uses Supabase Auth for authentication. Do not store passwords,
password digests, temporary credentials, OTP secrets, or recovery codes in
application-owned tables.

## Required setup

1. Apply the versioned migrations in `supabase/migrations`.
2. Deploy the Edge Functions in `supabase/functions`.
3. Configure function secrets in the Supabase dashboard; never use
   `EXPO_PUBLIC_` variables for secrets.
4. Keep profile administration behind the protected profile RPCs.
5. Keep attendance and biometric mutations behind the protected attendance
   RPCs and Edge Functions.

## Authentication

- Create and remove identities through the protected Supabase admin workflow.
- Treat `profiles` as application metadata, not as an authentication store.
- Enforce active-profile and role checks in protected operations.
- Use Supabase Auth recovery and MFA facilities when those features are
  enabled.

## Verification

Run:

```bash
npm run typecheck
npm run lint
npm test -- --runInBand
npx supabase db push --linked --dry-run
```

Before production release, rotate vendor credentials, deploy the migrations and
functions, set the documented function secrets, and complete physical-device
attendance tests.
