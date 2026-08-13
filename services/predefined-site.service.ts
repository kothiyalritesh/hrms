import { supabase } from "@/lib/supabase";

export interface PredefinedSite {
  id: string;
  project_name: string;
  site_label: string;
  address?: string;
  latitude: number;
  longitude: number;
  checkin_radius_m: number;
  site_type: "site" | "office" | "meeting";
  is_active: boolean;
}

function haversineMetres(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export const PredefinedSiteService = {
  async getAll(): Promise<PredefinedSite[]> {
    const { data, error } = await supabase
      .from("predefined_sites")
      .select("*")
      .eq("is_active", true)
      .order("project_name", { ascending: true });
    if (error) { console.error("[PredefinedSiteService]", error); return []; }
    return data || [];
  },

  /** Returns distance in metres from user GPS to the site */
  distanceTo(
    site: PredefinedSite,
    userLat: number,
    userLon: number
  ): number {
    return haversineMetres(site.latitude, site.longitude, userLat, userLon);
  },

  /** Returns null if within radius, or an error string if outside */
  checkGeoFence(
    site: PredefinedSite,
    userLat: number,
    userLon: number
  ): { allowed: boolean; distanceM: number } {
    const distanceM = haversineMetres(site.latitude, site.longitude, userLat, userLon);
    return { allowed: distanceM <= site.checkin_radius_m, distanceM };
  },

  /**
   * Scans all active predefined sites and returns the nearest one
   * that is within its check-in radius, along with the distance.
   * Returns null if no site is within range.
   */
  async findNearestSiteInRange(
    userLat: number,
    userLon: number
  ): Promise<{ site: PredefinedSite; distanceM: number } | null> {
    const sites = await this.getAll();
    let nearest: { site: PredefinedSite; distanceM: number } | null = null;
    for (const site of sites) {
      const distanceM = haversineMetres(site.latitude, site.longitude, userLat, userLon);
      if (distanceM <= site.checkin_radius_m) {
        if (!nearest || distanceM < nearest.distanceM) {
          nearest = { site, distanceM };
        }
      }
    }
    return nearest;
  },
};
