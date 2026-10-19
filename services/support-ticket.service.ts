import { supabase } from "@/lib/supabase";
import { WhatsAppService } from "@/services/whatsapp.service";

export type TicketCategory = "technical" | "hardware" | "hr" | "payroll" | "leave" | "other";
export type TicketPriority = "low" | "medium" | "high";
export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";

export interface SupportTicket {
  id: string;
  user_id: string;
  title: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  assigned_to?: string | null;
  resolution_notes?: string | null;
  created_at: string;
  updated_at: string;
  user_name?: string;
  user_phone?: string;
  assigned_name?: string;
}

/** Fetch all profiles with ADMIN, HR, or HRD roles that have a phone number */
async function getAdminHRRecipients(): Promise<{ phone: string; name: string }[]> {
  const { data } = await supabase
    .from("profiles")
    .select("name, phone")
    .in("role", ["SYSTEM_ADMIN", "ADMIN", "HR", "HRD"])
    .eq("is_active", true)
    .not("phone", "is", null);
  return (data ?? [])
    .filter((p: any) => p.phone)
    .map((p: any) => ({ phone: p.phone!, name: p.name }));
}

export const SupportTicketService = {
  async createTicket(data: {
    userId: string;
    title: string;
    description: string;
    category: TicketCategory;
    priority: TicketPriority;
  }) {
    const result = await supabase.from("support_tickets").insert({
      user_id: data.userId,
      title: data.title,
      description: data.description,
      category: data.category,
      priority: data.priority,
      status: "open",
    });

    if (!result.error) {
      // Fire-and-forget: notify all admins & HR with raiser's name. Not awaited,
      // so the submit button is released as soon as the ticket is saved.
      void (async () => {
        try {
          const { data: raiserProfile } = await supabase
            .from("profiles")
            .select("name")
            .eq("id", data.userId)
            .maybeSingle();
          const raiserName: string = (raiserProfile as any)?.name ?? "Unknown";
          const recipients = await getAdminHRRecipients();
          await Promise.allSettled(recipients.map((r) =>
            WhatsAppService.sendTicketOpen(r.phone, r.name, `${raiserName} - ${data.category}`)
          ));
        } catch {
          // Notification failures must never affect the saved ticket.
        }
      })();
    }

    return result;
  },

  async getMyTickets(userId: string) {
    return supabase
      .from("support_tickets")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
  },

  async getAllTickets() {
    return supabase
      .from("support_tickets")
      .select(`*, profiles!support_tickets_user_id_fkey(name, phone)`)
      .order("created_at", { ascending: false });
  },

  async updateTicketStatus(
    ticketId: string,
    status: TicketStatus,
    resolutionNotes?: string
  ) {
    const result = await supabase
      .from("support_tickets")
      .update({ status, resolution_notes: resolutionNotes ?? null, updated_at: new Date().toISOString() })
      .eq("id", ticketId);

    if (!result.error && (status === "resolved" || status === "closed")) {
      // Notify HR + the ticket raiser
      const { data: ticket } = await supabase
        .from("support_tickets")
        .select(`user_id, profiles!support_tickets_user_id_fkey(name, phone)`)
        .eq("id", ticketId)
        .single();

      const raiserPhone = (ticket as any)?.profiles?.phone;
      const raiserName = (ticket as any)?.profiles?.name;

      const { data: ticketCategory } = await supabase
        .from("support_tickets")
        .select("category")
        .eq("id", ticketId)
        .single();
      const category: string = (ticketCategory as any)?.category ?? "other";

      getAdminHRRecipients().then(async (hrRecipients) => {
        const recipients = [...hrRecipients];
        if (raiserPhone) recipients.push({ phone: raiserPhone, name: raiserName ?? "User" });
        // Deduplicate by phone
        const unique = Array.from(new Map(recipients.map((r) => [r.phone, r])).values());
        await WhatsAppService.broadcastTicketClosed(unique, category);
      });
    }

    return result;
  },
};
