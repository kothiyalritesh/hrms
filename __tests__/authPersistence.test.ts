// @ts-nocheck -- regression guard for the browser auth client configuration.
import fs from "fs";
import path from "path";

describe("persistent authentication lifecycle", () => {
  const clientSource = fs.readFileSync(
    path.resolve(__dirname, "..", "lib", "supabase.ts"),
    "utf8",
  );
  const storageSource = fs.readFileSync(
    path.resolve(__dirname, "..", "utils", "secureStorage.ts"),
    "utf8",
  );
  const authSource = fs.readFileSync(
    path.resolve(__dirname, "..", "contexts", "AuthContext.tsx"),
    "utf8",
  );
  const appSource = fs.readFileSync(
    path.resolve(__dirname, "..", "App.tsx"),
    "utf8",
  );
  const profileSource = fs.readFileSync(
    path.resolve(__dirname, "..", "screens", "ProfileScreen.tsx"),
    "utf8",
  );

  it("enables persistent Supabase session recovery on the application client", () => {
    expect(clientSource).toContain("persistSession: true");
    expect(clientSource).toContain("autoRefreshToken: true");
    expect(clientSource).toContain("detectSessionInUrl: false");
    // web inside the Android app reconciles with the shell; storage itself is
    // still the persistent (SecureStore / localStorage) adapter
    expect(clientSource).toContain("storage: createShellAwareAuthStorage(supabaseAuthStorageKey)");
    const shellStorage = require("fs").readFileSync(
      require("path").join(__dirname, "..", "lib", "shellAuthStorage.ts"),
      "utf8",
    );
    expect(shellStorage).toContain("persistentAuthStorage.getItem(key)");
    expect(clientSource).toContain("storageKey: supabaseAuthStorageKey");
  });

  it("uses SecureStore on native and persists authentication across browser restarts", () => {
    expect(storageSource).toContain("export const persistentAuthStorage");
    expect(storageSource).toContain("SecureStore.getItemAsync");
    expect(storageSource).toContain("SecureStore.setItemAsync");
    expect(storageSource).toContain("WHEN_UNLOCKED_THIS_DEVICE_ONLY");
    expect(storageSource).toContain("window.localStorage.getItem");
    expect(storageSource).toContain("window.localStorage.setItem");
    expect(storageSource).toContain("window.localStorage.removeItem");
    expect(storageSource).toContain("window.sessionStorage.getItem");
    expect(storageSource).toContain("window.sessionStorage.setItem");
    expect(storageSource).toContain(
      "window.localStorage.setItem(key, tabValue)",
    );
  });

  it("restores the cached user before network profile validation and retains session metadata", () => {
    expect(authSource).toContain("readStoredAuthMetadata()");
    expect(authSource).toContain("applyUser(cached)");
    expect(authSource).toContain("setIsLoading(false)");
    expect(authSource).toContain("last_successful_authentication_at");
    expect(authSource).toContain("last_session_refresh_at");
    expect(authSource).toContain(
      "if (disposed || error || !profile) return !!usableCache",
    );
  });

  it("registers one central auth listener and unsubscribes it", () => {
    expect(authSource.match(/onAuthStateChange/g)).toHaveLength(1);
    expect(authSource).toContain("authListener.subscription.unsubscribe()");
  });

  it("contains no blocking service verification screen", () => {
    expect(appSource).not.toContain("ReleaseContractGuard");
    expect(appSource).not.toContain("Verifying secure HRMS services");
    expect(appSource).not.toContain(
      "database and service versions are confirmed",
    );
    expect(appSource).not.toContain("Retry verification");
  });

  it("requires explicit logout confirmation", () => {
    expect(profileSource).toContain("Are you sure you want to log out?");
    expect(profileSource).toContain('text: "Cancel"');
    expect(profileSource).toContain('text: "Log Out"');
  });
});
