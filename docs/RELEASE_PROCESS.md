# HRMS release process (web + Android)

## How updates reach users

| What changed | How it reaches users | What you do |
|---|---|---|
| Screens, business logic, reports, styles: anything in `screens/`, `services/`, `components/`, `utils/`, `hooks/` | **Web upload.** Browsers and the Android app both load `https://bop.in/HRMS/`. The Android app is a shell around that site. | Build and upload the zip (below). |
| Android shell JavaScript: `components/AndroidHrmsShell.tsx`, `services/location/*`, `services/nativeBridge/*`, notifications code | **EAS Update (OTA).** It downloads in the background and applies on the next app start. | `npx eas-cli update --channel <channel> --platform android --message "..."` |
| Native changes: new native package, `app.json` permissions or plugins, Expo SDK upgrade, Firebase/Maps keys, app icon | **New APK/AAB** (EAS Build). OTA cannot deliver these. | Bump `version` and `androidVersionCode` in `release.config.json`, run `eas build`, and distribute the APK. |

The `dist` upload never changes the installed APK itself. It changes the HRMS screens that the APK loads.

## In-app update notice (one per release)

- Every `export_web.ps1` run stamps a new release ID (an IST timestamp, e.g. `20261006.153422`) into the bundle and into `dist/version.json`.
- The app (browser, iPhone or Android) compares its own release ID with `/HRMS/version.json`:
  - on start, and on returning to the app (at most every 5 minutes);
  - there is no background polling.
- When the IDs differ, the notice appears **once for that release**:
  - **Update now**: clears this app's offline cache and service worker, then reloads the whole HRMS once.
  - **Later**: the notice never appears again for that release. The next app start loads the new release anyway.
- If `version.json` can't be fetched (offline, server down), nothing happens and the current version keeps working.
- Reload-loop protection: if a reload still returns the old version (a stale proxy), the notice is not shown again.

### Options in `release.config.json`

| Key | Meaning |
|---|---|
| `mandatoryWebUpdate` | `true`: the notice has no "Later" button. Use it for releases that must be applied (for example, after a breaking database change). Set it back to `false` for the next release. |
| `updateMessage` | Optional custom text for the notice. Empty uses the default text. |
| `minAndroidAppVersion` | If the installed Android app is older than this, the user sees "install the latest app" once. Raise it after a native release. |
| `androidDownloadUrl` | Link for the "Download" button in that message (Play Store or APK URL). |

## Release steps (web, the normal case)

1. If the release needs database changes, run its `supabase/migrations/*.sql` files in the Supabase SQL Editor **first**.
2. Build and package:
   ```powershell
   powershell -ExecutionPolicy Bypass -File ./deploy_bop_web.ps1 -WebBasePath HRMS
   ```
3. Upload `bop-hrms-deploy.zip` to Hostinger. Extract it in `public_html` so that `/HRMS/index.html`, `/HRMS/version.json` and `/HRMS/_expo/` sit side by side. Overwrite all files.
4. Check that `https://bop.in/HRMS/version.json` shows the new `buildId`.
5. Users with HRMS open see the notice once. Everyone else gets the new version on their next start.

## Native shell OTA (only when shell code changed)

```powershell
npx eas-cli update --channel preview --environment preview --platform android --message "Describe the change"
```

- Use the channel your installed APKs were built with (the builds in `eas.json`).
- The update downloads in the background and is applied on the next app start. The app is never reloaded mid-use.
- If the download fails, the current version keeps running.
- **Compatibility:** an OTA only reaches APKs with the same `runtimeVersion`, which is `version` in `release.config.json`. After any native change, bump `version` before `eas build`. Otherwise an OTA meant for the new APK could reach older APKs.

## Files to maintain

| File | Purpose |
|---|---|
| `release.config.json` | `version` / `androidVersionCode` (native releases), plus the update options above. You no longer need to bump `buildId` by hand for web releases. |
| `export_web.ps1` | Builds the web app, stamps the release ID, writes `dist/version.json`. |
| `prepare_bop_hosting.ps1` | Packages `dist` (including `version.json`) into `bop-hrms-deploy.zip`. |
| `public/.htaccess` | Marks `index.html`, `sw.js`, `manifest.webmanifest` and `version.json` as no-cache, so nobody gets stuck on an old release. |
| `components/ReleaseUpdateNotice.tsx` | The once-per-release notice. |
| `components/AutomaticUpdates.tsx` | Background EAS Update download for the native shell. |

## Android app 1.3.0 (one-time APK rebuild)

Version 1.3.0 is the first APK with over-the-air updates turned on, Firebase push included, and the stability fixes. Everyone installs it once. After that:
- screen changes arrive with every web upload;
- changes to the app's own code arrive by EAS Update on the next app start.

### Before building

1. In the [Expo dashboard](https://expo.dev) → project → Credentials → Android, upload the **FCM V1 service account key**. This is the Firebase Admin SDK JSON from Firebase console → Project settings → Service accounts. Without it, Expo cannot deliver pushes to the APK, even though `google-services.json` is in the build.
2. Check that `google-services.json` is for package `com.rehrms.app`. It is.

### Build

```powershell
npx eas-cli build --platform android --profile production
```

Install the APK from the build page. To make the in-app "install the latest app" notice appear once on old installs, put the APK link in `androidDownloadUrl` and set `minAndroidAppVersion` to `1.3.0` in `release.config.json`, then upload the web build.

### Later updates of the app's own code (no reinstall)

```powershell
npx eas-cli update --channel production --platform android --message "Describe the change"
```

This reaches only APKs with the same `version` (1.3.0). Bump `version` and rebuild only for native changes: permissions, plugins, SDK, Firebase or Maps keys, icon.

### What 1.3.0 fixes

- **Random logouts.** The app and the HRMS page share one login. When the app refreshed it in the background, the page later reused the old, already-used refresh token, and Supabase revoked the session. The page now takes the newer session from the app before refreshing.
- **Blank white screen** after Android kills the page in the background. The page now reloads by itself.
- **Crashes in the app's own code** show a recovery screen instead of closing the app.
- **Slow network.** The app no longer switches silently to the built-in version. It shows Retry (automatic when back online) or "Open built-in HRMS".
- **Logout** removes the phone from push notifications. Before, logout failed in the app and the next user could get the previous user's alerts.
- **Notification channels** are created at app start, not only after login.
- **Notification taps** are handled once, not twice. "Navigate" opens Maps directly, and "Got it" acknowledges the event.
