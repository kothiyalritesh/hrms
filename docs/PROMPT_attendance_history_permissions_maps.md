# Implementation prompt: Attendance history, Permission Manager, Google Maps on mobile

> Paste everything below this line into the coding agent.
> Repo: `D:\download\RealtyHRM-fixed\RealtyHRM-fixed`. Stack: Expo / React Native Web plus Supabase (Postgres 17, PostgREST). The Android app (`com.rehrms.app`) is mostly a WebView shell that loads `https://bop.in/HRMS/`.
> Reference: `docs/HRMS_Deep_Audit_Report_2026-10-05.xlsx` (finding IDs such as REP-01 and AUTH-03 refer to it).

---

## ROLE

You are a senior full-stack engineer on this HRMS. You know Supabase/PostgREST, Postgres security (RLS, SECURITY DEFINER), Expo / react-native-webview, and the Google Maps Platform.

You are fixing exactly three problems:

| # | Problem | Priority |
|---|---|---|
| A | Attendance Control shows only the last ~4 days of a range. Example: Sept 1–30 searched for "Ritesh" shows only 27–30 Sept. | Do first |
| B | The Permission Manager does not work end-to-end: scoped grants fail, are mis-resolved, or are not enforced. | Second |
| C | Google Maps does not work reliably in the mobile app. | Third |

Do not work on anything else. If you find another bug, add it to the "Out-of-scope findings" list in your final report and leave it alone.

---

## LEVEL 0: GROUND RULES (apply to every level)

1. **Verify before changing.** At each level, the "Verify" steps come first. Report what you actually observed: query output, line numbers, console errors. If an observation contradicts this prompt, stop and report it rather than forcing the planned fix.
2. **SQL only goes in as migration files.** Every DB change is a new file in `supabase/migrations/` with a unique 14-digit timestamp later than `20261005060000`. Never paste SQL into the dashboard without committing the identical file. Do not edit old migrations. Also copy each new migration into `.bop-backend-package/supabase/migrations/`.
3. **Take a backup first.** Before applying any migration to production, confirm a PITR or backup point exists. Every migration must be idempotent (`IF EXISTS` / `IF NOT EXISTS` / `CREATE OR REPLACE`) and must include a commented rollback block at the bottom.
4. **Do not use `DROP VIEW ... CASCADE`.** It silently drops dependent RPCs and grants (audit DB-03). If a drop is unavoidable, list every dependent object first (`pg_depend`) and recreate it plus its grants in the same file.
5. **Timezone rule.** Business dates are IST: in SQL use `(now() AT TIME ZONE 'Asia/Kolkata')::date`; in TS use the `utils/businessDate.ts` helpers. Never use `toISOString().slice(0,10)` to get a date.
6. **Backward compatibility.** The bundled fallback inside older APKs still calls the old RPC signatures. Add parameters only with `DEFAULT` values. Never remove or reorder existing parameters.
7. **The empty migration files mean those fixes were never done.** `20261005020000_phase0_security_hotfixes.sql` and `20261005030000_phase3_attendance_regularization.sql` are 0 bytes. Do not assume Phase 0 security fixes exist.
8. **No new permission system.** Extend the existing `user_permissions(user_id, permission, scope, scope_id, revoked_at)` and `can_access_user_data()`. Do not create new tables named roles, grants, or similar.
9. **Definition of done for each level:** code changed, migration file written, tests added or updated, `npm run typecheck` and `npm test` pass, and the level's acceptance checks are shown with evidence.

---

## ISSUE A: Attendance Control shows only 27–30 Sept for a 1–30 Sept range

### A-Level 1: Understand the current flow (read, don't change)

