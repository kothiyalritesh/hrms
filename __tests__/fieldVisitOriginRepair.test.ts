// @ts-nocheck -- source-contract test; no database runtime is required.
import fs from "fs";
import path from "path";

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");

describe("field visit origin repair", () => {
  it("adds the journey origin columns through the ordered migration chain", () => {
    const migration = read(
      "supabase/migrations/20260805000000_restore_field_visit_origin_columns.sql",
    );
    expect(migration).toContain("add column if not exists origin_lat");
    expect(migration).toContain("add column if not exists origin_lon");
    expect(migration).toContain("add column if not exists origin_name");
    expect(migration).toContain("notify pgrst, 'reload schema'");
    expect(
      Number(JSON.parse(read("release.config.json")).requiredBackendSchemaVersion),
    ).toBeGreaterThanOrEqual(20260805000000);
  });

  it("does not label the Android native shell as a browser PWA", () => {
    const screen = read("screens/FieldVisitScreen.tsx");
    const journey = read("components/ActiveJourneyCard.web.tsx");
    const bridge = read("services/nativeBridge/client.ts");
    expect(screen).toContain(
      'Platform.OS === "web" && !nativeBridge.isAvailable()',
    );
    expect(journey).toContain("loadGoogleMaps()");
    expect(journey).toContain("maps.DirectionsService()");
    expect(journey).toContain("Android background arrival tracking is connected.");
    expect(journey).toContain("maps.google.com/maps?q=");
    expect(bridge).toContain("BOP-HRMS-Android\\/1");
  });
});
