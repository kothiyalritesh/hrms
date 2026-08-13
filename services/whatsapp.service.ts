/**
 * WhatsApp provider credentials were previously embedded in the Expo bundle.
 * Direct client delivery is disabled until it is moved behind an authenticated
 * server function. Ticket creation/closure itself continues to work.
 */
async function serverOnlyWarning() {
  console.warn("WhatsApp delivery is disabled: configure a protected server function.");
}

export const WhatsAppService = {
  async sendTicketOpen(_phone: string, _userName: string, _category: string) {
    await serverOnlyWarning();
  },
  async sendTicketClosed(_phone: string, _userName: string, _category: string) {
    await serverOnlyWarning();
  },
  async broadcastTicketOpen(_recipients: { phone: string; name: string }[], _category: string) {
    await serverOnlyWarning();
  },
  async broadcastTicketClosed(_recipients: { phone: string; name: string }[], _category: string) {
    await serverOnlyWarning();
  },
};

