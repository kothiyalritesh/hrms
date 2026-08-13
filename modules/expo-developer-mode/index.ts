import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
const Native = Platform.OS === "android" ? requireOptionalNativeModule<any>("ExpoDeveloperMode") : null;
export async function isDeveloperModeEnabled(): Promise<boolean | null> {
  if (!Native) return null;
  try { return await Native.isDeveloperModeEnabled(); } catch { return null; }
}
