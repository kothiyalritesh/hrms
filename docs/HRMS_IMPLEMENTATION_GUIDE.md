# HRMS: what was implemented, and what you need to do

## Status update (2026-10-06, after your first run)

**Done:**
- Migrations 1, 3, 4, 5 and 6 applied. `escalation_is_live = false`, and the canonical wrapper and core both exist.
- All active offices use 10:32.

**Still to do, in order:**

1. **Run the new migration** `supabase/migrations/20261006150000_attendance_correction_and_sane_times.sql` in the SQL Editor, as a single run. It fixes the Correct Attendance flow and impossible times such as Kiranpal Singh's "checkout 10:16 before check-in 10:22".
2. **Re-test with the corrected queries** in §5b below. The earlier Ritesh test failed only because Ritesh is SYSTEM_ADMIN, so the "non-admin Ritesh" lookup returned nobody. The ChatGPT query used a column `attendance_date` that doesn't exist; the column is `work_date`.
3. **Biometric lock (§6).** Not done yet; anon can still call the sync. Do it now.
4. **Deploy the web app (§7).** The 27–30 Sept fix, the IST correction form and the Late column all live in the app code. **Nothing changes on screen until you deploy.**
5. **Re-grant Farheen Banu and Test-Ravina (§3/§9).** They lost the accidental admin access. Farheen still has GLOBAL `attendance.view`, `employee.create` and `employee.view` (she can see and create employees across all offices). Confirm an Agent should really have that.
6. **Security incident steps (§10).**

### Checkout rule (added 2026-10-06, migration `20261006170000`)

A day's checkout, in order:
1. approved regularization
2. admin correction
3. the employee pressing **Check-out in the app**
4. the **last biometric punch at or after 18:30 IST**
5. otherwise an **automatic checkout at 20:00 IST**

Biometric taps before 18:30 never count as a checkout. A field-visit checkout ends the visit, not the day.

- Screens and reports apply this rule immediately to every date.
- The nightly job writes the checkout into `attendance_logs`. It runs at 20:00 IST, and again at 23:58 IST to pick up later punches.
- The job only touches today and yesterday.

**Repairing older days in the database** (optional, explicit). First preview the days that the old 20:30 job closed at a midday punch:

```sql
select date, count(*) as wrong_auto_closes
from public.attendance_logs
where upper(coalesce(checkout_source, '')) = 'SYSTEM'
  and (checkout_time at time zone 'Asia/Kolkata')::time < '18:30'
group by date order by date;
```

Then repair a range of days. Every change gets an audit row (`CHECKOUT_AUTO`):

```sql
select d::date as day, public.hrms_apply_day_end_checkouts(d::date) as result
from generate_series('2026-09-01'::date, (now() at time zone 'Asia/Kolkata')::date - 1, '1 day') d;
```

### Live tracking (added 2026-10-06, migration `20261006180000` + web deploy)

**Live location sources:**
- **Android app:** native background tracking, unchanged.
- **Browser** (desktop, iPhone or Android Chrome): new `components/WebForegroundTracker.tsx`. It sends a ping every 60 s while HRMS is open on screen and the person has an open check-in.
  - Browsers pause when the phone is locked or the tab is hidden.
  - There is no iOS app, so iPhone users are tracked only while HRMS is open.
- **Live Tracking screen:** now asks the server for each person's latest ping (`rpc_latest_location_pings`). Before, it loaded the company's newest ~1000 pings, which made people drop to "Last ping: —".

Check your own pings today (replace the id):

```sql
select to_char(recorded_at at time zone 'Asia/Kolkata', 'HH24:MI:SS') as ist, provider, accuracy, quality_status
from public.location_tracking
where user_id = 'fc89e605-6673-432c-8590-56ff35a8a88c'
  and recorded_at >= ((now() at time zone 'Asia/Kolkata')::date::text || ' 00:00')::timestamp at time zone 'Asia/Kolkata'
order by recorded_at desc limit 10;
```

### 5b. Corrected test queries (read-only)

