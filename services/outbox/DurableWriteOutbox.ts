import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { NetworkManager } from "@/lib/network/NetworkManager";

export type OutboxPriority = 1 | 2 | 3 | 4; // 1 = Highest (Attendance), 4 = Lowest (Telemetry)

export type OutboxOperationType =
  | "ATTENDANCE_CHECKIN"
  | "ATTENDANCE_CHECKOUT"
  | "AUDIT_LOG"
  | "FRAUD_EVIDENCE"
  | "NON_CRITICAL_TELEMETRY"
  | (string & {});

export type OutboxStatus = "PENDING" | "PROCESSING" | "SYNCED" | "FAILED" | "DEAD_LETTER";

export interface OutboxItem<T = any> {
  id: string;
  operationType: OutboxOperationType;
  priority: OutboxPriority;
  payload: T;
  idempotencyKey: string;
  status: OutboxStatus;
  attempts: number;
  maxRetries: number;
  createdAt: number;
  lastAttemptAt?: number;
  nextRetryAt?: number;
  lastError?: string;
  syncedAt?: number;
}

export type OutboxHandler<T = any> = (item: OutboxItem<T>) => Promise<any>;

const STORAGE_KEY_OUTBOX = "@hrms_durable_outbox_entries_v1";
const STORAGE_KEY_DEAD_LETTER = "@hrms_durable_outbox_dead_letter_v1";
const MAX_QUEUE_SIZE = 500;
const MAX_PAYLOAD_BYTES = 64 * 1024; // 64 KB
const MAX_RETRIES_DEFAULT = 10;
const MAX_OUTBOX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours

// Backoff schedule in milliseconds for attempts 1..10
const RETRY_BACKOFF_SCHEDULE_MS = [
  5_000,       // attempt 1: 5s
  15_000,      // attempt 2: 15s
  45_000,      // attempt 3: 45s
  120_000,     // attempt 4: 2m
  300_000,     // attempt 5: 5m
  900_000,     // attempt 6: 15m
  1_800_000,   // attempt 7: 30m
  3_600_000,   // attempt 8: 1h
  7_200_000,   // attempt 9: 2h
  14_400_000,  // attempt 10: 4h
];

class DurableWriteOutboxClass {
  private handlers = new Map<OutboxOperationType, OutboxHandler>();
  private isDraining = false;
  private memoryQueue: OutboxItem[] | null = null;

  /**
   * Register a processor for a specific operation type.
   */
  public registerHandler(operationType: OutboxOperationType, handler: OutboxHandler): void {
    this.handlers.set(operationType, handler);
  }

  /**
   * Determine priority based on operation type.
   */
  public getPriorityForType(type: OutboxOperationType): OutboxPriority {
    switch (type) {
      case "ATTENDANCE_CHECKIN":
      case "ATTENDANCE_CHECKOUT":
        return 1;
      case "AUDIT_LOG":
        return 2;
      case "FRAUD_EVIDENCE":
        return 3;
      default:
        return 4;
    }
  }

