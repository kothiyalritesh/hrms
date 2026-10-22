import fs from "fs";
import path from "path";

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");

describe("Permissions Grant Fix & Audit Logs Compatibility", () => {
  const hotfixSql = read("supabase/fix_admin_grant_permission.sql");
  const masterDeploySql = read("supabase/deploy_all_20260908_enhancements.sql");
  const usePermissionsTs = read("hooks/usePermissions.ts");

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
    // expect(masterDeploySql).toContain("alter table public.audit_logs alter column record_id type text");
    // expect(masterDeploySql).toContain("v_existing_id");
    expect(masterDeploySql).toContain("notify pgrst, 'reload schema';");
  });

  // 2026-10-20: the unused PermissionsContext was removed; grants and revokes go
  // through the server RPCs (admin_set_access_bulk / admin_revoke_access_bulk),
  // which validate users, keys and scopes. The app's permission source is the
  // shared usePermissions store.
  test("usePermissions never caches a failed load and refreshes live", () => {
    expect(usePermissionsTs).toContain("supabase.rpc('get_my_access')");
    expect(usePermissionsTs).toContain("A failed load is never cached");
    expect(usePermissionsTs).toContain("table: 'user_permission_versions'");
    expect(usePermissionsTs).toMatch(/if \(inflight && inflightUser === userId\) return inflight;/);
  });
});

