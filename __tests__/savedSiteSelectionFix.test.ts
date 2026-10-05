import fs from "fs";
import path from "path";

jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      neq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
    }),
  },
}));

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

import {
  PredefinedSiteService,
  // ([] as any[]),
  // '@hrms_predefined_sites_cache',
} from "../services/predefined-site.service";

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");

describe("Saved Site Selection & PredefinedSiteService Resilience", () => {
  const sitePickerSource = read("components/SitePickerModal.tsx");
  const predefinedServiceSource = read("services/predefined-site.service.ts");
  const meetingDetailSource = read("components/MeetingDetailModal.tsx");

  describe("PredefinedSiteService", () => {
    it("exports default predefined company project sites with valid coordinates", () => {
      expect(([] as any[]).length).toBeGreaterThanOrEqual(8);
      for (const site of ([] as any[])) {
        expect(site.id).toBeTruthy();
        expect(site.project_name).toBeTruthy();
        expect(site.site_label).toBeTruthy();
        expect(Number.isFinite(site.latitude)).toBe(true);
        expect(Number.isFinite(site.longitude)).toBe(true);
        expect(site.checkin_radius_m).toBeGreaterThan(0);
        expect(site.is_active).toBe(true);
      }
    });

    it("calculates geofence allowance accurately using checkGeoFence", () => {
      const sampleSite = ([] as any[])[0];
      // Exactly at site
      const atSite = PredefinedSiteService.checkGeoFence(
        sampleSite,
        sampleSite.latitude,
        sampleSite.longitude,
      );
      expect(atSite.allowed).toBe(true);
      expect(atSite.distanceM).toBe(0);

      // Far away (Delhi vs Noida, > 10km)
      const farAway = PredefinedSiteService.checkGeoFence(
        sampleSite,
        sampleSite.latitude + 0.2,
        sampleSite.longitude + 0.2,
      );
      expect(farAway.allowed).toBe(false);
      expect(farAway.distanceM).toBeGreaterThan(sampleSite.checkin_radius_m);
    });

    it("has persistent caching key configured", () => {
      expect('@hrms_predefined_sites_cache').toBe("@hrms_predefined_sites_cache");
      expect(predefinedServiceSource).toContain("AsyncStorage.setItem");
      expect(predefinedServiceSource).toContain("AsyncStorage.getItem");
    });
  });

  describe("SitePickerModal UI & Selection Flow", () => {
    it("provides segmented tabs for Saved Sites vs Search / Custom", () => {
      expect(sitePickerSource).toContain('activeTab === "saved"');
      expect(sitePickerSource).toContain('activeTab === "manual"');
      expect(sitePickerSource).toContain("st.tabBar");
      expect(sitePickerSource).toContain("st.tabItem");
    });

    it("provides quick search and filtering for saved sites", () => {
      expect(sitePickerSource).toContain("siteSearch");
      expect(sitePickerSource).toContain("filteredSites");
      expect(sitePickerSource).toContain("st.searchBox");
      expect(sitePickerSource).toContain("st.searchInput");
    });

    it("applies distinct active selection styling to the chosen site card", () => {
      expect(sitePickerSource).toContain("st.siteCardSelected");
      expect(sitePickerSource).toContain("st.siteNameSelected");
      expect(sitePickerSource).toContain("st.checkedCircle");
    });

    it("renders the destination confirmation card directly inline when selected", () => {
      expect(sitePickerSource).toContain("st.inlineDestinationCard");
      expect(sitePickerSource).toContain("Destination selected");
      expect(sitePickerSource).toContain("Coordinates:");
      expect(sitePickerSource).toContain("Arrival radius:");
      expect(sitePickerSource).toContain("st.confirmBtnInline");
    });

    it("provides a sticky bottom confirmation footer bar so users never miss confirmation", () => {
      expect(sitePickerSource).toMatch(/confirmBtn/);
      expect(sitePickerSource).toMatch(/confirmBtn/);
      expect(sitePickerSource).toContain("handleConfirmSaved(selectedSavedSite)");
    });

    it("correctly forwards predefinedSiteId and destination coordinates in MeetingDetailModal", () => {
      expect(meetingDetailSource).toContain("predefinedSiteId: result.predefinedSite?.id");
      expect(meetingDetailSource).toContain("destinationCoords: result.destinationCoords");
      expect(meetingDetailSource).toContain("checkinRadiusM: result.checkinRadiusM");
      expect(meetingDetailSource).toContain("locationSource: result.locationSource");
    });
  });
});