- `screens/admin/AttendanceControlScreenNew.tsx:448` calls `CanonicalAttendanceService.list(s, e, 20_000, forcedOfficeId ? {office_id} : undefined)`.
- `services/canonical-attendance.service.ts:65-111` makes ONE call to `supabase.rpc("rpc_attendance_canonical_range", {...})` with no `.range()`. Every result is accepted (line 89). The paginated fallback at lines 116-150 only runs if the RPC throws.
- `rpc_attendance_canonical_range` is defined in `supabase/migrations/20261005000000_fix_attendance_control_historical_range.sql:533`. It `RETURNS SETOF` and ends with `ORDER BY e.work_date DESC, e.employee_name ASC` (line ~1039). Check whether `20261005040000_phase3_attendance_precedence.sql` redefines it; if so, use the latest definition.
- The name search ("Ritesh") runs **client-side** on the rows already loaded (`AttendanceControlScreenNew.tsx:589-593`).

**Hypothesis to prove:** PostgREST max-rows (Supabase default 1000) truncates the RPC result. Rows are ordered newest-first, so 1000 rows ≈ 4 days × ~250 employees. Only 27–30 Sept survive, and the client-side search then finds Ritesh only on those days.

### A-Level 2: Verify the root cause (required before fixing)

1. Supabase Dashboard → Project Settings → API → **Max rows**. Record the value.
2. As service_role or an admin, run `select count(*) from public.rpc_attendance_canonical_range('2026-09-01','2026-09-30',null,null,null);` and compare it with the number of rows the app receives. In the browser devtools Network tab on `/rest/v1/rpc/rpc_attendance_canonical_range`, record the response row count and the `Content-Range` header.
3. Count employees per day: `select count(*) from profiles where attendance_reporting_enabled and is_active;`. Confirm that 1000 ÷ this number ≈ the number of days shown.
4. Record the result: "received N rows; true total M; max-rows = X". If N < M, the hypothesis is confirmed. If not, stop and investigate the real cause (date-picker values, `forcedOfficeId`, `last_working_date`/`joining_date` filters in the `employee_days` CTE), and report before changing anything.

### A-Level 3: Fix (server and client)

1. **Stable ordering (migration).** Recreate `rpc_attendance_canonical_range` with a unique final order key: `ORDER BY e.work_date DESC, e.employee_name ASC, e.user_id ASC`. Without the `user_id` tie-breaker, pages can skip or duplicate rows when names repeat. Keep the signature, `SECURITY DEFINER`, `SET search_path`, and the grant to `authenticated`. Re-grant explicitly.
2. **Optional server-side search.** Add `p_search text DEFAULT NULL`, filtering `employee_name ILIKE '%'||p_search||'%' OR employee_number ILIKE ...` inside the `employee_days` CTE, so a name search over a long range returns few rows. Older callers keep working because of the default.
3. **Authorization (closes audit SEC-05; required while the function is being edited).** At the top of the function:
   - If `auth.uid()` is null, raise `UNAUTHENTICATED`.
   - If the caller is SYSTEM_ADMIN/ADMIN (role normalized via `normalize_profile_role`), or holds a GLOBAL `attendance.view` grant, the requested filters apply as passed.
   - Otherwise, restrict rows to user ids where `can_access_user_data(user_id, 'attendance.view')` is true. Keep the existing behaviour that an employee always sees their own rows.
   - Make this a **set-based** filter (join against the set of authorized user ids), not a per-row function call over 30 days × N employees. If needed, create a helper `authorized_user_ids(p_permission text) RETURNS SETOF uuid` (see B-Level 4) and use it here.
4. **Client paging.** In `CanonicalAttendanceService.list`, loop the RPC with `.range(offset, offset + PAGE_SIZE - 1)`, where PAGE_SIZE is ≤ the max-rows value (use 1000 or the existing 500), until a page comes back short or `maximum` is reached. If `maximum` is reached, **throw** an explicit error ("Range too large: narrow the date range or office"). Never return a silent partial result.
5. Remove the always-true condition `(rpcData.length > 0 || rpcData.length === 0)` at line 89. Remove the empty `catch {}` at line 112: log the error and only fall back when the RPC is genuinely missing (PGRST202 / 42883).
6. If you add `p_search`, wire the screen's search box to call the server after a debounce (≥400 ms). Keep the client-side filter only as instant narrowing of rows already loaded.

