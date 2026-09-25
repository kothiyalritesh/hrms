import NetInfo from "@react-native-community/netinfo";

export type RequestReason =
  | "APP_BOOTSTRAP"
  | "APP_FOREGROUND"
  | "TAB_FOCUS"
  | "MANUAL_REFRESH"
  | "REALTIME_EVENT"
  | "OUTBOX_DRAIN"
  | "CHECKIN_WRITE"
  | "CHECKOUT_WRITE"
  | "AUDIT_LOG"
  | "SCHEDULED_POLL"
  | "BACKGROUND_SYNC"
  | (string & {});

export interface RequestOptions {
  resource: string;
  reason?: RequestReason;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  callerSignal?: AbortSignal;
  dedupKey?: string;
  skipIfOffline?: boolean;
}

export interface NetworkErrorClassification {
  isRetryable: boolean;
  isOffline: boolean;
  isTimeout: boolean;
  isRateLimit: boolean;
  isAuthError: boolean;
  isValidationError: boolean;
  statusCode?: number;
  message: string;
}

export interface NetworkMetrics {
  DB_REQUESTS_TOTAL: number;
  DB_REQUESTS_DEDUPED: number;
  DB_REQUESTS_CACHE_HIT: number;
  DB_REQUESTS_SKIPPED: number;
  DB_REQUESTS_BY_REASON: Record<string, number>;
  DB_REQUESTS_BY_RESOURCE: Record<string, number>;
  latencies: number[];
  avgLatency: number;
  p95Latency: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 8_000;

class NetworkManagerClass {
  private inFlightRequests = new Map<string, Promise<any>>();

  private metrics: NetworkMetrics = {
    DB_REQUESTS_TOTAL: 0,
    DB_REQUESTS_DEDUPED: 0,
    DB_REQUESTS_CACHE_HIT: 0,
    DB_REQUESTS_SKIPPED: 0,
    DB_REQUESTS_BY_REASON: {},
    DB_REQUESTS_BY_RESOURCE: {},
    latencies: [],
    avgLatency: 0,
    p95Latency: 0,
  };

  /**
   * Check if device is confirmed connected to internet.
   */
  public async isConnected(): Promise<boolean> {
    try {
      const state = await NetInfo.fetch();
      return state.isConnected !== false && state.isInternetReachable !== false;
    } catch {
      return true; // Fallback to optimistic
    }
  }

  /**
   * Classify any error into standard categories to prevent non-retryable requests
   * from entering loops.
   */
  public classifyError(error: any): NetworkErrorClassification {
    const message = error?.message || String(error || "Unknown network error");
    const status =
      error?.status ||
      error?.statusCode ||
      (typeof error?.code === "number" ? error.code : undefined) ||
      (error?.code === "PGRST301" ? 401 : undefined);

    const isOffline =
      message.includes("Network request failed") ||
      message.includes("Failed to fetch") ||
      message.includes("network") ||
      message.includes("offline");

    const isTimeout =
      message.includes("timeout") ||
      message.includes("timed out") ||
      error?.name === "AbortError" ||
      error?.code === "ETIMEDOUT" ||
      error?.code === "ECONNABORTED";

    const isRateLimit = status === 429 || message.includes("rate limit") || message.includes("Too Many Requests");
    const isAuthError = status === 401 || status === 403 || message.includes("JWT") || message.includes("unauthorized");
    const isValidationError =
      (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) ||
      message.includes("invalid input") ||
      message.includes("violates") ||
      error?.code === "23505"; // Unique violation

    const isRetryable =
      !isValidationError &&
      !isAuthError &&
      (isOffline || isTimeout || isRateLimit || (status !== undefined && status >= 500) || status === 408);

    return {
      isRetryable,
      isOffline,
      isTimeout,
      isRateLimit,
      isAuthError,
      isValidationError,
      statusCode: typeof status === "number" ? status : undefined,
      message,
    };
  }

  /**
   * Execute an operation with fresh AbortControllers per attempt,
   * exponential backoff, in-flight deduplication, and metrics logging.
   */
  public async execute<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    options: RequestOptions
  ): Promise<T> {
    const {
      resource,
      reason = "UNKNOWN",
      timeoutMs = DEFAULT_TIMEOUT_MS,
      maxRetries = DEFAULT_MAX_RETRIES,
      baseDelayMs = DEFAULT_BASE_DELAY_MS,
      maxDelayMs = DEFAULT_MAX_DELAY_MS,
      callerSignal,
      dedupKey,
      skipIfOffline = false,
    } = options;

    // Track request by reason & resource
    this.recordRequestStart(resource, reason);

    // If caller already aborted, cancel immediately
    if (callerSignal?.aborted) {
      this.recordRequestSkipped(resource, reason);
      throw new Error(`[NetworkManager] Operation aborted by caller before start (${resource})`);
    }

    // Check deduplication
    if (dedupKey && this.inFlightRequests.has(dedupKey)) {
      this.recordRequestDeduped(resource, reason);
      if (__DEV__) {
        console.log(`[DB] ${resource} reason=${reason} action=DEDUPED key=${dedupKey}`);
      }
      return this.inFlightRequests.get(dedupKey) as Promise<T>;
    }

    // Check confirmed offline guard
    if (skipIfOffline) {
      const online = await this.isConnected();
      if (!online) {
        this.recordRequestSkipped(resource, reason);
        if (__DEV__) {
          console.log(`[DB] ${resource} reason=${reason} action=SKIPPED_OFFLINE`);
        }
        throw new Error(`[NetworkManager] Device confirmed offline. Read request skipped (${resource})`);
      }
    }

    const executionPromise = this.executeWithRetry(
      operation,
      resource,
      reason,
      timeoutMs,
      maxRetries,
      baseDelayMs,
      maxDelayMs,
      callerSignal
    );

    if (dedupKey) {
      this.inFlightRequests.set(dedupKey, executionPromise);
      executionPromise.finally(() => {
        this.inFlightRequests.delete(dedupKey);
      });
    }

    return executionPromise;
  }