```sql
-- A normal employee sees only themselves (expect people = 1)
begin;
select set_config('request.jwt.claim.sub',
  (select p.id::text from public.profiles p
    where p.is_active
      and public.normalize_profile_role(p.role) not in ('SYSTEM_ADMIN','ADMIN','HR','HRD')
      and not exists (select 1 from public.user_permissions up where up.user_id = p.id and up.revoked_at is null)
    limit 1), true);
set local role authenticated;
select count(*) as rows, count(distinct user_id) as people
from public.rpc_attendance_canonical_range('2026-09-01', '2026-09-30');
rollback;

-- Ritesh (SYSTEM_ADMIN) sees everyone, every day from 1 Sept
begin;
select set_config('request.jwt.claim.sub', 'fc89e605-6673-432c-8590-56ff35a8a88c', true);
set local role authenticated;
select min(work_date), max(work_date), count(*) as rows, count(distinct user_id) as people
from public.rpc_attendance_canonical_range('2026-09-01', '2026-09-30');
rollback;

-- Rows per day underneath the app (the old app received only the newest ~1000)
select work_date, count(*) as rows
from public.rpc_attendance_canonical_range_core('2026-09-01', '2026-09-30', null, null, null)
group by work_date order by work_date;

-- After running 20261006150000: Kiranpal's day (expect first-in 10:16 BIOMETRIC, no checkout)
begin;
select set_config('request.jwt.claim.sub', 'fc89e605-6673-432c-8590-56ff35a8a88c', true);
set local role authenticated;
select employee_name,
       to_char(official_first_in at time zone 'Asia/Kolkata', 'HH24:MI') as first_in_ist,
       first_in_source,
       to_char(official_last_out at time zone 'Asia/Kolkata', 'HH24:MI') as last_out_ist,
       attendance_status
from public.rpc_attendance_canonical_range('2026-10-06', '2026-10-06')
where employee_name ilike 'Kiranpal%';
rollback;
```

Date: 2026-10-06. Nothing has been applied to your database or deployed yet, and nothing is committed. Every step below is yours to run, in this order.

---

## 0. Summary

### Implemented in the code (verified locally)

| Area | What changed | Files |
|---|---|---|
| **Security (Phase 0)** | "Any permission = admin" escalation removed. RLS enabled on the permission tables. Anon can no longer call admin/diagnostic RPCs. Device-log inserts restricted to service role. Biometric sync RPC restricted to service role. | `supabase/migrations/20261006100000_security_lockdown.sql`, `20261006101000_lock_biometric_sync_rpc.sql` |
| **Scope permission engine** | One model: `user_permissions` (permission + scope + scope_id), resolved against the live office/team/manager tables. Scopes: GLOBAL, OFFICE, OFFICE_TREE, TEAM, TEAM_TREE, REPORTS_TO, DEPARTMENT, ASSIGNED, SELF. Functions: `authorized_user_ids`, `can_access_user_data`, `explain_access` (simulator), `get_user_permission_grants` (effective access). One grant RPC and one revoke RPC. Every change is audited by a trigger. | `20261006110000_permission_scope_values.sql`, `20261006120000_scope_permission_engine.sql` |
| **Attendance history (the "only 27–30 Sept" bug)** | The app now fetches in 3-day windows and pages within each, so it no longer stops at 1000 rows. The attendance RPC now enforces authorization on the server, and asking for another office returns nothing. | `services/canonical-attendance.service.ts`, `20261006130000_canonical_range_authorization.sql` |
| **Regularization** | Nobody can approve their own request. The reviewer must cover the employee's scope. Same-day approvals no longer fail at commit. | `20261006140000_regularization_and_late_policy.sql` |
| **Late rule** | 10:32 is the single default (DB default, server fallback, app constant `constants/attendancePolicy.ts`). | same + `constants/attendancePolicy.ts`, attendanceIntelligence services |
| **IST dates** | Fixed a real bug: `getBusinessDateIST()` ignored its date argument, so "yesterday", 30-day windows and date ranges in reports all collapsed to *today*. Report screens now use IST month and week boundaries. | `utils/businessDate.ts` + 10 report/admin screens |
| **Permission Manager UI** | Office, team, lead and department pickers. Readable labels for grants. Reason field (written to the audit log). "Test access" simulator (ALLOW/DENY plus why). Server error messages are shown. React hooks bug fixed. | `screens/admin/PermissionsManagerScreen.tsx`, `navigation/AdminStackNavigator.tsx` |
| **Google Maps on mobile** | The In-Transit map and the My Team map no longer load from a null origin, which caused "RefererNotAllowedMapError" and grey maps. The Map ID now comes from the environment. The native journey card shows a static-map and "Open in Google Maps" fallback. | `InTransitScreen.tsx`, `MyTeamScreen.tsx`, `ActiveJourneyCard.tsx`, `.env.example` |
| **Secrets out of code** | The biometric daemon and the SmartOffice proxy now read keys from environment variables. `.gitignore` now blocks DB dumps. | `scripts/biometric_auto_sync_daemon.js`, `proxy-server.js`, `.gitignore` |
| **Clean-up** | The abandoned drafts were broken (duplicate version numbers, an ambiguous 6-argument RPC that would have broken every report, admin fix applied to the wrong function, forgeable audit rows). They were moved to `supabase/_superseded/`. The truncated `20261005050000` migration was turned into a no-op. Debug `test_*.sql` files were removed from the migrations folder. | `supabase/_superseded/` |

