const fs = require("fs");
const path = require("path");
const releaseConfig = require("./release.config.json");

const easProjectId =
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID || "49f3f4fa-06cd-45ed-b80e-cec0d93bf6a9";
// Firebase client config (not a secret: it only identifies the app). Without
// it the APK cannot receive push notifications. An EAS file variable
// GOOGLE_SERVICES_JSON still takes precedence.
const localGoogleServices = fs.existsSync(path.join(__dirname, "google-services.json"))
  ? "./google-services.json"
  : undefined;
// A placeholder Firebase file builds fine but gives an APK that can never get a
// push token, so phones silently receive no notifications. Stop such builds.
if (process.env.EAS_BUILD === "true" && !process.env.GOOGLE_SERVICES_JSON && localGoogleServices) {
  const firebase = JSON.parse(
    fs.readFileSync(path.join(__dirname, "google-services.json"), "utf8"),
  );
  if (/dummy/i.test(String(firebase?.project_info?.project_id ?? ""))) {
    throw new Error(
      "google-services.json is a placeholder (dummy-project). Download the real file for com.rehrms.app from the Firebase console.",
    );
  }
}
const enableReactCompiler =
  process.env.EXPO_PUBLIC_ENABLE_REACT_COMPILER === "true";

const configuredBasePath = process.env.EXPO_PUBLIC_WEB_BASE_PATH ?? "/";
const expoBaseUrl =
  configuredBasePath === "/"
    ? ""
    : `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`;

const googleMapsApiKey =
  process.env.GOOGLE_MAPS_ANDROID_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
  "AIzaSyANgUrLzyb_Q26_ztZTet3CYGayZUmQgQA";

module.exports = ({ config }) => ({
  ...config,
  version: releaseConfig.version,
  // react-native-maps' own config plugin writes com.google.android.geo.API_KEY
  // into AndroidManifest.xml — and REMOVES it when called without the key, so
  // android.config.googleMaps alone leaves the APK without a key.
  plugins: [
    ...(config.plugins || []).filter(
      (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) !== "react-native-maps",
    ),
    [
      "react-native-maps",
      { androidGoogleMapsApiKey: googleMapsApiKey, iosGoogleMapsApiKey: googleMapsApiKey },
    ],
  ],
  ios: {
    ...config.ios,
    config: {
      ...(config.ios?.config || {}),
      googleMapsApiKey:
        process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || googleMapsApiKey,
    },
  },
  android: {
    ...config.android,
    versionCode: releaseConfig.androidVersionCode,
    // Configure GOOGLE_SERVICES_JSON as an EAS file-secret path. Keeping the
    // Firebase client file out of source control avoids accidental environment
    // mix-ups while still making FCM configuration reproducible in builds.
    googleServicesFile:
      process.env.GOOGLE_SERVICES_JSON ||
      config.android?.googleServicesFile ||
      localGoogleServices,
    config: {
      ...(config.android?.config || {}),
      googleMaps: {
        ...(config.android?.config?.googleMaps || {}),
        apiKey: googleMapsApiKey,
      },
    },
  },
  web: config.web,
  // EAS Update (over-the-air updates of the app's own code). Without a URL
  // expo-updates is disabled in the APK. fallbackToCacheTimeout 0: never delay
  // startup waiting for an update; a new update is downloaded in the
  // background and applied on the next launch.
  updates: {
    ...(config.updates || {}),
    url: `https://u.expo.dev/${easProjectId}`,
    fallbackToCacheTimeout: 0,
    checkAutomatically: "ON_LOAD",
  },
  experiments: {
    ...(config.experiments || {}),
    baseUrl: expoBaseUrl,
    // Compiling this large HRMS lazily in development kept Metro's single
    // event-loop core saturated, delaying even static fonts by 20+ seconds.
    // Production exports still receive Metro's normal minification and
    // optimizations. React Compiler can be explicitly re-enabled for a
    // benchmark build after upstream web transform performance improves.
    reactCompiler: enableReactCompiler,
  },
  extra: {
    ...(config.extra || {}),
    // This is the single runtime source for the router, manifest and service
    // worker scope. Expo's baseUrl above uses the same normalized value.
    webBasePath: expoBaseUrl || "/",
    requiredBackendSchemaVersion: releaseConfig.requiredBackendSchemaVersion,
    buildId: process.env.EXPO_PUBLIC_BUILD_ID || releaseConfig.buildId,
    androidMapsConfigured: Boolean(googleMapsApiKey),
    eas: {
      ...(config.extra?.eas || {}),
      projectId: easProjectId,
    },
  },
});
