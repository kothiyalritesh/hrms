import fs from "fs";
import path from "path";

// Disposition 2026-10-19 (docs/realtyhrm-audit/10_TEST_FAILURE_DISPOSITION.md):
// the earlier version asserted a hard-coded list of default sites, an
// AsyncStorage cache and a tabbed picker. Saved sites now come only from the
// predefined_sites table (no built-in list, so nothing is invented when the
// table is empty) and the picker uses a collapsible "Saved Sites" list. These
// tests cover that current behaviour.

const mockOrder = jest.fn();
jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: mockOrder,
    })),
  },
}));

import { supabase } from "@/lib/supabase";
import { PredefinedSiteService, type PredefinedSite } from "../services/predefined-site.service";

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");

const SITE: PredefinedSite = {
  id: "site-1",
  project_name: "Test Project",
  site_label: "Tower A",
  latitude: 28.5355,
  longitude: 77.391,
  checkin_radius_m: 150,
  site_type: "site",
  is_active: true,
};

describe("Saved Site Selection & PredefinedSiteService", () => {
  const sitePickerSource = read("components/SitePickerModal.tsx");
  const meetingDetailSource = read("components/MeetingDetailModal.tsx");

  describe("PredefinedSiteService", () => {
    beforeEach(() => mockOrder.mockReset());

    it("loads active sites from the predefined_sites table", async () => {
      mockOrder.mockResolvedValue({ data: [SITE], error: null });
      await expect(PredefinedSiteService.getAll()).resolves.toEqual([SITE]);
      expect(supabase.from).toHaveBeenCalledWith("predefined_sites");
    });

    it("returns an empty list (not invented sites) when the query fails", async () => {
      jest.spyOn(console, "error").mockImplementation(() => undefined);
      mockOrder.mockResolvedValue({ data: null, error: { message: "boom" } });
      await expect(PredefinedSiteService.getAll()).resolves.toEqual([]);
    });

    it("calculates geofence allowance using checkGeoFence", () => {
      const atSite = PredefinedSiteService.checkGeoFence(SITE, SITE.latitude, SITE.longitude);
      expect(atSite).toEqual({ allowed: true, distanceM: 0 });

      const farAway = PredefinedSiteService.checkGeoFence(SITE, SITE.latitude + 0.2, SITE.longitude + 0.2);
      expect(farAway.allowed).toBe(false);
      expect(farAway.distanceM).toBeGreaterThan(SITE.checkin_radius_m);
    });

    it("finds the nearest site that is within its radius", async () => {
      const far: PredefinedSite = { ...SITE, id: "site-2", latitude: SITE.latitude + 0.05 };
      mockOrder.mockResolvedValue({ data: [far, SITE], error: null });
      const nearest = await PredefinedSiteService.findNearestSiteInRange(SITE.latitude, SITE.longitude);
      expect(nearest?.site.id).toBe("site-1");
    });
  });

  describe("SitePickerModal UI & Selection Flow", () => {
    it("offers saved sites in a collapsible list", () => {
      expect(sitePickerSource).toContain("savedOpen");
      expect(sitePickerSource).toContain("st.savedBar");
      expect(sitePickerSource).toContain("Saved Sites");
    });

    it("selecting a saved site shows its destination details before confirming", () => {
      expect(sitePickerSource).toContain("setSelectedSavedSite(site)");
      expect(sitePickerSource).toContain("Destination selected");
      expect(sitePickerSource).toContain("Coordinates:");
      expect(sitePickerSource).toContain("Arrival radius:");
      expect(sitePickerSource).toContain("handleConfirmSaved(selectedSavedSite)");
    });

    it("forwards predefinedSiteId and destination coordinates in MeetingDetailModal", () => {
      expect(meetingDetailSource).toContain("predefinedSiteId: result.predefinedSite?.id");
      expect(meetingDetailSource).toContain("destinationCoords: result.destinationCoords");
      expect(meetingDetailSource).toContain("checkinRadiusM: result.checkinRadiusM");
      expect(meetingDetailSource).toContain("locationSource: result.locationSource");
    });
  });
});