  /**
   * Load queue from disk into memory.
   */
  private async loadQueue(): Promise<OutboxItem[]> {
    if (this.memoryQueue !== null) {
      return this.memoryQueue;
    }
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY_OUTBOX);
      if (!raw) {
        this.memoryQueue = [];
        return this.memoryQueue;
      }
      const parsed = JSON.parse(raw);
      this.memoryQueue = Array.isArray(parsed) ? parsed : [];
      return this.memoryQueue;
    } catch (e) {
      console.warn("[DurableWriteOutbox] Error loading outbox from storage, resetting", e);
      this.memoryQueue = [];
      return this.memoryQueue;
    }
  }

  /**
   * Persist current memory queue to disk.
   */
  private async persistQueue(): Promise<void> {
    if (!this.memoryQueue) return;
    try {
      await AsyncStorage.setItem(STORAGE_KEY_OUTBOX, JSON.stringify(this.memoryQueue));
    } catch (e) {
      console.error("[DurableWriteOutbox] Failed to persist queue to disk", e);
    }
  }

  /**
   * Enqueue a new operation. Persisted to disk immediately before any network call.
   */
  public async enqueue<T>(
    operationType: OutboxOperationType,
    payload: T,
    options?: {
      idempotencyKey?: string;
      priority?: OutboxPriority;
      maxRetries?: number;
    }
  ): Promise<OutboxItem<T>> {
    const queue = await this.loadQueue();

    // Check payload size
    const payloadStr = JSON.stringify(payload);
    if (payloadStr.length > MAX_PAYLOAD_BYTES) {
      throw new Error(
        `[DurableWriteOutbox] Payload exceeds maximum size of 64KB (${payloadStr.length} bytes)`
      );
    }

    const idempotencyKey = options?.idempotencyKey || Crypto.randomUUID();

    // Deduplication check: if an item with this idempotency key already exists and is pending/processing, return it
    const existing = queue.find(
      (item) => item.idempotencyKey === idempotencyKey && (item.status === "PENDING" || item.status === "PROCESSING")
    );
    if (existing) {
      return existing as OutboxItem<T>;
    }

    const priority = options?.priority ?? this.getPriorityForType(operationType);
    const maxRetries = options?.maxRetries ?? MAX_RETRIES_DEFAULT;

    const newItem: OutboxItem<T> = {
      id: Crypto.randomUUID(),
      operationType,
      priority,
      payload,
      idempotencyKey,
      status: "PENDING",
      attempts: 0,
      maxRetries,
      createdAt: Date.now(),
    };

    queue.push(newItem);

    // Evict oldest lowest-priority synced items if over cap
    if (queue.length > MAX_QUEUE_SIZE) {
      const excess = queue.length - MAX_QUEUE_SIZE;
      let removed = 0;
      for (let i = 0; i < queue.length && removed < excess; i++) {
        if (queue[i].status === "SYNCED") {
          queue.splice(i, 1);
          i--;
          removed++;
        }
      }
    }

    await this.persistQueue();

    if (__DEV__) {
      console.log(
        `[DurableWriteOutbox] Enqueued ${operationType} (priority=${priority}, key=${idempotencyKey})`
      );
    }

    // Trigger asynchronous drain in background
    void this.drain();

    return newItem;
  }

  /**
   * Drain-loop concurrency lock.
   * Processes all pending items ordered by priority (1 before 4) and createdAt.
   * Re-checks for newly arrived items before releasing mutex lock.
   */
  public async drain(): Promise<void> {
    if (this.isDraining) {
      return;
    }

    // Check online connectivity before attempting drain
    const isOnline = await NetworkManager.isConnected();
    if (!isOnline) {
      if (__DEV__) {
        console.log("[DurableWriteOutbox] Offline. Drain postponed.");
      }
      return;
    }

    this.isDraining = true;

    try {
      let hasMore = true;

      while (hasMore) {
        const queue = await this.loadQueue();
        const now = Date.now();

        // Find candidate items: PENDING or FAILED whose nextRetryAt has arrived
        const candidates = queue
          .filter((item) => {
            if (item.status === "PENDING") return true;
            if (item.status === "FAILED") {
              return item.nextRetryAt ? item.nextRetryAt <= now : true;
            }
            return false;
          })
          .sort((a, b) => {
            if (a.priority !== b.priority) {
              return a.priority - b.priority; // 1 before 4
            }
            return a.createdAt - b.createdAt;
          });

        if (candidates.length === 0) {
          hasMore = false;
          break;
        }

        for (const item of candidates) {
          // Check age expiration -> move to DEAD_LETTER
          if (now - item.createdAt > MAX_OUTBOX_AGE_MS) {
            await this.moveToDeadLetter(item, "Expired (exceeded 48 hour outbox age)");
            continue;
          }

          const handler = this.handlers.get(item.operationType);
          if (!handler) {
            console.warn(
              `[DurableWriteOutbox] No handler registered for ${item.operationType}`
            );
            continue;
          }

          item.status = "PROCESSING";
          item.attempts += 1;
          item.lastAttemptAt = Date.now();
          await this.persistQueue();

          try {
            await handler(item);

            item.status = "SYNCED";
            item.syncedAt = Date.now();
            item.lastError = undefined;
            await this.persistQueue();

            if (__DEV__) {
              console.log(
                `[DurableWriteOutbox] Successfully synced ${item.operationType} (${item.idempotencyKey})`
              );
            }
          } catch (err: any) {
            const classification = NetworkManager.classifyError(err);
            item.lastError = err?.message || String(err);

            if (!classification.isRetryable || item.attempts >= item.maxRetries) {
              // Non-retryable validation error or max attempts reached -> Dead Letter
              await this.moveToDeadLetter(
                item,
                `Terminal error or max retries: ${item.lastError}`
              );
            } else {
              // Retryable error -> calculate exponential backoff
              const backoffMs =
                RETRY_BACKOFF_SCHEDULE_MS[Math.min(item.attempts - 1, RETRY_BACKOFF_SCHEDULE_MS.length - 1)];
              item.status = "FAILED";
              item.nextRetryAt = Date.now() + backoffMs;
              await this.persistQueue();

              if (__DEV__) {
                console.warn(
                  `[DurableWriteOutbox] Delivery failed for ${item.operationType} (attempt ${item.attempts}/${item.maxRetries}). Next retry in ${Math.round(backoffMs / 1000)}s: ${item.lastError}`
                );
              }
            }
          }
        }

        // Check if new items arrived while processing before releasing lock
        const freshQueue = await this.loadQueue();
        const remainingPending = freshQueue.some(
          (it) => it.status === "PENDING" || (it.status === "FAILED" && (it.nextRetryAt ?? 0) <= Date.now())
        );
        hasMore = remainingPending;
      }
    } finally {
      this.isDraining = false;
    }
  }

  /**
   * Move an unrecoverable item to dead letter storage so it is never silently dropped.
   */
  private async moveToDeadLetter(item: OutboxItem, reason: string): Promise<void> {
    item.status = "DEAD_LETTER";
    item.lastError = reason;
    await this.persistQueue();

    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY_DEAD_LETTER);
      const deadLetterQueue: OutboxItem[] = raw ? JSON.parse(raw) : [];
      deadLetterQueue.push(item);
      // Keep up to 200 dead letter entries for diagnostics
      if (deadLetterQueue.length > 200) {
        deadLetterQueue.shift();
      }
      await AsyncStorage.setItem(STORAGE_KEY_DEAD_LETTER, JSON.stringify(deadLetterQueue));
    } catch (e) {
      console.error("[DurableWriteOutbox] Failed to write to dead-letter storage", e);
    }

    if (__DEV__) {
      console.error(
        `[DurableWriteOutbox] Item moved to DEAD_LETTER: ${item.operationType} (${item.idempotencyKey}) - ${reason}`
      );
    }
  }

  /**
   * Get all items currently in the outbox.
   */
  public async getQueue(): Promise<OutboxItem[]> {
    return this.loadQueue();
  }

  /**
   * Get all items in dead-letter storage.
   */
  public async getDeadLetterQueue(): Promise<OutboxItem[]> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY_DEAD_LETTER);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  /**
   * Remove synced items older than 24 hours.
   */
  public async pruneSynced(): Promise<void> {
    const queue = await this.loadQueue();
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    this.memoryQueue = queue.filter(
      (item) => !(item.status === "SYNCED" && (item.syncedAt || 0) < cutoff)
    );
    await this.persistQueue();
  }
}

export const DurableWriteOutbox = new DurableWriteOutboxClass();