**Verification done here:**
- All six new migrations were applied to a throwaway PostgreSQL 17 database that copies your legacy schema, including the escalation bug and the draft leftovers.
- They were applied twice, to prove they can be re-run.
- 43 permission and security scenarios passed. To re-run them: `bash supabase/tests/run_permission_tests.sh`.
- The TypeScript typecheck is clean.
- Jest: 275 tests pass. The 30 failing tests are old "source text" assertions that also fail on the last commit, in files not touched today.

### Decisions I made (change them if you disagree)
1. **HR/HRD stay data admins** (global employee and attendance access, as today). Removing this would lock HR out of every screen that reads tables directly.
2. **HR cannot manage permissions.** Only SYSTEM_ADMIN/ADMIN can, or a user given an explicit `permissions.assign` grant. This matches your spec's HR example.
3. **Everyone can always see their own records.**
4. **TEAM means a team record** (`teams.id`). The old meaning ("everyone under this lead") is now **REPORTS_TO**. Existing grants of the old kind are converted automatically.
5. **Late = first check-in at or after 10:32:00 IST.** Existing per-office policy rows were **not** modified; step 2 shows you how to check them.

### Not implemented in this round
Your three documents describe a multi-month roadmap. These were **not** built today and are listed in §12:
- event-sourced attendance with evidence/confidence
- fraud scoring and Play Integrity
- the generic approval and notification engines
- WFH, shift and weekly-off engines
- field-visit inspections and route replay
- session/security logs
- temporary permissions and break-glass access

Saying they were done would be false.

---

## 1. Before you touch the database (10 minutes)

1. **Take a backup.** Supabase Dashboard → **Database → Backups**. Confirm there is a recent backup, or take a PITR restore point if your plan has it. Note the time.
2. Choose a quiet time (after office hours). People with *scoped* permissions may briefly see less until you finish step 9.
3. Open **Supabase Dashboard → SQL Editor**. Every step below says what to paste and what you should see.

---

## 2. Check the current state (read-only, safe)

Paste this block and run it. It changes nothing.

```sql
-- 2a. Is the "any permission = admin" escalation live?
select pg_get_functiondef('public.is_profile_admin()'::regprocedure) ilike '%user_permissions%'
       as escalation_is_live;

-- 2b. Leftovers from the abandoned drafts (any rows here are cleaned up by step 4)
select proname, pg_get_function_identity_arguments(oid) as args
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('rpc_attendance_canonical_range','rpc_attendance_canonical_range_core',
                  'is_profile_admin','admin_grant_permission','admin_revoke_permission',
                  'authorized_user_ids','explain_access')
order by 1, 2;

-- 2c. Shape of user_permissions (expect: scope text + a CHECK without OFFICE)
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'user_permissions' order by ordinal_position;
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.user_permissions'::regclass;

-- 2d. Late threshold per office (should all be 10:32:00)
select o.name as office, ap.role, ap.late_checkin_time, ap.is_active
from public.attendance_policies ap left join public.offices o on o.id = ap.office_id
order by 1, 2;
```

