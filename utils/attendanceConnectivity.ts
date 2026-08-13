import NetInfo from "@react-native-community/netinfo";

export async function attendanceInternetAvailable(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.isConnected === true && state.isInternetReachable !== false;
}
