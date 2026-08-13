import Constants from "expo-constants";

const configuredWebBasePath =
  String(Constants.expoConfig?.extra?.webBasePath ?? "/").trim() || "/";

/**
 * Canonical browser base for this application. Keeping the leading and
 * trailing slash makes URL resolution and service-worker scoping unambiguous.
 */
export const webBasePath =
  configuredWebBasePath === "/"
    ? "/"
    : `/${configuredWebBasePath.replace(/^\/+|\/+$/g, "")}/`;