### A-Level 4: Fix every other caller of the same service (same bug)

Check these callers and confirm each now gets complete data. Fix any that bypass the service:
- `screens/TVDisplayScreen.tsx` (`listDay`)
- `screens/AttendanceRegisterReportScreen.tsx:82` (it marks missing days as ABSENT, so truncation produces false absences)
- `screens/admin/AdvancedAttendanceReportScreen.tsx:210`
- The Monthly InOut base data and the "Download Complete Attendance Excel (10 sheets)" export in `AttendanceControlScreenNew.tsx`
- `LiveTrackingScreen.tsx:690` `.limit(5000)` (also capped at max-rows)
- `CheckInLogsScreen.tsx:209` and `InTransitScreen.tsx:651` (unpaged `profiles` fetches)

### A-Level 5: Tests and acceptance

- Unit test (mock supabase): the RPC returns pages of 1000, 1000, 437 → `list()` returns 2437 rows. A page count equal to the maximum → throws.
- Integration (if a test project exists): seed 300 employees × 30 days and assert that a full month returns 9000 rows across pages.
- **Manual acceptance (screenshot required):** Attendance Control, Last Month (2026-09-01 → 2026-09-30), search "Ritesh":
  - Every working day from 1 Sept appears.
  - Days before joining or after leaving are absent.
  - Weekly offs show as off/leave/configuration.
  - The Excel export contains the same days.
  - The Register report for September shows no false ABSENT entries.
- Logged in as a plain employee, calling the RPC directly with null filters returns **only their own rows**.

---

## ISSUE B: Permission Manager must work end-to-end

### B-Level 1: Facts already established (verify each before relying on it)

| # | Fact | Where |
|---|---|---|
| 1 | The UI offers GLOBAL, OFFICE, OFFICE_TREE, TEAM, TEAM_TREE, REPORTS_TO, ASSIGNED, SELF. The target for OFFICE/OFFICE_TREE/TEAM/TEAM_TREE is a **free-text UUID** `TextInput`. | `screens/admin/PermissionsManagerScreen.tsx:290-310` |
| 2 | `admin_grant_permission(uuid,text,text,text)` casts `p_scope::permission_scope` and **`p_scope_id::uuid`**, so a non-UUID scope id (e.g. a DEPARTMENT name) raises. HR/HRD are allowed to grant. | `20260929000012:23-60` |
| 3 | The enum `permission_scope` now has OFFICE, OFFICE_TREE, TEAM_TREE, REPORTS_TO, ASSIGNED added. | `20261001000000:555`, `20261005060000:6-9` |
| 4 | **Possible blocker:** `user_permissions` was first created in `20260908010000` with `scope text` + `CHECK (scope in ('GLOBAL','DEPARTMENT','BRANCH','TEAM','SELF'))` (`20260908070000:154`). The later `CREATE TABLE IF NOT EXISTS` with the enum column (`20260929000001:23`) was a no-op. If the live column is still text with that CHECK, every OFFICE, OFFICE_TREE, TEAM_TREE, REPORTS_TO and ASSIGNED grant fails. | must verify live |
| 5 | The final `can_access_user_data(uuid,text)` (`20261005010000:24-135`) handles only GLOBAL, SELF, OFFICE, DEPARTMENT and TEAM. **TEAM is interpreted as a team-lead user id** (a `reports_to` tree), not `teams.id`. OFFICE_TREE, TEAM_TREE, REPORTS_TO and ASSIGNED are not handled; they fall through to `false`. | migration |
| 6 | Two overloads of `admin_revoke_permission` may exist: `(uuid,text,text DEFAULT NULL)` from `20260909010000:279` and `(uuid,text)`. The UI calls it with 2 arguments, which is ambiguous (PGRST203). | verify live |
| 7 | `is_profile_admin()` returns TRUE for anyone with ANY active `user_permissions` row (`20260929000013:18-24`), and `require_profile_admin()` behaves the same. This makes every scoped grant effectively global admin through RLS. | migration |
| 8 | The RBAC tables `permissions`, `role_permissions`, `user_permission_overrides` and `permission_audit_logs` have no RLS. | `20260923010000` |
| 9 | The PermissionsManager route is not wrapped in `withPermissionGuard`. | `navigation/AdminStackNavigator.tsx:95` |
| 10 | The client caches permissions module-globally, so a revoke isn't visible until reload. | `hooks/usePermissions.ts:12-14` |