**How to read it:**
- `escalation_is_live = true` means the fix in step 4 is urgent.
- 2b showing `rpc_attendance_canonical_range` with **6** arguments, or `is_profile_admin` with a `p_user_id` argument, means a draft was pasted earlier. Step 4 removes both.
- 2d showing **10:30** on any active row: if that office should also use 10:32, run this (it changes data, so only if you agree):

```sql
update public.attendance_policies set late_checkin_time = '10:32' where late_checkin_time <> '10:32' and is_active;
```

---

## 3. See who will lose admin powers (read-only)

Today, anyone with any row in `user_permissions` is silently treated as an admin. After step 4 they keep **only what their grants cover**. List them first:

```sql
select p.name, p.role, up.permission, up.scope, up.scope_id
from public.user_permissions up
join public.profiles p on p.id = up.user_id
where up.revoked_at is null
  and public.normalize_profile_role(p.role) not in ('SYSTEM_ADMIN','ADMIN','HR','HRD')
order by p.name, up.permission;
```

Save the output. For each person, decide what they should actually see (for example "attendance.view for Office 136"). You will grant it in step 9. If someone should really be a full admin, change their **role** in User Management instead.

---

## 4. Apply the migrations (SQL Editor, one file per run, in this order)

Open each file in the repo, copy the **entire** contents, paste into a **new** SQL Editor tab, and run it. Wait for "Success" before the next one. **Run them one at a time.** File 3 adds enum values, and Postgres does not allow those to be used in the same run that adds them.

| # | File (`supabase/migrations/…`) | Expected result |
|---|---|---|
| 1 | `20261006100000_security_lockdown.sql` | Success, no rows |
| 2 | *(skip for now: `20261006101000_lock_biometric_sync_rpc.sql` is applied in step 6)* | – |
| 3 | `20261006110000_permission_scope_values.sql` | Success |
| 4 | `20261006120000_scope_permission_engine.sql` | Success. It may show NOTICEs such as "Converted N legacy TEAM(lead-id) grants to REPORTS_TO" or "Revoked N grants with an invalid scope target". Note the numbers. |
| 5 | `20261006130000_canonical_range_authorization.sql` | Success |
| 6 | `20261006140000_regularization_and_late_policy.sql` | Success |

**If a file fails:** nothing from that file is applied, because each run is one transaction. Copy the error message, stop, and fix it before continuing. All six files are safe to run again.

**If you use the Supabase CLI** instead of the SQL Editor: your migration history has duplicate and short version numbers (audit DB-01), so `supabase db push` will likely fail on old files. Use the SQL Editor as above. Afterwards, record the new versions as applied:

```bash
supabase migration repair --status applied 20261006100000 20261006110000 20261006120000 20261006130000 20261006140000
```

---

## 5. Verify (read-only)

```sql
-- exactly one of each (expect 1, 1, 1, 1)
select proname, count(*) from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('rpc_attendance_canonical_range','admin_grant_permission','admin_revoke_permission','is_profile_admin')
group by 1;

-- RLS on (expect all true)
select relname, relrowsecurity from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('user_permissions','permissions','role_permissions','user_permission_overrides','permission_audit_logs');

-- anon locked out (expect false, false)
select has_function_privilege('anon', 'public.rpc_attendance_canonical_range(date,date,uuid,uuid,uuid)', 'execute') as anon_canonical,
       has_table_privilege('anon', 'public.user_permission_overrides', 'select') as anon_overrides;

-- escalation gone (expect false)
select pg_get_functiondef('public.is_profile_admin()'::regprocedure) ilike '%user_permissions%' as escalation_is_live;
```

**Simulate a normal employee** (replace the name). This runs inside a transaction and is rolled back, so it changes nothing:

```sql
begin;
select set_config('request.jwt.claim.sub',
  (select id::text from public.profiles where name ilike 'Ritesh%' and role not ilike '%admin%' limit 1), true);
set local role authenticated;
select count(*) as rows, count(distinct user_id) as people   -- expect people = 1 (only themselves)
from public.rpc_attendance_canonical_range('2026-09-01', '2026-09-30');
rollback;
```

**Check the "only 27–30 Sept" cause** (run as-is in the SQL Editor, which runs as the database owner):

