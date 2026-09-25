import fs from "fs";
import path from "path";

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");

describe("Permissions Grant Fix & Audit Logs Compatibility", () => {
  const hotfixSql = read("supabase/fix_admin_grant_permission.sql");
  const masterDeploySql = read("supabase/deploy_all_20260908_enhancements.sql");
  const permissionsContext = read("contexts/PermissionsContext.tsx");

  test("hotfix script alters audit_logs.record_id to text to avoid 42804 datatype mismatch", () => {
    expect(hotfixSql).toContain("alter table public.audit_logs alter column record_id type text");
    expect(hotfixSql).toContain("using record_id::text");
  });

  test("hotfix script drops obsolete function overloads to prevent PostgREST signature ambiguity", () => {
    expect(hotfixSql).toContain("drop function if exists public.admin_grant_permission(uuid, text);");
    expect(hotfixSql).toContain("drop function if exists public.admin_grant_permission(uuid, text, text, uuid);");
    expect(hotfixSql).toContain("drop function if exists public.admin_revoke_permission(uuid, text);");
    expect(hotfixSql).toContain("drop function if exists public.admin_revoke_permission(uuid, text, text);");
  });

  test("hotfix script drops legacy unique constraint to support scoped permissions", () => {
    expect(hotfixSql).toContain("alter table public.user_permissions drop constraint if exists user_permissions_unique;");
    expect(hotfixSql).toContain("create unique index if not exists idx_user_permissions_unique_scoped");
  });

  test("admin_grant_permission uses robust upsert logic instead of fragile partial index on conflict", () => {
    expect(hotfixSql).toContain("v_existing_id");
    expect(hotfixSql).toContain("update public.user_permissions");
    expect(hotfixSql).toMatch(/revoked_at\s*=\s*null/);
    expect(hotfixSql).not.toContain("on conflict do nothing");
  });

  test("master deployment script includes hardened admin_grant_permission and record_id alteration", () => {
    expect(masterDeploySql).toContain("alter table public.audit_logs alter column record_id type text");
    expect(masterDeploySql).toContain("v_existing_id");
    expect(masterDeploySql).toContain("notify pgrst, 'reload schema';");
  });

  test("PermissionsContext defensively sanitizes scopeId and validates inputs", () => {
    expect(permissionsContext).toContain("sanitizedScopeId");
    expect(permissionsContext).toContain("User ID is required");
    expect(permissionsContext).toContain("Permission is required");
  });
});

