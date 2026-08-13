const TECHNICAL_FUNCTION_ERRORS = [
  /edge function returned/i,
  /functionshttperror/i,
  /non-2xx/i,
  /failed to fetch/i,
];

function safeMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const message = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!message || message.length > 180) return null;
  if (TECHNICAL_FUNCTION_ERRORS.some((pattern) => pattern.test(message))) {
    return null;
  }
  return message;
}

/** Extracts a user-safe message from a Supabase FunctionsHttpError response. */
export async function getFunctionErrorMessage(
  error: unknown,
  fallback: string,
): Promise<string> {
  const candidate = error as {
    message?: unknown;
    context?: {
      clone?: () => any;
      json?: () => Promise<any>;
      text?: () => Promise<string>;
    };
  } | null;

  const context = candidate?.context;
  if (context) {
    try {
      const response = context.clone?.() ?? context;
      const body = await response.json?.();
      const parsed = safeMessage(body?.message ?? body?.error ?? body?.detail);
      if (parsed) return parsed;
    } catch {
      try {
        const response = context.clone?.() ?? context;
        const parsed = safeMessage(await response.text?.());
        if (parsed) return parsed;
      } catch {
        // A response body is optional; use the controlled fallback below.
      }
    }
  }

  return safeMessage(candidate?.message) ?? fallback;
}
