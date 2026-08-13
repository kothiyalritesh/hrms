import { getFunctionErrorMessage } from "@/utils/functionError";

describe("getFunctionErrorMessage", () => {
  it("extracts the useful Edge Function response message", async () => {
    const context = {
      clone: () => context,
      json: async () => ({ message: "Invalid or expired OTP." }),
    };
    await expect(
      getFunctionErrorMessage(
        { message: "Edge Function returned a non-2xx status code", context },
        "Verification failed.",
      ),
    ).resolves.toBe("Invalid or expired OTP.");
  });

  it("does not expose raw transport errors", async () => {
    await expect(
      getFunctionErrorMessage(
        { message: "Edge Function returned a non-2xx status code" },
        "Invalid or expired OTP.",
      ),
    ).resolves.toBe("Invalid or expired OTP.");
  });
});
