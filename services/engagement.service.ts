import { supabase } from "@/lib/supabase";

export interface Survey {
  id: string;
  title: string;
  description?: string;
  questions: SurveyQuestion[];
  target_role?: string;
  is_anonymous: boolean;
  status: "draft" | "active" | "closed";
  created_by?: string;
  starts_at?: string;
  ends_at?: string;
  created_at: string;
  _response_count?: number;
}

export interface SurveyQuestion {
  id: string;
  text: string;
  type: "rating" | "text" | "multiple_choice" | "yes_no";
  options?: string[];
  required: boolean;
}

export interface SurveyResponse {
  id: string;
  survey_id: string;
  user_id?: string;
  answers: Record<string, any>;
  submitted_at: string;
}

export interface Recognition {
  id: string;
  from_id: string;
  to_id: string;
  badge: "star" | "innovator" | "team_player" | "leader" | "customer_champion" | "above_beyond";
  message: string;
  is_public: boolean;
  created_at: string;
  from?: { name: string };
  to?: { name: string };
}

export const BADGE_CONFIG: Record<Recognition["badge"], { label: string; emoji: string; color: string }> = {
  star:              { label: "Star Performer",     emoji: "⭐", color: "#F59E0B" },
  innovator:         { label: "Innovator",          emoji: "💡", color: "#8B5CF6" },
  team_player:       { label: "Team Player",        emoji: "🤝", color: "#3B82F6" },
  leader:            { label: "Leader",             emoji: "🏆", color: "#10B981" },
  customer_champion: { label: "Customer Champion",  emoji: "🎯", color: "#EF4444" },
  above_beyond:      { label: "Above & Beyond",     emoji: "🚀", color: "#EC4899" },
};

export const EngagementService = {
  // Surveys
  async getSurveys(): Promise<Survey[]> {
    const { data } = await supabase
      .from("surveys")
      .select("*")
      .order("created_at", { ascending: false });
    return (data || []).map((s: any) => ({ ...s, questions: s.questions || [] }));
  },

  async saveSurvey(survey: Partial<Survey> & { created_by: string }) {
    const payload = { ...survey, questions: survey.questions || [] };
    if (survey.id) {
      return supabase.from("surveys").update(payload).eq("id", survey.id).select().single();
    }
    return supabase.from("surveys").insert(payload).select().single();
  },

  async updateSurveyStatus(surveyId: string, status: Survey["status"]) {
    return supabase.from("surveys").update({ status }).eq("id", surveyId);
  },

  async submitResponse(surveyId: string, userId: string | null, answers: Record<string, any>) {
    return supabase.from("survey_responses").insert({
      survey_id: surveyId,
      user_id: userId,
      answers,
      submitted_at: new Date().toISOString(),
    });
  },

  async getResponses(surveyId: string): Promise<SurveyResponse[]> {
    const { data } = await supabase
      .from("survey_responses")
      .select("*")
      .eq("survey_id", surveyId)
      .order("submitted_at", { ascending: false });
    return data || [];
  },

  async hasResponded(surveyId: string, userId: string): Promise<boolean> {
    const { count } = await supabase
      .from("survey_responses")
      .select("*", { count: "exact", head: true })
      .eq("survey_id", surveyId)
      .eq("user_id", userId);
    return (count || 0) > 0;
  },

  // Recognitions
  async getRecognitions(limit = 20): Promise<Recognition[]> {
    const { data } = await supabase
      .from("recognitions")
      .select("*, from:from_id(name), to:to_id(name)")
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .limit(limit);
    return data || [];
  },

  async getUserRecognitions(userId: string): Promise<Recognition[]> {
    const { data } = await supabase
      .from("recognitions")
      .select("*, from:from_id(name)")
      .eq("to_id", userId)
      .order("created_at", { ascending: false });
    return data || [];
  },

  async giveRecognition(fromId: string, toId: string, badge: Recognition["badge"], message: string) {
    return supabase.from("recognitions").insert({
      from_id: fromId,
      to_id: toId,
      badge,
      message,
      is_public: true,
    });
  },

  // Sentiment: simple polarity from survey text answers
  analyzeSentiment(text: string): "positive" | "neutral" | "negative" {
    const positive = ["great","good","excellent","happy","satisfied","love","amazing","helpful","best","fantastic"];
    const negative = ["bad","poor","terrible","unhappy","dissatisfied","hate","worst","awful","boring","stressful"];
    const lower = text.toLowerCase();
    const pos = positive.filter((w) => lower.includes(w)).length;
    const neg = negative.filter((w) => lower.includes(w)).length;
    if (pos > neg) return "positive";
    if (neg > pos) return "negative";
    return "neutral";
  },
};