```sql
select count(*) as rows_for_september
from public.rpc_attendance_canonical_range_core('2026-09-01', '2026-09-30', null, null, null);
```

If this is well above 1000, the old app could only ever receive the newest ~1000 rows. The new app fetches in windows, so this no longer matters. Also open **Dashboard → Project Settings → API → Max rows** and make sure it is **at least 500** (1000 is the default; keep it).

---

## 6. Biometric daemon, then lock the biometric RPC

Only needed if you run `scripts/biometric_auto_sync_daemon.js` on some machine. The app's **Sync Now** button uses an Edge Function and is not affected.

1. On that machine, set the environment variables. Get the values from Supabase **Settings → API** (service_role key) and from your SmartOffice admin. **Never commit them.**

   ```powershell
   setx SUPABASE_SERVICE_ROLE_KEY "<service role key>"
   setx SMARTOFFICE_API_KEY "<new SmartOffice API key>"
   ```

2. Restart the daemon and confirm punches still arrive (Attendance Control → Biometric).
3. Then run `supabase/migrations/20261006101000_lock_biometric_sync_rpc.sql` in the SQL Editor.
4. Verify that anon is locked out (expect false):

   ```sql
   select has_function_privilege('anon', 'public.rpc_sync_biometric_punches(jsonb)', 'execute');
   ```

If you also run `proxy-server.js`, it now needs `SMARTOFFICE_API_KEY` set the same way. It stops with a clear message if the key is missing.

---

## 7. Deploy the web app (this also updates the Android app)

The Android app loads `https://bop.in/HRMS/` inside its WebView, so a web deploy updates both.

1. Bump `buildId` in `release.config.json` (for example `"20261006.1"`) so the service-worker cache refreshes.
2. Build:

   ```powershell
   powershell -ExecutionPolicy Bypass -File ./deploy_bop_web.ps1 -WebBasePath HRMS
   ```

3. Upload `bop-hrms-deploy.zip` to Hostinger and extract it in `public_html`, so that `/HRMS/index.html` and `/HRMS/_expo/` sit side by side.
4. Hard-refresh in a browser (Ctrl+F5). Then open these URLs directly; each must load the app, not a 404: `/HRMS/`, `/HRMS/dashboard`, `/HRMS/attendance`.

**Order matters:** deploy the web app **after** step 4. The new paging works with the old server too, but the Permission Manager needs the new RPCs.

---

## 8. Google Maps (Google Cloud Console + EAS)

The code fixes only take effect once the keys are set up correctly.

1. **Browser key** (`EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`). Cloud Console → APIs & Services → Credentials → the key:
   - Application restriction: **HTTP referrers** → `https://bop.in/*`
   - API restriction: Maps JavaScript API, Maps Embed API, Maps Static API, Geocoding API, Directions API (or Routes API)
2. **Android key** (new, `GOOGLE_MAPS_ANDROID_KEY`):
   - Application restriction: **Android apps** → package `com.rehrms.app`, plus every SHA-1:
     - from `eas credentials` → Android → production keystore
     - from Play Console → Test and release → App integrity → App signing (both the app-signing and upload SHA-1)
   - API restriction: Maps SDK for Android
   - A browser key with a referrer restriction does **not** work for native Android maps.
3. **Enable these APIs** on the project, with billing on: Maps JavaScript, Maps SDK for Android, Embed, Static, Geocoding, Directions/Routes.
4. **Map ID**: Cloud Console → Map Management → Create → JavaScript, Vector. Put the ID in `EXPO_PUBLIC_GOOGLE_MAPS_MAP_ID`. Without it, markers use Google's development-only `DEMO_MAP_ID`.
5. **EAS** (expo.dev → project → Environment variables → production):
   - `GOOGLE_MAPS_ANDROID_KEY` (secret)
   - `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` and `EXPO_PUBLIC_GOOGLE_MAPS_MAP_ID` (plain text)
   - Add the same two `EXPO_PUBLIC_…` values to your local `.env` before step 7's web build.
6. Rebuild the Android app with `eas build -p android --profile production`. This is only needed for the native fallback map; the WebView maps are fixed by step 7.
7. **If a map is still grey:** open it in Chrome, press F12 → Console. The error name tells you which setting is wrong:
   - `RefererNotAllowedMapError` → step 1
   - `ApiNotActivatedMapError` → step 3
   - `BillingNotEnabledMapError` → billing

