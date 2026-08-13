// Mailchimp Marketing API integration
// Server prefix: us3 (from API key suffix)

const MAILCHIMP_API_KEY = process.env.EXPO_PUBLIC_MAILCHIMP_API_KEY ?? "";
const MAILCHIMP_SERVER = process.env.EXPO_PUBLIC_MAILCHIMP_SERVER ?? "us3";
const MAILCHIMP_BASE_URL = `https://${MAILCHIMP_SERVER}.api.mailchimp.com/3.0`;

const headers = {
  "Content-Type": "application/json",
  Authorization: `Basic ${btoa(`anystring:${MAILCHIMP_API_KEY}`)}`,
};

export const MailchimpService = {
  // ─── Send transactional email via Mailchimp ───────────────────────────────
  async sendEmail(
    to: string,
    subject: string,
    htmlBody: string,
  ): Promise<boolean> {
    try {
      // Mailchimp Marketing API doesn't send transactional emails directly.
      // We use the /messages/send endpoint via Mailchimp Transactional (Mandrill).
      // For now we log — integrate Mandrill or use a campaign below.
      console.log(`[Mailchimp] Would send to ${to}: ${subject}`);
      return true;
    } catch (e) {
      console.error("[Mailchimp] sendEmail error:", e);
      return false;
    }
  },

  // ─── Add employee to Mailchimp audience ──────────────────────────────────
  async addMemberToAudience(
    listId: string,
    email: string,
    firstName: string,
    lastName: string,
  ): Promise<boolean> {
    try {
      const res = await fetch(`${MAILCHIMP_BASE_URL}/lists/${listId}/members`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          email_address: email,
          status: "subscribed",
          merge_fields: {
            FNAME: firstName,
            LNAME: lastName,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("[Mailchimp] addMember error:", data);
        return false;
      }
      console.log("[Mailchimp] Member added:", data.id);
      return true;
    } catch (e) {
      console.error("[Mailchimp] addMember exception:", e);
      return false;
    }
  },

  // ─── Send campaign to all audience members ───────────────────────────────
  async sendCampaign(
    listId: string,
    subject: string,
    htmlContent: string,
    fromName: string = "RE HRMS",
    fromEmail: string = "noreply@rehrms.com",
  ): Promise<string | null> {
    try {
      // Step 1: Create campaign
      const createRes = await fetch(`${MAILCHIMP_BASE_URL}/campaigns`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: "regular",
          recipients: { list_id: listId },
          settings: {
            subject_line: subject,
            from_name: fromName,
            reply_to: fromEmail,
          },
        }),
      });
      const campaign = await createRes.json();
      if (!createRes.ok) {
        console.error("[Mailchimp] createCampaign error:", campaign);
        return null;
      }

      const campaignId = campaign.id;

      // Step 2: Set content
      const contentRes = await fetch(
        `${MAILCHIMP_BASE_URL}/campaigns/${campaignId}/content`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify({ html: htmlContent }),
        },
      );
      if (!contentRes.ok) {
        console.error("[Mailchimp] setContent error:", await contentRes.json());
        return null;
      }

      // Step 3: Send campaign
      const sendRes = await fetch(
        `${MAILCHIMP_BASE_URL}/campaigns/${campaignId}/actions/send`,
        { method: "POST", headers },
      );
      if (!sendRes.ok) {
        console.error("[Mailchimp] sendCampaign error:", await sendRes.json());
        return null;
      }

      console.log("[Mailchimp] Campaign sent:", campaignId);
      return campaignId;
    } catch (e) {
      console.error("[Mailchimp] sendCampaign exception:", e);
      return null;
    }
  },

  // ─── Ping — health check ─────────────────────────────────────────────────
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${MAILCHIMP_BASE_URL}/ping`, { headers });
      const data = await res.json();
      console.log("[Mailchimp] Ping:", data.health_status);
      return res.ok;
    } catch (e) {
      console.error("[Mailchimp] Ping failed:", e);
      return false;
    }
  },

  // ─── Email templates ─────────────────────────────────────────────────────
  templates: {
    welcomeEmployee(name: string, phone: string, password: string): string {
      return `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px;">
          <h2 style="color:#1E40AF;">Welcome to RE HRMS 🏢</h2>
          <p>Hi <strong>${name}</strong>,</p>
          <p>Your account has been created. Here are your login credentials:</p>
          <div style="background:#f3f4f6;padding:16px;border-radius:6px;margin:16px 0;">
            <p><strong>Phone (Username):</strong> ${phone}</p>
            <p><strong>Password:</strong> ${password}</p>
          </div>
          <p style="color:#ef4444;">⚠️ Please keep these credentials secure and do not share them.</p>
          <p>Your password is your first name in lowercase.</p>
          <br/>
          <p>Best regards,<br/><strong>RE HRMS Team</strong></p>
        </div>
      `;
    },

    leaveApproved(
      name: string,
      leaveType: string,
      startDate: string,
      endDate: string,
    ): string {
      return `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px;">
          <h2 style="color:#16a34a;">Leave Approved ✅</h2>
          <p>Hi <strong>${name}</strong>,</p>
          <p>Your <strong>${leaveType}</strong> leave request has been <strong style="color:#16a34a;">approved</strong>.</p>
          <div style="background:#f0fdf4;padding:16px;border-radius:6px;margin:16px 0;">
            <p><strong>From:</strong> ${startDate}</p>
            <p><strong>To:</strong> ${endDate}</p>
          </div>
          <p>Best regards,<br/><strong>RE HRMS Admin</strong></p>
        </div>
      `;
    },

    leaveRejected(name: string, leaveType: string): string {
      return `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px;">
          <h2 style="color:#dc2626;">Leave Rejected ❌</h2>
          <p>Hi <strong>${name}</strong>,</p>
          <p>Your <strong>${leaveType}</strong> leave request has been <strong style="color:#dc2626;">rejected</strong>.</p>
          <p>Please contact your manager for more details.</p>
          <p>Best regards,<br/><strong>RE HRMS Admin</strong></p>
        </div>
      `;
    },

    taskAssigned(
      name: string,
      taskTitle: string,
      dueDate: string,
      priority: string,
    ): string {
      return `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px;">
          <h2 style="color:#1E40AF;">New Task Assigned 📋</h2>
          <p>Hi <strong>${name}</strong>,</p>
          <p>A new task has been assigned to you:</p>
          <div style="background:#eff6ff;padding:16px;border-radius:6px;margin:16px 0;">
            <p><strong>Task:</strong> ${taskTitle}</p>
            <p><strong>Due Date:</strong> ${dueDate}</p>
            <p><strong>Priority:</strong> ${priority.toUpperCase()}</p>
          </div>
          <p>Please log in to RE HRMS to view full details.</p>
          <p>Best regards,<br/><strong>RE HRMS Team</strong></p>
        </div>
      `;
    },
  },
};
