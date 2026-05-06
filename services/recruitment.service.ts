import { supabase } from "@/lib/supabase";

export interface JobPosting {
  id: string;
  title: string;
  department_id?: string;
  designation_id?: string;
  description?: string;
  requirements?: string;
  location?: string;
  employment_type: "full_time" | "part_time" | "contract" | "internship";
  min_experience: number;
  max_experience?: number;
  min_salary?: number;
  max_salary?: number;
  openings: number;
  status: "draft" | "open" | "closed" | "on_hold";
  posted_by?: string;
  closes_at?: string;
  department?: { name: string };
  designation?: { name: string };
  _candidate_count?: number;
}

export interface Candidate {
  id: string;
  job_id: string;
  name: string;
  email?: string;
  phone?: string;
  resume_url?: string;
  experience_years: number;
  current_company?: string;
  current_ctc?: number;
  expected_ctc?: number;
  source: "direct" | "referral" | "portal" | "agency" | "linkedin";
  stage: "applied" | "screened" | "interview" | "offer" | "hired" | "rejected";
  rejection_reason?: string;
  notes?: string;
  job?: { title: string };
}

export interface Interview {
  id: string;
  candidate_id: string;
  job_id: string;
  interviewer_id?: string;
  round: number;
  interview_type: "in_person" | "video" | "phone" | "technical" | "hr";
  scheduled_at: string;
  duration_mins: number;
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  feedback?: string;
  rating?: number;
  recommendation?: "strong_yes" | "yes" | "maybe" | "no" | "strong_no";
  interviewer?: { name: string };
  candidate?: { name: string };
}

export const PIPELINE_STAGES: Candidate["stage"][] = [
  "applied", "screened", "interview", "offer", "hired", "rejected",
];

export const RecruitmentService = {
  // Jobs
  async getJobs(): Promise<JobPosting[]> {
    const { data } = await supabase
      .from("job_postings")
      .select("*, department:department_id(name), designation:designation_id(name)")
      .order("created_at", { ascending: false });
    return data || [];
  },

  async saveJob(job: Partial<JobPosting> & { posted_by: string }) {
    if (job.id) {
      return supabase.from("job_postings").update(job).eq("id", job.id).select().single();
    }
    return supabase.from("job_postings").insert({ ...job, posted_at: new Date().toISOString() }).select().single();
  },

  async updateJobStatus(jobId: string, status: JobPosting["status"]) {
    return supabase.from("job_postings").update({ status }).eq("id", jobId);
  },

  // Candidates
  async getCandidates(jobId?: string): Promise<Candidate[]> {
    let q = supabase
      .from("candidates")
      .select("*, job:job_id(title)")
      .order("created_at", { ascending: false });
    if (jobId) q = q.eq("job_id", jobId);
    const { data } = await q;
    return data || [];
  },

  async saveCandidate(candidate: Partial<Candidate>) {
    if (candidate.id) {
      return supabase.from("candidates")
        .update({ ...candidate, updated_at: new Date().toISOString() })
        .eq("id", candidate.id).select().single();
    }
    return supabase.from("candidates").insert(candidate).select().single();
  },

  async moveStage(candidateId: string, stage: Candidate["stage"], rejectionReason?: string) {
    return supabase.from("candidates").update({
      stage,
      rejection_reason: rejectionReason || null,
      updated_at: new Date().toISOString(),
    }).eq("id", candidateId);
  },

  // Interviews
  async getInterviews(candidateId: string): Promise<Interview[]> {
    const { data } = await supabase
      .from("interviews")
      .select("*, interviewer:interviewer_id(name), candidate:candidate_id(name)")
      .eq("candidate_id", candidateId)
      .order("scheduled_at");
    return data || [];
  },

  async scheduleInterview(interview: Omit<Interview, "id">) {
    return supabase.from("interviews").insert(interview).select().single();
  },

  async submitInterviewFeedback(interviewId: string, feedback: string, rating: number, recommendation: Interview["recommendation"]) {
    return supabase.from("interviews").update({
      feedback, rating, recommendation, status: "completed",
    }).eq("id", interviewId);
  },

  // Pipeline counts
  async getPipelineCounts(jobId: string): Promise<Record<string, number>> {
    const { data } = await supabase
      .from("candidates")
      .select("stage")
      .eq("job_id", jobId);
    const counts: Record<string, number> = {};
    PIPELINE_STAGES.forEach((s) => { counts[s] = 0; });
    (data || []).forEach((c: any) => { counts[c.stage] = (counts[c.stage] || 0) + 1; });
    return counts;
  },
};
