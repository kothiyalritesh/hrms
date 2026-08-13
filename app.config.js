const releaseConfig = require("./release.config.json");
const enableReactCompiler =
  process.env.EXPO_PUBLIC_ENABLE_REACT_COMPILER === "true";

const configuredBasePath = process.env.EXPO_PUBLIC_WEB_BASE_PATH ?? "/";
const expoBaseUrl =
  configuredBasePath === "/"
    ? ""
    : `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`;

module.exports = ({ config }) => ({
  ...config,
  version: releaseConfig.version,
  ios: {
    ...config.ios,
    config: {
      ...(config.ios?.config || {}),
      googleMapsApiKey:
        process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || undefined,
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
      undefined,
    config: {
      ...(config.android?.config || {}),
      googleMaps: {
        ...(config.android?.config?.googleMaps || {}),
        apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || undefined,
      },
    },
  },
  web: config.web,
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
    eas: {
      ...(config.extra?.eas || {}),
      projectId:
        process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
        "49f3f4fa-06cd-45ed-b80e-cec0d93bf6a9",
    },
  },
});
