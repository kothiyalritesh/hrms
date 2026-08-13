/**
 * The secure location RPC is enabled only after its Supabase migration has
 * been deployed. This keeps staged web/native clients compatible with the
 * existing location_tracking table during rollout and avoids repeated 404s.
 */
export const LOCATION_RPC_ENABLED =
  process.env.EXPO_PUBLIC_LOCATION_RPC_ENABLED === "true";
