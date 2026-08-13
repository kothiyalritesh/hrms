import { isDeveloperModeEnabled } from "expo-developer-mode";
export async function getDeviceIntegritySignals(){return{developerMode:(await isDeveloperModeEnabled())??false};}

