/**
 * SMS Service - TEMPLATE FOR FUTURE IMPLEMENTATION
 *
 * This service is a template for integrating SMS sending capabilities.
 * Currently, SMS notifications are NOT implemented in the application.
 *
 * To enable SMS sending, choose one of these providers:
 * 1. Twilio (https://www.twilio.com)
 * 2. AWS SNS (https://aws.amazon.com/sns/)
 * 3. Firebase Cloud Messaging (https://firebase.google.com/docs/cloud-messaging)
 * 4. MessageBird (https://www.messagebird.com)
 * 5. Nexmo/Vonage (https://www.vonage.com)
 */

/**
 * Example implementation using Twilio
 * Install: npm install twilio
 *
 * const twilio = require('twilio');
 * const accountSid = process.env.TWILIO_ACCOUNT_SID;
 * const authToken = process.env.TWILIO_AUTH_TOKEN;
 * const client = new twilio(accountSid, authToken);
 */

export const SMSService = {
  /**
   * Send OTP via SMS
   * @param phoneNumber - User's phone number (e.g., +1234567890)
   * @param otp - One-time password (usually 6 digits)
   * @returns Promise with SMS send status
   */
  async sendOTP(phoneNumber: string, otp: string): Promise<boolean> {
    try {
      // PLACEHOLDER - Not implemented yet
      console.warn(
        "⚠️  SMS OTP sending not implemented. Phone: " +
          phoneNumber +
          ", OTP: " +
          otp,
      );

      // Example Twilio implementation:
      /*
      const message = await client.messages.create({
        body: `Your HRMS verification code is: ${otp}. Do not share this with anyone.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phoneNumber,
      });

      return message.sid ? true : false;
      */

      return false;
    } catch (error) {
      console.error("❌ Failed to send SMS:", error);
      return false;
    }
  },

  /**
   * Send attendance notification via SMS
   * @param phoneNumber - Employee phone number
   * @param message - Notification message
   */
  async sendAttendanceNotification(
    phoneNumber: string,
    message: string,
  ): Promise<boolean> {
    try {
      console.warn(
        "⚠️  SMS attendance notification not implemented. Phone: " +
          phoneNumber,
      );

      // TODO: Implement SMS sending
      // await client.messages.create({
      //   body: message,
      //   from: process.env.TWILIO_PHONE_NUMBER,
      //   to: phoneNumber,
      // });

      return false;
    } catch (error) {
      console.error("❌ Failed to send attendance notification:", error);
      return false;
    }
  },

  /**
   * Send bulk SMS to multiple users
   * @param phoneNumbers - Array of phone numbers
   * @param message - Message to send
   */
  async sendBulkSMS(
    phoneNumbers: string[],
    message: string,
  ): Promise<{ successful: number; failed: number }> {
    const results = {
      successful: 0,
      failed: 0,
    };

    for (const phone of phoneNumbers) {
      const sent = await this.sendOTP(phone, message);
      if (sent) {
        results.successful++;
      } else {
        results.failed++;
      }
    }

    return results;
  },

  /**
   * Send leave approval notification via SMS
   * @param phoneNumber - Employee phone number
   * @param leaveType - Type of leave (sick, casual, etc.)
   * @param status - Approval status (approved/rejected)
   * @param approverName - Name of approver
   */
  async sendLeaveNotification(
    phoneNumber: string,
    leaveType: string,
    status: "approved" | "rejected",
    approverName: string,
  ): Promise<boolean> {
    const statusText = status === "approved" ? "Approved" : "Rejected";
    const message = `Your ${leaveType} leave has been ${statusText} by ${approverName}. Please check the HRMS app for details.`;

    return this.sendAttendanceNotification(phoneNumber, message);
  },
};

/**
 * SETUP INSTRUCTIONS FOR SMS INTEGRATION
 *
 * 1. Choose SMS Provider (recommend Twilio for ease of use)
 * 2. Install package: npm install twilio
 * 3. Set environment variables:
 *    - TWILIO_ACCOUNT_SID
 *    - TWILIO_AUTH_TOKEN
 *    - TWILIO_PHONE_NUMBER (your Twilio phone number)
 * 4. Replace placeholder code in this file with actual implementation
 * 5. Update any screens that need SMS notifications
 *
 * CURRENT STATUS: SMS features are NOT ACTIVE
 * All SMS methods are placeholders that log warnings instead of sending messages
 */