---

## 9. Set up permissions in the new Permission Manager

Log in as SYSTEM_ADMIN/ADMIN → HR Panel → Permissions Manager.

1. Pick a person from the list you saved in step 3.
2. On a permission (for example `attendance.view`), tap **Add**, then choose the scope:
   - "One office" → choose the office (for example Noida 136)
   - "One team" / "Team + sub-teams" → choose the team
   - "A lead's reporting line" → choose the lead (leave blank for "the person's own reports")
3. Enter a reason (it goes to the audit log), then **Apply Grant**.
4. Use **Test access** on the same screen: choose the permission and an employee. You'll see **ALLOW** or **DENY** and the reason. Check one employee inside the scope and one outside.

**Team + sub-teams:** the new `teams.parent_id` column is empty, so every team is a top-level team for now. Set parents in SQL until there's a UI for it:

```sql
update public.teams set parent_id = (select id from public.teams where name = 'Sales North')
where name in ('Team A', 'Team B');
```

**Acceptance check: the screenshot problem.** Log in as an admin → Attendance Control → **Last Month** (2026-09-01 → 2026-09-30) → search "Ritesh":
- Every working day from **1 Sept** appears, not just 27–30.
- The 10-sheet Excel download contains the same days.
- The Attendance Register for September shows no fake ABSENT days.

---

## 10. Security incident steps (do these this week)

The production database dump that was in git history (`dump-postgres-202609011610.sql`, commit `af62796`) contains password hashes, 2,718 refresh tokens, OTP hashes and staff PII. It was removed from the latest commit, but **it is still in the history** of `github.com/kothiyalritesh/hrms`.

1. **Sign everyone out.** This revokes the leaked sessions. Everyone will need to log in again with OTP, and background tracking on phones pauses until they do.
   - Simplest: Dashboard → Authentication → "Sign out all users", if your dashboard has it.
   - Or in the SQL Editor:

     ```sql
     delete from auth.refresh_tokens;
     delete from auth.sessions;
     ```

2. **Rotate keys that were in git:** Mailchimp API key, Mappls client secret, SmartOffice API key (`240916062617`, also change it on the SmartOffice side). Put the new values only in environment variables or Supabase Vault.
3. **Purge the history.** This rewrites every commit, so everyone must re-clone afterwards. Coordinate with anyone who has a copy.

   ```bash
   pip install git-filter-repo
   ```

   ```bash
   git clone --mirror https://github.com/kothiyalritesh/hrms.git hrms-mirror
   ```

   ```bash
   cd hrms-mirror
   ```

   ```bash
   git filter-repo --invert-paths --path dump-postgres-202609011610.sql --path .env
   ```

   ```bash
   git push --force --mirror
   ```

   Then ask GitHub Support to purge cached views of the old commits, and check for forks.
4. Decide whether the exposure needs to be reported under your obligations (DPDP Act 2023). The dump contained employee personal data.

---

## 11. Commit the work (when you're happy)

Nothing has been committed. Review with `git status` and `git diff`, then:

```bash
git add supabase/migrations/2026100610*.sql supabase/migrations/2026100611*.sql supabase/migrations/2026100612*.sql supabase/migrations/2026100613*.sql supabase/migrations/2026100614*.sql supabase/migrations/20261005050000_phase3_enforce_captured_at.sql supabase/tests supabase/_superseded docs constants services screens components hooks navigation utils contexts scripts/biometric_auto_sync_daemon.js proxy-server.js .gitignore .env.example app.config.js
```

```bash
git commit -m "Security lockdown, scope-based permission engine, attendance paging fix, IST/late-rule fixes, maps fixes"
```

Also commit the matching files under `.bop-backend-package/supabase/migrations/` if you deploy from that folder.

**Rollback:** each migration file ends with a ROLLBACK section. If the attendance screens break right after step 4, file 5 can be undone by running the three statements at its bottom. Do **not** restore the "any permission = admin" behaviour.

---

## 12. What's next (from your roadmap, not done today)

In recommended order. Each item builds on the permission engine delivered today.