  private async executeWithRetry<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    resource: string,
    reason: string,
    timeoutMs: number,
    maxRetries: number,
    baseDelayMs: number,
    maxDelayMs: number,
    callerSignal?: AbortSignal
  ): Promise<T> {
    const startTime = Date.now();
    let attempt = 0;

    while (attempt <= maxRetries) {
      if (callerSignal?.aborted) {
        throw new Error(`[NetworkManager] Operation canceled by caller during retry sequence (${resource})`);
      }

      // Create a FRESH AbortController for this attempt
      const attemptController = new AbortController();
      let timeoutId: any = null;

      // Handle caller abortion during this attempt
      const onCallerAbort = () => {
        attemptController.abort();
      };
      if (callerSignal) {
        callerSignal.addEventListener("abort", onCallerAbort, { once: true });
      }

      // Arm timeout for this attempt
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          attemptController.abort();
          reject(new Error(`[NetworkManager] Request timed out after ${timeoutMs}ms (attempt ${attempt + 1}/${maxRetries + 1})`));
        }, timeoutMs);
      });

      try {
        if (__DEV__) {
          console.log(`[DB] ${resource} reason=${reason} attempt=${attempt + 1} action=FETCH`);
        }

        const result = await Promise.race([
          operation(attemptController.signal),
          timeoutPromise,
        ]);

        clearTimeout(timeoutId);
        if (callerSignal) {
          callerSignal.removeEventListener("abort", onCallerAbort);
        }

        // Record latency
        const elapsed = Date.now() - startTime;
        this.recordLatency(elapsed);

        return result;
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (callerSignal) {
          callerSignal.removeEventListener("abort", onCallerAbort);
        }

        if (callerSignal?.aborted) {
          throw new Error(`[NetworkManager] Operation canceled by caller (${resource})`);
        }

        const classification = this.classifyError(err);

        // Non-retryable error -> fail fast
        if (!classification.isRetryable || attempt >= maxRetries) {
          if (__DEV__) {
            console.warn(
              `[DB] ${resource} reason=${reason} attempt=${attempt + 1} FAILED (retryable=${classification.isRetryable}): ${classification.message}`
            );
          }
          throw err;
        }

        // Calculate exponential backoff with jitter
        const jitter = Math.random() * 200;
        const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt)) + jitter;

        if (__DEV__) {
          console.log(
            `[DB] ${resource} reason=${reason} attempt=${attempt + 1} failed, retrying in ${Math.round(delay)}ms...`
          );
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
        attempt++;
      }
    }

    throw new Error(`[NetworkManager] Max retries (${maxRetries}) exceeded for ${resource}`);
  }

  // --- Metrics Recording ---

  private recordRequestStart(resource: string, reason: string) {
    this.metrics.DB_REQUESTS_TOTAL++;
    this.metrics.DB_REQUESTS_BY_REASON[reason] = (this.metrics.DB_REQUESTS_BY_REASON[reason] || 0) + 1;
    this.metrics.DB_REQUESTS_BY_RESOURCE[resource] = (this.metrics.DB_REQUESTS_BY_RESOURCE[resource] || 0) + 1;
  }

  public recordCacheHit(resource: string, reason: string = "CACHE_HIT") {
    this.metrics.DB_REQUESTS_CACHE_HIT++;
    if (__DEV__) {
      console.log(`[DB] ${resource} reason=${reason} action=CACHE_HIT`);
    }
  }

  private recordRequestDeduped(resource: string, reason: string) {
    this.metrics.DB_REQUESTS_DEDUPED++;
  }

  private recordRequestSkipped(resource: string, reason: string) {
    this.metrics.DB_REQUESTS_SKIPPED++;
  }

  private recordLatency(ms: number) {
    this.metrics.latencies.push(ms);
    if (this.metrics.latencies.length > 100) {
      this.metrics.latencies.shift();
    }
    const sum = this.metrics.latencies.reduce((a, b) => a + b, 0);
    this.metrics.avgLatency = Math.round(sum / this.metrics.latencies.length);

    const sorted = [...this.metrics.latencies].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    this.metrics.p95Latency = sorted[p95Index] || this.metrics.avgLatency;
  }

  public getMetrics(): Readonly<NetworkMetrics> {
    return { ...this.metrics };
  }

  public resetMetrics(): void {
    this.metrics = {
      DB_REQUESTS_TOTAL: 0,
      DB_REQUESTS_DEDUPED: 0,
      DB_REQUESTS_CACHE_HIT: 0,
      DB_REQUESTS_SKIPPED: 0,
      DB_REQUESTS_BY_REASON: {},
      DB_REQUESTS_BY_RESOURCE: {},
      latencies: [],
      avgLatency: 0,
      p95Latency: 0,
    };
  }
}

export const NetworkManager = new NetworkManagerClass();