### B-Level 2: Verify the live state (run these and paste the output into your report)

```sql
-- column type and constraints
select column_name, data_type, udt_name from information_schema.columns
 where table_schema='public' and table_name='user_permissions';
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid='public.user_permissions'::regclass;
-- enum values
select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='permission_scope' order by enumsortorder;
-- overloads
select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('admin_grant_permission','admin_revoke_permission','can_access_user_data','is_profile_admin','require_profile_admin','get_my_permissions');
-- RLS state
select relname, relrowsecurity from pg_class where relname in
 ('user_permissions','permissions','role_permissions','user_permission_overrides','permission_audit_logs');
-- who would lose access if is_profile_admin is tightened
select p.id, p.name, p.role, count(up.*) grants from user_permissions up join profiles p on p.id=up.user_id
 where up.revoked_at is null group by 1,2,3 order by 3;
-- teams hierarchy available?
select column_name from information_schema.columns where table_schema='public' and table_name='teams';
```

Then try one grant of each scope type from the UI and record the exact error for each. These results decide which B-Level 4 steps are needed.

### B-Level 3: Decisions to confirm with the product owner (stop and ask if any is unanswered)

1. Is **HR/HRD** an admin (global everything), or a normal user with explicit GLOBAL grants? Recommended: not an admin; give explicit grants.
2. **TEAM** meaning: `teams.id` (the team record) or the team-lead's user id (`reports_to` tree)? Recommended:
   - TEAM = `teams.id` (members where `profiles.team_id = scope_id`)
   - TEAM_TREE = the team plus child teams (needs `teams.parent_id`; if that column doesn't exist, report it)
   - REPORTS_TO = a lead's direct and indirect reports by `reports_to`, where scope_id is the lead's user id, or null meaning "my reports"
3. **DEPARTMENT**: keep it? It is a free-text name, not a UUID.
4. **ASSIGNED** per resource: for field_visits it means assigned to me / created by me; for tasks, assignee = me; for employees, not applicable.

### B-Level 4: Database fixes (one migration, e.g. `20261006010000_permission_manager_end_to_end.sql`)

1. **Scope column.**
   - If live `scope` is text with the old CHECK: drop the CHECK and replace it with `CHECK (scope IN ('GLOBAL','OFFICE','OFFICE_TREE','TEAM','TEAM_TREE','REPORTS_TO','ASSIGNED','SELF','DEPARTMENT'))`. Alternatively convert to the enum with `ALTER COLUMN scope TYPE permission_scope USING scope::permission_scope`, first mapping `BRANCH → OFFICE`.
   - Migrate existing BRANCH rows to OFFICE.
   - Add `CHECK ((scope IN ('GLOBAL','SELF','ASSIGNED')) = (scope_id IS NULL) OR scope IN ('REPORTS_TO','DEPARTMENT'))`, or the equivalent rule you document.
2. **Fix `admin_grant_permission(uuid,text,text,text)`.**
   - Validate the target per scope:
     - OFFICE / OFFICE_TREE: `scope_id` must exist in `offices`.
     - TEAM / TEAM_TREE: it must exist in `teams`.
     - REPORTS_TO: a profile, or null.
     - DEPARTMENT: free text, with no `::uuid` cast.
     - GLOBAL / SELF / ASSIGNED: scope_id is forced to NULL.
   - Store `scope_id` as text.
   - Allow **multiple** active grants of the same permission with different scopes (e.g. attendance.view for OFFICE 136 and for TEAM 12). Revoke-then-insert should apply only to the same `(permission, scope, scope_id)`. Add a partial unique index on `(user_id, permission, scope, coalesce(scope_id,'')) WHERE revoked_at IS NULL`.
   - Write an audit row with actor, target, permission, scope, scope_id and reason.
   - Keep the HR check only if the decision in B-Level 3 #1 says so.
3. **One revoke function.** Run `DROP FUNCTION IF EXISTS admin_revoke_permission(uuid,text,text)`. Create `admin_revoke_permission(p_user_id uuid, p_permission text, p_scope text DEFAULT NULL, p_scope_id text DEFAULT NULL)`: null scope revokes all scopes of that permission; otherwise only the matching row. Make sure exactly one overload remains (verify with `regprocedure`).
4. **Rewrite `can_access_user_data(p_target_user_id uuid, p_permission text)` to cover every scope** using live org tables:
   - **GLOBAL**: true.
   - **SELF**: target = caller.
   - **OFFICE**: `target.office_id::text = scope_id`.
   - **OFFICE_TREE**: same as OFFICE, plus targets whose `team_id` belongs to a team of that office (`teams.office_id`, if the column exists).
   - **TEAM**: `target.team_id::text = scope_id`.
   - **TEAM_TREE**: a recursive CTE over `teams.parent_id` from scope_id, then `target.team_id` in that set.
   - **REPORTS_TO**: a recursive CTE over `profiles.reports_to` from `coalesce(scope_id::uuid, caller)`.
   - **DEPARTMENT**: case-insensitive department match.
   - **ASSIGNED**: return false here (it is record-level and resolved inside the resource RPC).
   - **Unknown scope**: false.
   - **Admins** (SYSTEM_ADMIN/ADMIN by `normalize_profile_role`): true.
5. **Add `authorized_user_ids(p_permission text) RETURNS SETOF uuid`.**
   - It applies the same rules as a set (one query per scope type, unioned) so list RPCs can `JOIN` it.
   - Admin or GLOBAL returns all active profiles.
   - Use STABLE, SECURITY DEFINER and `SET search_path = public, pg_temp`.
   - Use it in `rpc_attendance_canonical_range` (Issue A) and `rpc_admin_list_attendance_regularization`.
6. **Add `explain_access(p_user uuid, p_permission text, p_target uuid) RETURNS jsonb`.** It returns `{allowed, matched_grant:{scope,scope_id}, target:{office_id,team_id,reports_to}, reason}` for the simulator. Only admins may call it.
7. **Fix `is_profile_admin()` and `require_profile_admin()`.**
   - Make them role-only: SYSTEM_ADMIN/SUPER_ADMIN/ADMIN, plus HR/HRD only if the decision in B-Level 3 #1 says so.
   - **Before** applying this, use the B-Level 2 grant inventory to list every non-admin who currently relies on the "any grant = admin" behaviour, and every RLS policy and RPC using these functions.
   - For each delegated screen, make sure the user still gets access through `has_permission(key)` or `can_access_user_data`. Do not lock out legitimate users.
   - Write a short table in your report: user → previously → now.
8. **RLS.**
   - `ENABLE ROW LEVEL SECURITY` on `permissions`, `role_permissions`, `user_permission_overrides` and `permission_audit_logs`, and `REVOKE ALL ... FROM anon`.
   - `permissions` (the catalog): SELECT for authenticated; writes by admin only.
   - `permission_audit_logs`: SELECT for admins and `audit_logs.view` holders; no UPDATE or DELETE policy, so it is append-only.
   - Add `AFTER INSERT OR UPDATE OR DELETE` triggers on `user_permissions` that write to `permission_audit_logs`, so direct table writes are audited too.
9. **Catalog.** Make sure every key the UI and RPCs check exists in `permissions`. For example, the site-visit observer RPC checks `view_site_visit_observer`, which is not in the catalog. Pick one naming convention (`resource.action`, as seeded in `20261005060000`) and map the legacy `screen.*` keys.
10. `NOTIFY pgrst, 'reload schema';` at the end.

### B-Level 5: Frontend fixes

1. `PermissionsManagerScreen.tsx`:
   - Replace the free-text UUID input with a scope-dependent picker:
     - OFFICE / OFFICE_TREE: an office dropdown from `offices` (name shown, id stored).
     - TEAM / TEAM_TREE: a team dropdown from `teams`.
     - REPORTS_TO: an employee search (or "my reports").
     - DEPARTMENT: a dropdown of distinct `profiles.department`.
     - GLOBAL / SELF / ASSIGNED: no target.
   - Show the scope target by **name**, not UUID.
   - Allow several grants of the same permission with different scopes, listed as chips with a remove button for each.
   - Surface the RPC error message. Never show success unless the RPC returned success **and** the refreshed list contains the grant.
2. **Effective Access panel.** For the selected user, list each permission → scope → target name.
3. **Simulator.** Pick a permission and a target employee, call `explain_access`, and show ALLOW/DENY plus the reason.
4. **Conflict and redundancy hints.** For example, a GLOBAL grant together with an OFFICE grant for the same permission is redundant.
5. Wrap the PermissionsManager route with `withPermissionGuard('permissions.view')` (`navigation/AdminStackNavigator.tsx:95`).
6. `hooks/usePermissions.ts`: add `invalidatePermissions()`. Call it after any grant or revoke and on app focus. Optionally subscribe to a realtime broadcast for the current user only, so a revoke takes effect without a reload.
7. Callers that pass a client `p_office_id` derived from `perm.scope_id` (`AdvancedAttendanceReportScreen.tsx:314-316`, `AttendanceControlScreenNew.tsx:157-159`, `AttendanceRegularizationScreen.tsx:52`) must stop treating TEAM, SELF or other scope ids as office ids. The server now enforces scope; the client only narrows the results.

### B-Level 6: Tests and acceptance

Write tests that run as **real roles**. Use pgTAP, or supabase-js with test users signed in. Do not use mocks. Each scenario must pass:

| # | Grant | Expected |
|---|---|---|
| 1 | SYSTEM_ADMIN, no grants | everything allowed |
| 2 | attendance.view OFFICE 136 | 136 employees visible; 63 not visible (UI **and** direct RPC call) |
| 3 | attendance.view TEAM 12 | team 12 only |
| 4 | attendance.view TEAM_TREE North | North and its child teams; South denied |
| 5 | attendance.view REPORTS_TO (lead X) | X's direct and indirect reports only |
| 6 | attendance.view SELF | own rows only |
| 7 | attendance.view OFFICE 136 **and** TEAM 20 (other office) | the union of both |
| 8 | screen.birthday_management only | NOT an admin: cannot read others' attendance or leaves (regression test for `is_profile_admin`) |
| 9 | employee moves from office 136 to 63 | the OFFICE 136 viewer loses them immediately, with no grant edits |
| 10 | revoke attendance.view OFFICE 136 | the direct RPC is denied at once; the UI hides it after invalidation |
| 11 | anon key, direct calls | `user_permissions`, `user_permission_overrides` and `permission_audit_logs` cannot be read or written |
| 12 | grant each scope type through the UI | all 8 succeed with a named target; an invalid office or team id is rejected with a clear message |

Acceptance: all 12 pass, the screenshot evidence shows the Effective Access view and the simulator for scenario 2, and only one overload exists for each permission RPC.

---

## ISSUE C: Google Maps on the mobile app

### C-Level 1: Identify the exact symptom first

Run the **release** APK (not Expo Go) on a real Android device and walk through every map surface. For each one, record whether the map renders, shows "For development purposes only", shows a grey box, shows an error, or crashes, and what the console says. Get the console from `chrome://inspect` → the WebView, and native logs from `adb logcat | grep -i -E "maps|google|webview"`.

| Surface | File | How it renders |
|---|---|---|
| Live Tracking map | `screens/admin/LiveTrackingScreen.tsx:307,543,1299` | `<iframe src="https://www.google.com/maps/embed/v1/place?key=…">` (Maps Embed API) |
| In-Transit route map | `screens/admin/InTransitScreen.tsx:141-257` | `<iframe src="data:text/html,…">` that loads the Maps JS API + DirectionsService, **web-only** (`Platform.OS !== "web"` returns null) |
| My Team ping map | `screens/MyTeamScreen.tsx:189-255` | native `WebView source={{ html }}` that loads the Maps JS API, **with no baseUrl** |
| Check-In Logs map | `screens/admin/CheckInLogsScreen.tsx:62` | inspect |
| Active Journey card | `components/ActiveJourneyCard.tsx:17,214` (native, `react-native-maps` + `PROVIDER_GOOGLE`) and `ActiveJourneyCard.web.tsx` (Maps JS via `utils/googleMapsLoader.ts`) | |
| Static map thumbnails | `utils/googleGeolocation.ts:76` | Static Maps API |
| "Open in Maps" / "Navigate" buttons | `googleMapsDeepLink` / `googleMapsNavLink`; `AndroidHrmsShell.tsx:374-381` routes non-HRMS URLs to `Linking.openURL` | |
| Driving ETA | `utils/googleMaps.ts` `getDrivingMinutes`, `services/location/route.service.ts:26` | Routes/Directions API over REST |

Remember that the shipped app is a WebView shell: most screens run the **web** code inside the WebView at `https://bop.in/HRMS/`. The native `react-native-maps` path only runs in the bundled fallback.

### C-Level 2: Likely root causes to check (verify each; report which ones apply)

1. **Key referrer restrictions.** `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` is a browser key. In Google Cloud Console → Credentials, check its Application restrictions.
   - The referrer list must include `https://bop.in/*` (and any test host).
   - A **`data:` URL iframe** (InTransit) and a **WebView loaded with raw `html` and no baseUrl** (MyTeam) send no valid referrer, so Maps JS returns `RefererNotAllowedMapError` and the map stays grey.
   - Look for that exact string in the console.
2. **APIs not enabled or no billing.** The project must have **Maps JavaScript API, Maps Embed API, Maps Static API, Directions API / Routes API, and Geocoding (if used)** enabled, with billing active. Errors look like `ApiNotActivatedMapError` or `BillingNotEnabledMapError`.
3. **Map ID.** `mapId:'DEMO_MAP_ID'` (MyTeamScreen:199, `utils/googleAdvancedMarkers.ts:2`) is for development only. AdvancedMarkerElement needs a real Map ID (`EXPO_PUBLIC_GOOGLE_MAPS_MAP_ID`), otherwise markers may not render in production.
4. **Native SDK key (fallback / native screens).** `app.config.js:34-36` injects `android.config.googleMaps.apiKey` from `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` at **build time**.
   - Check that the EAS build profile actually has this variable. `eas.json` sets only `LOCATION_RPC`, and `.env` is not used by EAS cloud builds.
   - Check the merged `AndroidManifest.xml` in the built APK (`com.google.android.geo.API_KEY`).
   - The key used for the Android SDK must allow **Android apps** with package `com.rehrms.app` plus the **SHA-1 of the EAS upload keystore AND the Play App Signing key**. Get them from `eas credentials` and Play Console → App integrity.
   - The **Maps SDK for Android** must be enabled.
   - A browser key with referrer restrictions will NOT work for the native SDK. Use **two keys**: a web key (referrer-restricted) and an Android key (app-restricted). Add `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY`, or a non-public build variable, for app.config.js.
5. **The shell blocks map navigation.** `allowNavigation` (`AndroidHrmsShell.tsx:374-381`) sends every non-HRMS main-frame URL to `Linking.openURL`. Confirm that iframes are not affected (Android only intercepts main-frame navigations) and that "Open in Maps" correctly opens the Google Maps app. On Android 11+, add `<queries>` intents for `geo:` and `https://maps.google.com` if `Linking.canOpenURL` is used anywhere.
6. **Location inside the WebView.** `geolocationEnabled` is set (line 473). Confirm the app's runtime location permission is granted before the page calls `navigator.geolocation`. If it isn't, the page's "my location" shows nothing. Show a clear prompt in that case.

### C-Level 3: Fixes (apply only those that C-Level 2 proved)

1. **Remove null-origin map documents.**
   - InTransit route map: render the map directly in the page DOM with `utils/googleMapsLoader.ts` (the same approach as `ActiveJourneyCard.web.tsx`) instead of an iframe with `data:`.
   - MyTeam native WebView: pass `source={{ html, baseUrl: 'https://bop.in/HRMS/' }}`, or better, use the shared loader inside the page when running inside the shell.
2. **One shared map component** for web and shell, `components/maps/HrmsMap.web.tsx`, built on `googleMapsLoader`. It supports markers, a polyline/route and fit-bounds, and shows a visible fallback (a static map image plus an "Open in Google Maps" button) when the loader fails. Never show a silent grey box. Use it in LiveTracking, InTransit, MyTeam, CheckInLogs and ActiveJourney.
3. **Keys.** Split into a web key and an Android key. Put both in the EAS environment for `production` and `preview`, and in the hosting build for web. Document both in `.env.example` (names only). Restrict each key to the APIs it needs.
4. **Map ID.** Create a production Map ID in Cloud Console and set `EXPO_PUBLIC_GOOGLE_MAPS_MAP_ID` everywhere. Replace the `'DEMO_MAP_ID'` literals.
5. **Native fallback.** Make `ActiveJourneyCard.tsx` handle a map load failure (`onMapReady` timeout) with the same static-image fallback.
6. **ETA calls.** Run `getDrivingMinutes` calls in parallel with a small cache (key: origin, destination and time rounded to 5 minutes) instead of sequential awaits (`InTransitScreen.tsx:711,815`).
7. **Do not** hardcode any key in source or commit it.

### C-Level 4: Tests and acceptance

- **Matrix:** Android release APK on 2 devices (Android 11 and Android 14), plus Chrome desktop and Chrome mobile web. Cover every surface in the C-Level 1 table.
- For each surface: the map renders with markers and route, there are no `*MapError` messages in the console, and "Open in Maps" launches the Google Maps app.
- With the network blocked to `maps.googleapis.com`, the fallback image or button appears instead of a grey box.
- Provide screenshots per surface and the console output before and after the fix.

---

## FINAL REPORT FORMAT (what you must hand back)

1. **Verification log.** For each "Verify" step, give the query or command and its actual output.
2. **Root cause per issue.** State whether it was confirmed or changed from the hypothesis, with evidence.
3. **Changes.** Files changed (path:line ranges), migrations added (filenames), and the rollback for each migration.
4. **Decisions taken.** For B-Level 3, record who decided what.
5. **Access-change table.** Users whose effective access changed when `is_profile_admin` was tightened.
6. **Test results.** Unit, integration and manual, with screenshots for A-Level 5, B-Level 6 and C-Level 4.
7. **Out-of-scope findings.** List them only; do not fix them.
8. **Anything not done, and why.**

Do not claim something is fixed without the evidence above.
