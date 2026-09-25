# HRMS - Reload Prevention + Dynamic Permission Manager Implementation Plan

This document outlines the end-to-end strategy to solve production SPA routing errors (502/503 on refresh) and fully replace hardcoded roles with a Dynamic Permission Manager (RBAC/ABAC).

## Phase 1: Architectural Audit & Gap Analysis (Steps 1-7)

### 1. Existing Production Architecture & Reload Failure
* **Framework:** The app is a React SPA built with Expo Web, using React Navigation (`@react-navigation/native`).
* **Deployment Setup:** Uses `export_web.ps1` to generate a static `dist` bundle. Hosted at `/HRMS/` (likely behind Apache or Nginx).
* **The 502/503 Bug:** 
  - `export_web.ps1` replaces `src="/_expo/"` with a **relative** path `src="./_expo/"` inside `index.html`.
  - When the browser reloads a deep link (e.g., `https://bop.in/HRMS/reports/ReportsAttendanceRegister`), it resolves the relative path against the current directory structure (`/HRMS/reports/`), attempting to fetch `/HRMS/reports/_expo/...`.
  - Additionally, dynamic imports via Metro runtime sometimes request absolute root `/` paths. The reverse proxy receives a request for `/_expo/...` (without `/HRMS/`) and attempts to route it to a backend service that isn't configured for it, crashing with a 502 Bad Gateway.
* **Fix:** Modify the export script and asset pipeline to strictly enforce absolute paths prefixed with the base path (`/HRMS/_expo/` instead of `./_expo/`), ensuring the browser always requests the correct URL regardless of deep-link nesting.

### 2. Authorization Gap Analysis
* **Current Model:** Hardcoded string comparisons scattered across components:
  - `isAdmin = ["ADMIN", "SYSTEM_ADMIN"].includes(user.role)`
  - `isHR = ["HR", "HRD"].includes(user.role)`
  - Used conditionally to render navigation tabs, action buttons, and fetch queries.
* **Database State:** A basic `user_permissions` table exists (`20260908070000_audit_logs_and_permission_scopes.sql`) with scopes (`GLOBAL`, `TEAM`, `SELF`), but it lacks a robust Role-to-Permission inheritance matrix and is largely ignored by the frontend.
* **Backend Security Gap:** Supabase RPCs and RLS policies rely heavily on `auth.jwt() ->> 'role'` instead of validating granular permissions.

## Phase 2: Database Schema & Permission Engine (Steps 8-9)

We will introduce a strict Precedence Model: `Explicit Deny > Explicit Allow > Role Allow > Default Deny`.

### Proposed Tables
1. **`permissions`**: Master list of modules/actions (e.g., `employee.view`, `attendance.manage`).
2. **`roles`**: Master list of roles (replaces hardcoded strings).
3. **`role_permissions`**: Maps default permissions and scopes to roles.
4. **`user_permissions`**: Maps granular overrides (Allow/Deny) and scopes to specific users.
5. **`permission_audit_logs`**: Tracks who granted/revoked what, to whom, when, and why.

## Phase 3: Core Implementation (Steps 10-16)

### 1. Centralized Permission Service
* Create `services/PermissionService.ts` to fetch and compute *Effective Permissions* at login.
* Create a React Context (`PermissionProvider`) that exposes `hasPermission(action, scope)` hook to the frontend.

### 2. UI Updates & Permission Manager
* **Add Date of Joining**: Update Employee Creation form and DB schema to handle `date_of_joining`.
* **Permission Manager UI**: Build `/admin/PermissionsManagerScreen` allowing authorized admins to select a Role or User, view grouped modules, and toggle checkboxes/scopes.

### 3. Route & Action-Level Integration
* Swap out `isHR`/`isAdmin` logic in `App.tsx` and Navigation files with `hasPermission('module.view')`.
* Hide action buttons (Edit, Delete, Approve) using `hasPermission('module.action')`.

### 4. Database Security Enforcement
* Write a secure PostgreSQL function `has_permission(_user_id, _permission_key, _scope)`.
* Update Supabase RLS policies (e.g., `attendance`, `profiles`) to invoke this function rather than checking string roles.

## Phase 4: Production Routing & SPA Fix (Steps 17-18)

* Update `export_web.ps1`:
  - Force absolute base paths: `$indexHtml.Replace('src="/_expo/', 'src="/HRMS/_expo/')`.
  - Ensure `.htaccess` (already present) correctly intercepts deep links and returns `index.html` without triggering 404s or 502s.
* Test direct URL loading without authentication (should redirect to login, then bounce back to deep link).

## Phase 5: Testing & Delivery (Steps 19-21)

* Run the Permission Matrix validation (e.g., Team Head viewing other team's attendance).
* Execute backend-bypass tests to ensure Supabase RPCs reject unauthorized requests.
* Submit the final Implementation Report with the compiled Permission Matrix.

