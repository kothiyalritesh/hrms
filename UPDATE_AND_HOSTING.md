# BOP HRMS web and mobile releases

The website and installed mobile application use separate deployment services:

- The production website is hosted at `https://bop.in/HRMS/`.
- EAS Update publishes JavaScript and bundled asset changes to compatible
  installed Android and iOS builds.

## One-time mobile requirement

Users must install an EAS Update-enabled APK once. Builds made before
`expo-updates` was configured cannot receive over-the-air updates.

After that installation, updates to screens, business logic, styles, text, and
bundled images can be delivered without downloading another APK. Updates that
change native libraries, Android/iOS permissions, app identifiers, the Expo
SDK, or native configuration require a new binary build.

## Release from the VS Code terminal

Run:

```powershell
.\release_updates.ps1 -Message "Describe this release"
```

This command validates the Expo project, creates a fresh web `dist`, prepares
`bop-hrms-deploy.zip`, and publishes the same source to the `preview` mobile
update channel used by the internally distributed APK.

The current package serves HTML, Expo bundles, and assets beneath `/HRMS/`.
For Apache, the included `/HRMS/.htaccess` provides the nested-route SPA
fallback. For nginx, configure the equivalent fallback:

```nginx
location /HRMS/ {
  try_files $uri $uri/ /HRMS/index.html;
}
```

Set `EXPO_PUBLIC_WEB_BASE_PATH` before export and pass the same value to
`prepare_bop_hosting.ps1 -WebBasePath` when deploying under a different
subdirectory. Automatic web upload additionally requires the hosting account's
SSH/SFTP or CI/CD credentials. Do not store a hosting password in this
repository; use an SSH key or the hosting provider's secret store.

The mobile application checks for a compatible update when it starts,
downloads it, and reloads automatically. A phone must have internet access and
the application must be opened for an update to download.

For a future Play Store or App Store production build, publish compatible
updates with:

```powershell
npm run update:production -- --message "Describe this release"
```