1. **Scope every remaining list RPC and screen with `authorized_user_ids()`.** Done today: attendance and regularization. Still to do:
   - dashboard counts and the TV board (REP-02/03)
   - live tracking and in-transit (REP-04): also filter realtime channels and debounce reloads
   - leaves and tasks: the direct table reads still rely on the role-based `is_profile_admin()` RLS
2. **Require `captured_at` on check-in, plus native location in the Android shell** (ATT-05/ATT-06):
   - first make every client send `capturedAt`
   - then add a bridge command `location.getCurrent` that returns the mocked flag
   - then enforce it on the server
   - consider Play Integrity after that
3. **Attendance evidence model:**
   - `attendance_events` → `attendance_evidence` → one canonical daily fact with a confidence level (HIGH / MEDIUM / LOW / UNVERIFIED)
   - an explicit check-in state machine
   - idempotency keys for the offline queue
4. **Generic approval engine:**
   - shared by regularization, leave, WFH and field visits
   - multi-level, SLA, escalation, delegation, driven by a policy table instead of role checks
5. **Notification orchestration:**
   - event → rule → audience → channel → delivery status, with retries
   - push, email and WhatsApp
6. **Policy engines:**
   - shifts and grace periods
   - weekly-off policies and holiday calendars (effective-dated)
   - WFH requests and calendar
   - temporary office assignment, separate from the home office
7. **Field operations:**
   - visit evidence chain and dwell/travel checks
   - fraud score that triggers review, never automatic punishment
   - inspections with checklists and photos
   - route replay
8. **Security and audit:**
   - `auth_sessions` / `security_events` logs and read/export audit
   - temporary grants with expiry, and break-glass access
   - separation-of-duties rules and permission conflict detection
9. **Platform:**
   - one migration baseline from the live schema (`supabase db dump`)
   - CI running typecheck, tests and `supabase/tests/run_permission_tests.sh`
   - remove the 300+ root scratch scripts, and the stale source-text tests that fail today

Your benchmark documents mention Google Sheets as a database. This HRMS already uses Supabase/Postgres as its source of truth, so that concern does not apply.

---

## QA bug report (06 Oct 2026): HRMS-001 to HRMS-010

### 1. Run this migration in the SQL Editor

`supabase/migrations/20261006190000_qa_phone_uniqueness_and_leave_reset.sql`

- One phone number = one employee. Applies to every path: admin form, bulk import, SQL.
- Fixes Leave Balance "Reset All".
- Existing data is not changed.

### 2. Find employees who already share a phone number

These are the records that produced "two roles". Merge or deactivate them by hand.

```sql
select public.hrms_phone_key(phone) as phone,
       count(*) as profiles,
       string_agg(name || ' (' || coalesce(role, '-') || ', '
                  || case when is_active then 'active' else 'inactive' end || ')', '; ') as who
from public.profiles
where public.hrms_phone_key(phone) is not null
group by 1
having count(*) > 1;
```

Fix each group:
- Keep one profile and give it the right role.
- Change the extra profile's phone, or deactivate it in User Management.

### 3. Check the notification time type (HRMS-006)

```sql
select data_type from information_schema.columns
where table_schema = 'public' and table_name = 'notifications' and column_name = 'created_at';
```

- `timestamp without time zone`: the app now reads it correctly (UTC). Nothing else to do.
- `timestamp with time zone`: also fine.

### 4. Upload `bop-hrms-deploy.zip` (release 20261006.163119)

### What was wrong

