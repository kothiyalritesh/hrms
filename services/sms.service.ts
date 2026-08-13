export const SMSService = {
  async sendOTP(_phone: string, _otp: string): Promise<boolean> {
    console.error(
      "Direct client SMS is disabled. Use the protected otp-auth function.",
    );
    return false;
  },

  async sendTransactional(
    _phone: string,
    _message: string,
    _templateId: string,
  ): Promise<boolean> {
    console.error("Transactional SMS requires a protected server function.");
    return false;
  },
};
