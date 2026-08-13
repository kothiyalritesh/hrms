export interface ActivityLog {
  id?: string;
  user_id: string;
  locationType: "office" | "site" | "meeting" | "others";
  locationName: string;
  notes: string;
  destination?: string;
  gps_coordinates: {
    latitude: number;
    longitude: number;
  } | null;
  timestamp: string;
  created_at?: string;
  meetingDetails?: Record<string, any>;
}

export interface ActivityAnalysis {
  activity_type:
    | "SITE_VISIT"
    | "CLIENT_MEETING"
    | "CHANNEL_PARTNER_MEETING"
    | "INTERNAL_MEETING"
    | "TRAVEL"
    | "OFFICE_WORK"
    | "OTHER";
  confidence_score: number;
  client_name: string;
  company_name: string;
  meeting_purpose: string;
  location_type_confirmed: "office" | "site" | "client" | "partner" | "other";
  is_billable_activity: boolean;
  summary: string;
  flag?: "LOW_QUALITY_ENTRY";
}

export const ActivityAnalysisService = {
  /**
   * Analyzes an employee activity log and classifies it into business categories
   */
  analyzeActivity(activity: ActivityLog): ActivityAnalysis {
    const { locationType, locationName, notes, destination } = activity;

    // Initialize result
    let result: ActivityAnalysis = {
      activity_type: "OTHER",
      confidence_score: 50,
      client_name: "",
      company_name: "",
      meeting_purpose: "",
      location_type_confirmed: "other",
      is_billable_activity: false,
      summary: notes || "Activity logged",
    };

    // Extract entities from notes and locationName
    const extractedEntities = this.extractEntities(notes, locationName);

    // Apply classification rules
    const classification = this.classifyActivity(
      locationType,
      notes,
      destination,
      extractedEntities,
    );

    // Update result with classification
    result = { ...result, ...classification };

    // Detect low quality entries
    const qualityCheck = this.detectLowQualityEntry(notes, locationName);
    if (qualityCheck.isLowQuality) {
      result.flag = "LOW_QUALITY_ENTRY";
      result.confidence_score = Math.max(0, result.confidence_score - 30);
    }

    return result;
  },

  /**
   * Extract key entities from notes and location
   */
  extractEntities(
    notes: string,
    locationName: string,
  ): {
    clientName: string;
    companyName: string;
    hasCompanyName: boolean;
  } {
    const originalText = `${notes} ${locationName}`.trim();
    const text = originalText.toLowerCase();

    // Common company indicators
    const companyIndicators = [
      "ltd",
      "pvt",
      "private",
      "limited",
      "corp",
      "inc",
      "llc",
      "group",
      "developers",
      "builders",
      "construction",
    ];

    let clientName = "";
    let companyName = "";
    let hasCompanyName = false;

    // Try to extract company names (words followed by company indicators)
    const words = text.split(/\s+/);
    const originalWords = originalText.split(/\s+/);
    for (let i = 0; i < words.length - 1; i++) {
      const currentWord = originalWords[i];
      const nextWord = originalWords[i + 1];

      if (companyIndicators.some((indicator) => words[i + 1].includes(indicator))) {
        companyName = `${currentWord} ${nextWord}`
          .replace(/[^a-zA-Z\s]/g, "")
          .trim();
        hasCompanyName = true;
        break;
      }
    }

    // If no company indicator found, look for capitalized words that might be company names
    if (!hasCompanyName) {
      const properNameRuns: string[][] = [];
      let currentRun: string[] = [];
      originalWords.forEach((rawWord, index) => {
        const word = rawWord.replace(/[^a-zA-Z]/g, "");
        const isProperName =
          word.length > 2 &&
          word[0] === word[0].toUpperCase() &&
          word.slice(1) !== word.slice(1).toUpperCase();
        if (isProperName && !(index === 0 && originalWords[1]?.[0] === originalWords[1]?.[0]?.toLowerCase())) {
          currentRun.push(word);
        } else if (currentRun.length) {
          properNameRuns.push(currentRun);
          currentRun = [];
        }
      });
      if (currentRun.length) properNameRuns.push(currentRun);
      properNameRuns.sort((a, b) => b.length - a.length);

      if (properNameRuns.length > 0) {
        companyName = properNameRuns[0].slice(0, 3).join(" ");
        hasCompanyName = true;
      }
    }

    return {
      clientName,
      companyName,
      hasCompanyName,
    };
  },

  /**
   * Classify activity based on rules
   */
  classifyActivity(
    locationType: string,
    notes: string,
    destination: string | undefined,
    entities: {
      clientName: string;
      companyName: string;
      hasCompanyName: boolean;
    },
  ): Partial<ActivityAnalysis> {
    const text = `${notes} ${destination || ""}`.toLowerCase();

    // Rule 1: Location type priority
    if (locationType === "site") {
      return {
        activity_type: "SITE_VISIT",
        confidence_score: 90,
        location_type_confirmed: "site",
        is_billable_activity: true,
        meeting_purpose: "Site inspection/visit",
        summary: `Site visit to ${entities.companyName || "location"}`,
      };
    }

    // Rule 2: Keyword-based classification
    if (
      text.includes("site") ||
      text.includes("inspection") ||
      text.includes("project") ||
      text.includes("construction")
    ) {
      return {
        activity_type: "SITE_VISIT",
        confidence_score: 85,
        location_type_confirmed: "site",
        is_billable_activity: true,
        meeting_purpose: "Site inspection/visit",
        summary: `Site visit: ${notes.substring(0, 50)}`,
      };
    }

    if (
      text.includes("client") ||
      text.includes("demo") ||
      text.includes("presentation") ||
      entities.hasCompanyName
    ) {
      return {
        activity_type: "CLIENT_MEETING",
        confidence_score: 80,
        client_name: entities.clientName,
        company_name: entities.companyName,
        location_type_confirmed: "client",
        is_billable_activity: true,
        meeting_purpose: "Client meeting/discussion",
        summary: `Client meeting with ${entities.companyName || "client"}`,
      };
    }

    if (
      text.includes("broker") ||
      text.includes("channel partner") ||
      text.includes("cp") ||
      text.includes("dealer")
    ) {
      return {
        activity_type: "CHANNEL_PARTNER_MEETING",
        confidence_score: 85,
        company_name: entities.companyName,
        location_type_confirmed: "partner",
        is_billable_activity: true,
        meeting_purpose: "Channel partner engagement",
        summary: `Channel partner meeting with ${entities.companyName || "partner"}`,
      };
    }

    if (
      text.includes("team") ||
      text.includes("internal") ||
      text.includes("review") ||
      locationType === "meeting"
    ) {
      return {
        activity_type: "INTERNAL_MEETING",
        confidence_score: 75,
        location_type_confirmed: "office",
        is_billable_activity: false,
        meeting_purpose: "Internal team meeting",
        summary: `Internal meeting: ${notes.substring(0, 50)}`,
      };
    }

    if (destination && locationType === "others") {
      return {
        activity_type: "TRAVEL",
        confidence_score: 70,
        location_type_confirmed: "other",
        is_billable_activity: false,
        meeting_purpose: "Travel to destination",
        summary: `Travel to ${destination}`,
      };
    }

    if (locationType === "office") {
      return {
        activity_type: "OFFICE_WORK",
        confidence_score: 95,
        location_type_confirmed: "office",
        is_billable_activity: false,
        meeting_purpose: "Office work",
        summary: `Office work: ${notes.substring(0, 50)}`,
      };
    }

    // Default to OTHER
    return {
      activity_type: "OTHER",
      confidence_score: 50,
      location_type_confirmed: "other",
      is_billable_activity: false,
      summary: notes || "Unspecified activity",
    };
  },

  /**
   * Detect low quality entries that might indicate faking activity
   */
  detectLowQualityEntry(
    notes: string,
    locationName: string,
  ): { isLowQuality: boolean; reasons: string[] } {
    const reasons: string[] = [];
    const notesClean = notes.toLowerCase().trim();
    const locationClean = locationName.toLowerCase().trim();

    // 1. Notes too short
    if (notesClean.length < 10) {
      reasons.push("Notes too short");
    }

    // 2. Notes are a single generic word
    const genericSingleWords = [
      "meeting", "work", "visit", "activity", "done",
      "completed", "ok", "fine", "office", "site", "travel",
    ];
    if (genericSingleWords.includes(notesClean)) {
      reasons.push("Generic single-word notes");
    }

    // 3. Notes same as location name (copy-paste)
    if (notesClean === locationClean && notesClean.length > 0) {
      reasons.push("Notes identical to location name");
    }

    // 4. No meaningful detail — fewer than 4 words in notes
    const wordCount = notesClean.split(/\s+/).filter(Boolean).length;
    if (wordCount < 4) {
      reasons.push("Insufficient detail in notes");
    }

    // 5. No company/person indicator anywhere in notes or location
    const hasBusinessIndicator = [
      "ltd", "pvt", "private", "limited", "corp", "inc",
      "group", "developers", "builders", "construction",
      "client", "customer", "partner", "broker", "dealer",
      "mr", "mrs", "ms", "dr",
    ].some((kw) => notesClean.includes(kw) || locationClean.includes(kw));

    if (!hasBusinessIndicator && wordCount < 6) {
      reasons.push("No company name or contact mentioned");
    }

    return {
      isLowQuality: reasons.length > 0,
      reasons,
    };
  },

  /**
   * Batch analyze multiple activities
   */
  analyzeActivities(activities: ActivityLog[]): ActivityAnalysis[] {
    return activities.map((activity) => this.analyzeActivity(activity));
  },

  /**
   * Get activity analytics for admin dashboard
   */
  async getActivityAnalytics(
    userId?: string,
    dateRange?: { start: string; end: string },
  ) {
    // This would query the activity_logs table
    // For now, return mock data structure
    return {
      totalActivities: 0,
      billableHours: 0,
      activityBreakdown: {
        SITE_VISIT: 0,
        CLIENT_MEETING: 0,
        CHANNEL_PARTNER_MEETING: 0,
        INTERNAL_MEETING: 0,
        TRAVEL: 0,
        OFFICE_WORK: 0,
        OTHER: 0,
      },
      lowQualityEntries: 0,
      topClients: [],
      productivityScore: 0,
    };
  },
};