| Bug | Root cause | Fix |
|---|---|---|
| Many "button does nothing" reports (001, 008, 009, 010) | On web and in the Android app (which shows the web build), react-native-web's `Alert.alert` is an empty function. 304 messages and confirmations in 64 screens never appeared. | New `components/WebAlertHost.tsx`: a real in-app dialog for every `Alert.alert` on web. |
| 001 Apply Leave | The Quick Action only opened leave history. Validation and balance errors were invisible. | Opens the apply form directly. Date picker on web. Clear errors and success messages. |
| 002 Completed tasks | The query only loaded pending and in-progress tasks. | Loads the latest 200 completed and cancelled tasks too. Status changes move the card instantly and report failures. |
| 003 Site Visit | The "Site Visits" card opened the Tasks tab. | Opens Field Visits with the "Add site visit" form. |
| 004 Refresh | A manual refresh during a running load returned that older (cached) load. | Forced refresh waits, then reloads fresh data. Refresh button is single-flight. |
| 005 Profile photo | Every upload reused `avatars/<id>.jpg`, so the stored path never changed and the old image stayed. | Unique file name per upload. The old file is deleted after a successful save. |
| 006 Notification time | Timestamps without a time zone were read as device time, so notifications showed 5h30m too old. | Read as UTC. Shows "Just now", or "12m ago · 3:42 pm" in IST. |
| 007 Duplicate phone | Login treats `9876543210`, `919876543210` and `+919876543210` as one person. Saving compared the exact digits. | Last-10-digit identity. Database trigger blocks duplicates. Numbers stored as 10 digits. Clear message to the admin. |
| 008 Holidays | Errors and confirmations were invisible. Dates had to be typed by hand. | Date picker, "Saving..." state, success message, real error text. |
| 009 Add Week Off | The default choice (All employees + Sunday + Every week) already exists, and the "already exists" message was invisible. | Message now visible and explains what to change. Date pickers. |
| 010 Leave Balance | Cards could only be selected by long-press. "Reset All" failed in SQL (wrong column/table). Errors hidden. | Tap to select. +/- on each card. Half days. Error and retry panel. SQL fixed. |

Also fixed: the "two children with the same key" console warnings (duplicate event announcements are now de-duplicated).

Test: `supabase/tests/qa_phone_leave_scenarios.sql` (10/10 pass on local Postgres 17).

---

## Permission Manager v2 (07 Oct 2026)

### Run in the SQL Editor, in this order (each file separately)

1. `supabase/migrations/20261007100000_permission_engine_v2.sql`: catalog, temporary access, role templates, shared checks.
2. `supabase/migrations/20261007110000_scoped_admin_surface.sql`: HR-panel dashboard scoped per permission. Fixes the 403 on `rpc_admin_dashboard_summary`.
3. `supabase/migrations/20261007120000_permission_delegation.sql`: HR-panel functions and table rules that accept scoped permissions. Also fixes Sites & Geofences saving and closes two data leaks.

Then upload `bop-hrms-deploy.zip`.

### Check (read-only)

```sql
select
  to_regprocedure('public.hrms_has_permission(text)') is not null           as engine_v2,
  to_regclass('public.role_permission_grants') is not null                   as role_templates,
  to_regprocedure('public.rpc_admin_leave_balance_summary__core()') is not null as delegation,
  (select count(*) from public.permissions where is_active)                  as catalog_keys;
```

Expected: true, true, true, and 31 or more (older keys that are not aliases may still be listed).

### How access works now

- **Admins:** SYSTEM_ADMIN / ADMIN / HR / HRD can see and do everything with employee data. Only SYSTEM_ADMIN / ADMIN manage permissions, unless someone has a `permissions.*` grant.
- **Everyone else:** gets nothing by default. A grant gives one capability (for example "Approve leave") for a scope:
  - all employees;
  - an office, or an office plus its teams;
  - a team, or a team plus its sub-teams;
  - a reporting line;
  - a department;
  - own records only.
- **Temporary access:** a grant can expire (2 hours, 1 day, 7 days, 30 days, or a chosen date). It stops working by itself.
- **Role templates:** give a permission to a whole role. "Their own reporting line" means each person in that role covers the people under them in the org chart. When someone changes manager, access moves with them automatically.
- **Enforcement:** every rule is enforced by the database, not just hidden in the app:
  - a scoped user cannot act on employees outside their scope;
  - they cannot approve their own leave;
  - they cannot create, edit or deactivate admin accounts;
  - they cannot deactivate themselves;
  - they cannot add employees to offices they don't cover.

### Things still admin-only on purpose

- Biometric sync and matching.
- Bulk employee import, because it can set roles.
- Leave "Reset All".
- The company-wide TV board.

### Tests

`supabase/tests/run_permission_tests.sh` runs, on a throwaway local database:
- 43 original scenarios;
- 28 engine-v2 scenarios;
- 28 delegation scenarios.

All pass.
