import { supabase } from "@/lib/supabase";

/**
 * Background job to detect users in transit
 * This should be called periodically (e.g., every 5 minutes)
 * 
 * Logic:
 * 1. Find all PENDING field visits created today
 * 2. For each visit, check if the user's latest GPS ping is >50m from the visit's origin
 * 3. If yes, update the visit status to IN_TRANSIT
 */
export async function checkForInTransitUsers() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  
  try {
    // Get all PENDING visits with origin coordinates
    const { data: pendingVisits, error: visitsError } = await supabase
      .from("field_visits")
      .select(`
        id,
        user_id,
        status,
        origin_lat,
        origin_lon,
        origin_name,
        destination_coords,
        location_name,
        created_at
      `)
      .eq("date", today)
      .eq("status", "PENDING")
      .is("origin_lat", null)
      .not("origin_lat", "is", null);

    if (visitsError) {
      console.warn("Error fetching pending visits:", visitsError);
      return { success: false, error: visitsError.message };
    }

    if (!pendingVisits || pendingVisits.length === 0) {
      console.log("No pending visits with origin coordinates found");
      return { success: true, count: 0, message: "No visits to check" };
    }

    // Get latest GPS ping for each user
    const userIds = [
      ...new Set(pendingVisits.map((v: any) => v.user_id as string)),
    ];
    const { data: latestPings, error: pingsError } = await supabase
      .from("location_tracking")
      .select(`
        user_id,
        latitude,
        longitude,
        recorded_at
      `)
      .in("user_id", userIds)
      .gte("recorded_at", today + "T00:00:00.000Z")
      .order("recorded_at", { ascending: false });

    if (pingsError) {
      console.warn("Error fetching latest GPS pings:", pingsError);
      return { success: false, error: pingsError.message };
    }

    // Create map of user_id -> latest GPS
    const pingMap = new Map();
    for (const ping of latestPings || []) {
      if (!pingMap.has(ping.user_id) && ping.latitude && ping.longitude) {
        pingMap.set(ping.user_id, {
          latitude: ping.latitude,
          longitude: ping.longitude,
          recorded_at: ping.recorded_at
        });
      }
    }

    // Check each visit and update status if user is in transit
    const inTransitUpdates = [];
    
    for (const visit of pendingVisits) {
      if (!visit.origin_lat || !visit.origin_lon) continue;
      
      const latestPing = pingMap.get(visit.user_id);
      if (!latestPing) continue;

      // Calculate distance from origin
      const distM = calculateDistance(
        visit.origin_lat,
        visit.origin_lon,
        latestPing.latitude,
        latestPing.longitude
      );

      // If user is >50m from origin, mark as IN_TRANSIT
      if (distM > 50) {
        inTransitUpdates.push({
          visit_id: visit.id,
          distance_from_origin: distM,
          user_id: visit.user_id,
          visit_type: visit.origin_name || "Unknown",
          location_name: visit.location_name
        });

        // Update the visit status to IN_TRANSIT
        await supabase
          .from("field_visits")
          .update({
            status: "IN_TRANSIT",
            updated_at: new Date().toISOString()
          })
          .eq("id", visit.id);
      }
    }

    console.log(`✓ Checked ${pendingVisits.length} visits, ${inTransitUpdates.length} marked as IN_TRANSIT`);

    return {
      success: true,
      count: inTransitUpdates.length,
      visits: inTransitUpdates
    };

  } catch (err) {
    console.error("Error in checkForInTransitUsers:", err);
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Calculate distance between two GPS coordinates using Haversine formula
 * Returns distance in meters
 */
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Start the background job to check for in-transit users
 * Runs every 5 minutes
 */
export function startInTransitMonitor() {
  console.log("Starting In Transit Monitor...");
  
  // Run immediately on startup
  checkForInTransitUsers();
  
  // Then run every 5 minutes
  const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  
  setInterval(async () => {
    console.log(`[${new Date().toLocaleTimeString()}] Checking for users in transit...`);
    const result = await checkForInTransitUsers();
    
    if (result.success) {
      console.log(`  → ${result.count} users now in transit`);
    } else {
      console.warn(`  → Error: ${result.error}`);
    }
  }, INTERVAL_MS);
}
