jest.mock("@/lib/supabase", () => ({ supabase: {} }));

import { ActivityAnalysisService } from "@/services/activity-analysis.service";
import { calculateAverageConfidence } from "@/services/activity.service";

describe("activity logic", () => {
  it("preserves capitalization when detecting a company fallback", () => {
    expect(
      ActivityAnalysisService.extractEntities(
        "Discussion with Acme Realty about inventory",
        "Client office",
      ),
    ).toMatchObject({ hasCompanyName: true, companyName: "Acme Realty" });
  });

  it("returns zero confidence for an empty result", () => {
    expect(calculateAverageConfidence([])).toBe(0);
  });
});
