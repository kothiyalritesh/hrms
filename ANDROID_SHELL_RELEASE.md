# BOP HRMS Android shell

The Android target is a native Expo capability shell. It loads the independently
deployed HRMS from `https://bop.in/HRMS/`; web and iOS targets continue to run
the bundled application.

## Update layers

1. Deploy `bop-hrms-deploy.zip` to update HRMS UI and business logic immediately.
2. Publish `eas update --channel preview --environment preview --platform android`
   for compatible shell JavaScript changes (runtime `1.2.0`).
3. Build a new APK/AAB when permissions, native modules, Android SDK settings,
   or the runtime version change.

The Android WebView does not register the HRMS PWA service worker, so a stale PWA
cache cannot override a new root deployment.

## Bridge v1

The strict `bop.hrms.native` v1 bridge accepts only pages under the HTTPS
`bop.in/HRMS` origin. Supported commands cover capability discovery, local
Supabase session synchronization, push registration, tracking permission/status,
attendance tracking restoration/start/stop, Android settings, EAS update checks,
and native file sharing. Unknown versions and commands are rejected.

The bridge never contains a Supabase service-role key. It transfers only the
logged-in user's short-lived session from the trusted HRMS page to native secure
storage so background tasks remain authenticated after Android recreates the
activity.

## FCM configuration required once per Firebase project

`expo-notifications` supplies the native FCM transport and the HRMS registers an
Expo push token with `rpc_register_device_push_token`. Before distributing a
push-enabled build, configure both Firebase items for package `com.rehrms.app`:

- Add the Android Firebase client `google-services.json` as an EAS **file**
  environment variable named `GOOGLE_SERVICES_JSON` in preview and production.
- Upload the matching FCM v1 service-account key to the Android app's EAS
  credentials.

Do not commit either credential. A build without the client file still supports
the HRMS shell and local notifications, but cannot obtain a remote FCM token.

## Release commands

```text
powershell -ExecutionPolicy Bypass -File .\deploy_bop_web.ps1 -WebBasePath HRMS
npx eas-cli@latest build --platform android --profile preview
npx eas-cli@latest build --platform android --profile production
```

Deploy the web ZIP before installing a bridge-enabled APK so the page and shell
both understand bridge v1.
